// NOTE: This script is kept for documentation of the pipeline.
// By default it is disabled so that running npm scripts does
// not re-start the full data processing.
if (!process.env.LABMAP_ENABLE_DATAPIPELINE) {
    console.log('Pre-filtering script (preFilterProviders.js) is disabled in this repository.');
    console.log('It is included only to document the data-processing approach.');
    console.log('Set LABMAP_ENABLE_DATAPIPELINE=1 if you want to re-run it manually.');
    process.exit(0);
}

const fs = require('fs');
const path = require('path');

// Configuration (Germany-wide dataset)
// Raw data now lives in the data-collection directory
const RAW_DATA_PATH = path.join(__dirname, '..', 'data-collection', 'germany_providers.json');
// Prefiltered data is also written to the data-collection directory
const OUTPUT_PATH = path.join(__dirname, '..', 'data-collection', 'germany_prefiltered.json');
const LOG_FILE = path.join(__dirname, '..', 'data-collection', 'prefilter.log');

// Rough geographic bounds for Germany (same as crawler)
const GERMANY_BOUNDS = {
    north: 55.1,
    south: 47.2,
    west: 5.9,
    east: 15.1
};

// Classification keywords
const KEYWORDS = {
    blood: [
        'blut',
        'blood',
        'labor',
        'laboratory',
        'lab',
        'phlebotomy',
        'blutentnahme',
        'serum',
        'test',
        'screening',
        'diagnostik',
        'diagnostic',
        'pathologie',
        'pathology',
        'analyse'
    ],
    dexa: [
        'dexa',
        'bone density',
        'body composition',
        'knochendichte',
        'dxa',
        'osteoporosis',
        'osteoporose',
        'mineralization',
        'scan'
    ],
    medical: [
        'doctor',
        'arzt',
        'physician',
        'clinic',
        'klinik',
        'hospital',
        'krankenhaus',
        'medical',
        'medizin',
        'practice',
        'praxis',
        'zentrum',
        'center',
        'gesundheit',
        'health',
        'physio',
        'physical therapy',
        'rehabilitation',
        'therapie',
        'orthopädie',
        'orthopedic',
        'radiologie',
        'radiology',
        'imaging',
        'ultraschall',
        'ultrasound',
        'dental',
        'zahnarzt',
        'dentist',
        'apotheke',
        'pharmacy'
    ],
    ignore: [
        'spa',
        'wellness',
        'beauty',
        'kosmetik',
        'cosmetic',
        'salon',
        'friseur',
        'hair',
        'nail',
        'massage',
        'massage_spa',
        'tanning',
        'solarium',
        'fitnessstudio',
        'gym',
        'sport'
    ]
};

// Statistics tracking
const stats = {
    total: 0,
    non_germany: 0,
    blood_candidate: 0,
    dexa_candidate: 0,
    medical_other: 0,
    ignored: 0,
    startTime: new Date()
};

/**
 * Log message to console and file
 */
function log(message) {
    console.log(message);
    try {
        const dir = path.dirname(LOG_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, message + '\n');
    } catch (error) {
        // Silently fail if logging fails
    }
}

/**
 * Read raw data
 */
function loadRawData() {
    try {
        if (!fs.existsSync(RAW_DATA_PATH)) {
            log(`❌ Raw data file not found: ${RAW_DATA_PATH}`);
            return null;
        }
        const data = fs.readFileSync(RAW_DATA_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        log(`❌ Error reading raw data: ${error.message}`);
        return null;
    }
}

/**
 * Check if keywords are present in text
 */
function hasKeywords(text, keywords) {
    const lowerText = text.toLowerCase();
    return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Check if a provider is located in Germany based on formattedAddress only.
 *
 * If formattedAddress does NOT contain "Germany" or "Deutschland", the
 * provider is treated as outside Germany and will be dropped.
 */
function isInGermany(provider) {
    const address = provider.formattedAddress || '';
    const lowerAddress = address.toLowerCase();

    return lowerAddress.includes('germany') || lowerAddress.includes('deutschland');
}

/**
 * Classify a provider based on name and types
 */
function classifyProvider(provider) {
    const name = provider.name || '';
    const types = (provider.types || []).join(' ');
    const address = provider.formattedAddress || '';
    const searchText = `${name} ${types} ${address}`;

    // Check for ignored categories first (false positives)
    if (hasKeywords(searchText, KEYWORDS.ignore)) {
        // But allow if it's a legitimate medical provider
        if (!hasKeywords(searchText, KEYWORDS.medical)) {
            return 'ignored';
        }
    }

    // Check for DEXA candidates
    if (hasKeywords(searchText, KEYWORDS.dexa)) {
        return 'dexa_candidate';
    }

    // Check for blood/lab candidates
    if (hasKeywords(searchText, KEYWORDS.blood)) {
        return 'blood_candidate';
    }

    // Check for general medical providers
    if (hasKeywords(searchText, KEYWORDS.medical)) {
        return 'medical_other';
    }

    // Default to ignored if no medical keywords found
    return 'ignored';
}

/**
 * Filter and classify providers
 */
function filterProviders(providers) {
    const classified = [];

    for (const provider of providers) {
        stats.total++;

        // Drop any providers that are clearly outside Germany
        if (!isInGermany(provider)) {
            stats.non_germany++;
            continue;
        }

        const category = classifyProvider(provider);
        stats[category]++;

        // Add classification to provider
        provider.category = category;
        provider.classifiedAt = new Date().toISOString();

        // Only include non-ignored entries
        if (category !== 'ignored') {
            classified.push(provider);
        }
    }

    return classified;
}

/**
 * Save filtered data
 */
function saveResults(data) {
    try {
        const dir = path.dirname(OUTPUT_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
        log(`✓ Saved ${data.length} providers to ${OUTPUT_PATH}`);
        return true;
    } catch (error) {
        log(`❌ Error saving results: ${error.message}`);
        return false;
    }
}

/**
 * Main function
 */
async function main() {
    log('\n' + '='.repeat(80));
    log('🔍 GERMANY PROVIDERS - PRE-FILTERING & CLASSIFICATION');
    log('='.repeat(80));

    // Load raw data
    const rawProviders = loadRawData();
    if (!rawProviders || !Array.isArray(rawProviders)) {
        log('❌ Invalid or missing raw data');
        process.exit(1);
    }

    log(`\n📦 Loaded ${rawProviders.length} providers from raw dataset\n`);

    // Filter and classify
    log('🔄 Classifying providers...\n');
    const filtered = filterProviders(rawProviders);

    // Generate report
    log('\n' + '='.repeat(80));
    log('📊 CLASSIFICATION RESULTS');
    log('='.repeat(80));
    log(`\nTotal Providers Analyzed: ${stats.total}`);
    log(`   🌍 Outside Germany (dropped): ${stats.non_germany.toString().padStart(4)} (${((stats.non_germany / stats.total) * 100).toFixed(1)}%)`);
    log(`\n📋 Category Breakdown:`);
    log(`   🩸 Blood/Lab Candidates:      ${stats.blood_candidate.toString().padStart(4)} (${((stats.blood_candidate / stats.total) * 100).toFixed(1)}%)`);
    log(`   🦴 DEXA Candidates:            ${stats.dexa_candidate.toString().padStart(4)} (${((stats.dexa_candidate / stats.total) * 100).toFixed(1)}%)`);
    log(`   ⚕️  Other Medical Providers:   ${stats.medical_other.toString().padStart(4)} (${((stats.medical_other / stats.total) * 100).toFixed(1)}%)`);
    log(`   ❌ Ignored (Non-Medical):      ${stats.ignored.toString().padStart(4)} (${((stats.ignored / stats.total) * 100).toFixed(1)}%)`);
    log(`\n✅ Providers to Process:         ${filtered.length} (${((filtered.length / stats.total) * 100).toFixed(1)}%)`);

    log('\n📈 Category Distribution Details:');
    log(`   Blood Candidates:   ${stats.blood_candidate}`);
    log(`   DEXA Candidates:    ${stats.dexa_candidate}`);
    log(`   Medical Other:      ${stats.medical_other}`);

    const duration = ((new Date() - stats.startTime) / 1000).toFixed(2);
    log(`\n⏱️  Duration: ${duration}s`);
    log('='.repeat(80) + '\n');

    // Save results
    if (saveResults(filtered)) {
        log('✅ Pre-filtering completed successfully!\n');
    } else {
        log('⚠️  Pre-filtering completed with save errors\n');
    }
}

// Run the script
main().catch(error => {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
});
