// NOTE: This verification/scraping script is kept to document
// the approach used during data preparation. By default it is
// disabled so that reviewers cannot accidentally start a long
// scraping job against third-party websites.
if (!process.env.LABMAP_ENABLE_DATAPIPELINE) {
    console.log('Verification script (scraps.js) is disabled in this repository.');
    console.log('It is included only to illustrate the verification step.');
    console.log('Set LABMAP_ENABLE_DATAPIPELINE=1 if you consciously re-run it.');
    process.exit(0);
}

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Work with Germany-wide prefiltered providers
// Input and output JSON now live in the data-collection directory
const INPUT_PATH = path.join(__dirname, '..', 'data-collection', 'germany_prefiltered.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data-collection', 'germany_verified.json');
const LOG_FILE = path.join(__dirname, '..', 'data-collection', 'verification.log');

// Autosave configuration for long-running scraping
const AUTOSAVE_THRESHOLD = 25; // autosave after this many verified providers since last autosave

const TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_SERVICE_PAGES = 8;
const LINK_KEYWORDS = [
    'leistungen',
    'services',
    'angebot',
    'angebote',
    'labor',
    'diagnostik',
    'behandlung',
    'preise'
];

const KEYWORDS = {
    blood_candidate: [
        'selbstzahler',
        'ohne überweisung',
        'privatleistung',
        'blutabnahme',
        'laboranalyse'
    ],
    dexa_candidate: [
        'body composition',
        'körperfett',
        'muskelmasse',
        'ganzkörper',
        'dexa'
    ]
};

const stats = {
    total: 0,
    targetTotal: 0,
    skippedNoWebsite: 0,
    verified: {
        blood_candidate: 0,
        dexa_candidate: 0
    },
    failed: {
        blood_candidate: 0,
        dexa_candidate: 0
    },
    errors: 0,
    startTime: new Date()
};

// Track current in-memory state for graceful shutdown
let currentVerified = [];
let verifiedSinceLastAutosave = 0;

function log(message) {
    console.log(message);
    try {
        const dir = path.dirname(LOG_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, message + '\n');
    } catch (error) {
        // Ignore logging failures
    }
}

function loadProviders() {
    if (!fs.existsSync(INPUT_PATH)) {
        throw new Error(`Input file not found: ${INPUT_PATH}`);
    }
    const raw = fs.readFileSync(INPUT_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
        throw new Error('Input dataset is not an array');
    }
    return data;
}

function saveProviders(data) {
    const dir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
    log(`✓ Saved ${data.length} providers to ${OUTPUT_PATH}`);
}

// Autosave using temp-file-then-rename strategy
function autoSave(data) {
    try {
        const dir = path.dirname(OUTPUT_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const tmpFile = OUTPUT_PATH + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
        fs.renameSync(tmpFile, OUTPUT_PATH);

        log(`💾 Autosaved ${data.length} providers to ${OUTPUT_PATH}`);
    } catch (error) {
        log(`⚠️  Autosave failed: ${error.message}`);
    }
}

function normalizeText(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .trim();
}

function stripHtml(html) {
    const withoutScripts = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

    const textOnly = withoutScripts.replace(/<[^>]+>/g, ' ');
    return normalizeText(textOnly);
}

function extractLinks(html, baseUrl) {
    const links = new Set();
    const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
        const href = match[1].trim();
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
            continue;
        }

        try {
            const resolved = new URL(href, baseUrl);
            links.add(resolved.toString());
        } catch (error) {
            // Skip invalid URLs
        }
    }

    return Array.from(links);
}

function filterServiceLinks(links, baseUrl) {
    const filtered = [];
    let base;
    try {
        base = new URL(baseUrl);
    } catch (error) {
        return filtered;
    }

    for (const link of links) {
        try {
            const url = new URL(link);
            if (url.hostname !== base.hostname) {
                continue;
            }

            const lower = url.pathname.toLowerCase();
            if (LINK_KEYWORDS.some((keyword) => lower.includes(keyword))) {
                filtered.push(url.toString());
            }
        } catch (error) {
            // Skip invalid URLs
        }
    }

    return filtered;
}

function countOccurrences(text, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
}

// Extract short text snippets around price expressions (e.g. "49,00 €")
function extractPriceSnippets(text) {
    if (!text) return [];

    const snippets = new Set();
    // Simple pattern for numbers followed by the Euro sign
    const regex = /(.{0,40}?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*€.{0,40}?)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const snippet = normalizeText(match[1]);
        if (snippet.length > 0) {
            snippets.add(snippet);
        }
        if (snippets.size >= 10) break; // avoid huge arrays
    }

    return Array.from(snippets);
}

function verifyService(text, category) {
    const keywords = KEYWORDS[category] || [];
    const matchedKeywords = [];
    let totalMatches = 0;

    for (const keyword of keywords) {
        const count = countOccurrences(text, keyword);
        if (count > 0) {
            matchedKeywords.push(keyword);
            totalMatches += count;
        }
    }

    const verified = matchedKeywords.length > 0;
    const score = Math.min(1, (matchedKeywords.length * 0.2) + (totalMatches * 0.05));

    return {
        verified,
        matchedKeywords,
        confidenceScore: Number(score.toFixed(2))
    };
}

function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (error) {
            reject(new Error('Invalid URL'));
            return;
        }

        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.get(url, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            let data = '';
            let bytes = 0;
            res.setEncoding('utf8');

            res.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > MAX_BODY_BYTES) {
                    req.destroy(new Error('Response too large'));
                    return;
                }
                data += chunk;
            });

            res.on('end', () => resolve(data));
        });

        req.setTimeout(TIMEOUT_MS, () => {
            req.destroy(new Error('Request timeout'));
        });

        req.on('error', (error) => {
            reject(error);
        });
    });
}

async function processProvider(provider) {
    const category = provider.preClassification || provider.category;
    if (!category || (category !== 'blood_candidate' && category !== 'dexa_candidate')) {
        return provider;
    }

    stats.targetTotal++;

    if (!provider.website) {
        stats.skippedNoWebsite++;
        provider.verification = {
            verified: false,
            matchedKeywords: [],
            confidenceScore: 0,
            pagesScanned: 0
        };
        return provider;
    }

    try {
        const homepageHtml = await fetchHtml(provider.website);
        const discoveredLinks = extractLinks(homepageHtml, provider.website);
        const serviceLinks = filterServiceLinks(discoveredLinks, provider.website);
        const uniqueServiceLinks = Array.from(new Set(serviceLinks)).slice(0, MAX_SERVICE_PAGES);

        let combinedText = stripHtml(homepageHtml);
        let pagesScanned = 1;

        for (const link of uniqueServiceLinks) {
            try {
                const pageHtml = await fetchHtml(link);
                combinedText += ' ' + stripHtml(pageHtml);
                pagesScanned++;
            } catch (error) {
                stats.errors++;
                log(`⚠️  ${provider.name || 'Unknown'}: ${error.message} (${link})`);
            }
        }

        const verification = verifyService(combinedText.toLowerCase(), category);
        verification.pagesScanned = pagesScanned;

        // Extract potential price snippets from the combined text (if any)
        const priceSnippets = extractPriceSnippets(combinedText);

        provider.verification = verification;
        if (priceSnippets.length > 0) {
            provider.prices = priceSnippets;
        }

        // Add a high-level self-pay flag and human-friendly category label
        const mk = verification.matchedKeywords || [];
        const selfPay = mk.some((k) => /selbstzahler|ohne überweisung|privatleistung/i.test(k));
        provider.selfPay = selfPay;
        provider.categoryLabel = category === 'dexa_candidate' ? 'DEXA' : 'Blutlabor';

        log(`📄 ${provider.name || 'Unknown'}: ${pagesScanned} pages scanned, ${uniqueServiceLinks.length} service links discovered`);

        if (verification.verified) {
            stats.verified[category]++;
        } else {
            stats.failed[category]++;
        }
    } catch (error) {
        stats.errors++;
        provider.verification = {
            verified: false,
            matchedKeywords: [],
            confidenceScore: 0,
            pagesScanned: 0
        };
        log(`⚠️  ${provider.name || 'Unknown'}: ${error.message}`);
    }

    return provider;
}

async function main() {
    log('\n' + '='.repeat(80));
    log('🧪 PROVIDER SERVICE VERIFICATION');
    log('='.repeat(80));

    const providers = loadProviders();
    const targets = providers; // scrape all providers

    stats.total = targets.length;
    log(`\n📦 Loaded ${providers.length} providers`);
    log(`🎯 Filtered targets: ${targets.length}`);

    for (let i = 0; i < targets.length; i++) {
        const provider = targets[i];
        await processProvider(provider);

        if ((i + 1) % 50 === 0) {
            log(`Processed ${i + 1}/${targets.length}`);
        }
    }

    // Keep only verified providers and deduplicate by place_id
    const verifiedProviders = targets.filter((provider) => provider.verification?.verified);
    const byId = new Map();

    for (const provider of verifiedProviders) {
        const id = provider.place_id || provider.id;
        if (!id) {
            // No stable id, just push as-is
            const tempKey = `no-id-${byId.size}`;
            byId.set(tempKey, provider);
            continue;
        }

        if (!byId.has(id)) {
            byId.set(id, provider);
        } else {
            // Merge basic verification info if we see the same place again
            const existing = byId.get(id);
            const existingVer = existing.verification || { matchedKeywords: [] };
            const newVer = provider.verification || { matchedKeywords: [] };

            const mergedKeywords = new Set([
                ...(existingVer.matchedKeywords || []),
                ...(newVer.matchedKeywords || [])
            ]);

            existing.verification.matchedKeywords = Array.from(mergedKeywords);
            existing.verification.confidenceScore = Math.max(
                existingVer.confidenceScore || 0,
                newVer.confidenceScore || 0
            );

            // Merge price snippets
            const existingPrices = new Set(existing.prices || []);
            for (const p of provider.prices || []) {
                existingPrices.add(p);
            }
            if (existingPrices.size > 0) {
                existing.prices = Array.from(existingPrices);
            }
        }
    }

    const uniqueVerified = Array.from(byId.values());
    currentVerified = uniqueVerified;
    saveProviders(uniqueVerified);

    const duration = ((new Date() - stats.startTime) / 1000).toFixed(1);
    log('\n' + '='.repeat(80));
    log('📊 VERIFICATION SUMMARY');
    log('='.repeat(80));
    log(`Total Providers (targets): ${stats.total}`);
    log(`Targeted (blood/dexa): ${stats.targetTotal}`);
    log(`Skipped (no website): ${stats.skippedNoWebsite}`);
    log(`Verified blood_candidate: ${stats.verified.blood_candidate}`);
    log(`Verified dexa_candidate: ${stats.verified.dexa_candidate}`);
    log(`Failed blood_candidate: ${stats.failed.blood_candidate}`);
    log(`Failed dexa_candidate: ${stats.failed.dexa_candidate}`);
    log(`Errors: ${stats.errors}`);
    log(`Duration: ${duration}s`);
    log('='.repeat(80) + '\n');
}
// Gracefully handle Ctrl+C to persist progress
process.on('SIGINT', () => {
    log('⚠️  SIGINT received – performing final autosave before exit...');
    try {
        if (currentVerified && Array.isArray(currentVerified) && currentVerified.length > 0) {
            autoSave(currentVerified);
        }
    } catch (error) {
        log(`⚠️  Error during SIGINT autosave: ${error.message}`);
    } finally {
        process.exit(1);
    }
});

main().catch((error) => {
    log(`Fatal error: ${error.message}`);
    if (currentVerified && Array.isArray(currentVerified) && currentVerified.length > 0) {
        autoSave(currentVerified);
    }
    process.exit(1);
});
