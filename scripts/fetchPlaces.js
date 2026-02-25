const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// NOTE: This script is kept for documentation only.
// By default it is disabled to avoid accidental API calls
// against the Google Places API. To re-enable it with your
// own keys, set LABMAP_ENABLE_DATAPIPELINE=1 and provide a
// GOOGLE_PLACES_API_KEY in a local .env file.
if (!process.env.LABMAP_ENABLE_DATAPIPELINE) {
    console.log('Data collection script (fetchPlaces.js) is disabled in this repository.');
    console.log('See README section "Datenbeschaffung & Pipeline" for details.');
    process.exit(0);
}

// Configuration
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'queries.json');
// Write all JSON data into the data-collection directory
const OUTPUT_DIR = path.join(__dirname, '..', 'data-collection');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'germany_providers.json');
const LOG_FILE = path.join(__dirname, '..', 'data-collection', 'collection.log');

console.log(`Google Places API key: ${API_KEY ? '✓' : '❌ (set in .env)'}`);


// Germany geographic bounds
const GERMANY_BOUNDS = {
    north: 55.1,
    south: 47.2,
    west: 5.9,
    east: 15.1
};

// Grid tile configuration (can be overridden by config.grid.tileSize)
const GRID_TILE_SIZE = 0.3; // ~33 km per side @ 50°N latitude

// Grid subdivision configuration
const DEFAULT_MAX_GRID_DEPTH = 3; // maximum recursive subdivision depth
const TILE_SUBDIVIDE_THRESHOLD = 20; // if a single query returns >= this, subdivide

// Autosave configuration
const AUTOSAVE_THRESHOLD = 10; // autosave after this many new providers since last autosave

// Search radius per city (km converted to approximate coordinates)
const SEARCH_RADIUS_KM = 20;
const DEG_PER_KM = 1 / 111.32; // 1 degree latitude = 111.32 km

// Rate limiting
const RATE_LIMIT_MS = 300; // ms between requests
let lastRequestTime = 0;

// Holds the current execution context so we can autosave on graceful shutdown
let currentContext = null;

// Statistics
const stats = {
    citieSearches: 0,
    gridSearches: 0,
    resultsFoundTotal: 0,
    newProviders: 0,
    duplicates: 0,
    errors: 0,
    cityResults: {},
    gridResults: {},
    startTime: new Date()
};

/**
 * Log message to console and file
 */
function log(message) {
    console.log(message);
    try {
        const logsDir = path.dirname(LOG_FILE);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        fs.appendFileSync(LOG_FILE, message + '\n');
    } catch (error) {
        // Silently fail if logging fails
    }
}

/**
 * Load configuration
 */
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            log(`❌ Config file not found: ${CONFIG_PATH}`);
            return null;
        }
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        log(`❌ Error reading config: ${error.message}`);
        return null;
    }
}

/**
 * Load existing data to avoid duplicates
 */
function loadExistingData() {
    try {
        if (fs.existsSync(OUTPUT_FILE)) {
            const data = fs.readFileSync(OUTPUT_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        log(`⚠️  Could not load existing data: ${error.message}`);
    }
    return [];
}

/**
 * Generate geographic grid tiles for Germany
 */
function generateGridTiles(tileSize = GRID_TILE_SIZE) {
    const tiles = [];
    let tileId = 0;

    for (let lat = GERMANY_BOUNDS.south; lat < GERMANY_BOUNDS.north; lat += tileSize) {
        for (let lng = GERMANY_BOUNDS.west; lng < GERMANY_BOUNDS.east; lng += tileSize) {
            const north = Math.min(lat + tileSize, GERMANY_BOUNDS.north);
            const east = Math.min(lng + tileSize, GERMANY_BOUNDS.east);
            tiles.push({
                id: `base_${tileId++}`,
                north,
                south: lat,
                east,
                west: lng,
                centerLat: (lat + north) / 2,
                centerLng: (lng + east) / 2
            });
        }
    }

    return tiles;
}

/**
 * Calculate geographic bounds around a city
 */
function getBoundsAroundCity(lat, lng, radiusKm) {
    const deltaLat = radiusKm * DEG_PER_KM;
    const deltaLng = radiusKm * DEG_PER_KM * Math.cos(lat * Math.PI / 180);

    return {
        north: lat + deltaLat,
        south: lat - deltaLat,
        east: lng + deltaLng,
        west: lng - deltaLng
    };
}

/**
 * Apply rate limiting between requests
 */
async function applyRateLimit() {
    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
    }
    lastRequestTime = Date.now();
}

/**
 * Search Google Places API with pagination support
 */
function searchPlaces(query, bounds) {
    return new Promise((resolve, reject) => {
        if (!API_KEY) {
            reject(new Error('GOOGLE_PLACES_API_KEY environment variable not set'));
            return;
        }

        const requestBody = {
            textQuery: query,
            locationBias: {
                rectangle: {
                    low: { latitude: bounds.south, longitude: bounds.west },
                    high: { latitude: bounds.north, longitude: bounds.east }
                }
            }
        };

        const postData = JSON.stringify(requestBody);
        const options = {
            hostname: 'places.googleapis.com',
            path: '/v1/places:searchText',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'X-Goog-Api-Key': API_KEY,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri,places.internationalPhoneNumber,places.rating,places.types,places.businessStatus'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.places) {
                        resolve(result.places);
                    } else if (result.error) {
                        reject(new Error(result.error.message));
                    } else {
                        resolve([]);
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.setTimeout(10000, () => {
            req.abort();
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Extract relevant fields from API response
 */
function extractFields(place) {
    return {
        place_id: place.id || null,
        name: place.displayName?.text || null,
        formattedAddress: place.formattedAddress || null,
        location: place.location ? {
            lat: place.location.latitude,
            lng: place.location.longitude
        } : null,
        website: place.websiteUri || null,
        phone: place.internationalPhoneNumber || null,
        rating: place.rating || null,
        types: place.types || [],
        status: place.businessStatus || null,
        sources: [], // Will be populated during merge
        source: 'google_places',
        confidenceScore: 0,
        fetchedAt: new Date().toISOString()
    };
}

// Update confidenceScore based on pipeline-specific signals in the website URL
function updateConfidenceScore(provider, pipeline) {
    if (!provider || !provider.website || !pipeline) return;

    const websiteText = provider.website.toLowerCase();

    if (typeof provider.confidenceScore !== 'number') {
        provider.confidenceScore = 0;
    }

    if (pipeline === 'dexa') {
        if (websiteText.includes('body composition')) {
            provider.confidenceScore += 40;
        }
        if (websiteText.includes('dexa')) {
            provider.confidenceScore += 30;
        }
        if (websiteText.includes('körperanalyse')) {
            provider.confidenceScore += 20;
        }
    } else if (pipeline === 'blood') {
        if (websiteText.includes('selbstzahler')) {
            provider.confidenceScore += 40;
        }
        if (websiteText.includes('bluttest')) {
            provider.confidenceScore += 20;
        }
        if (websiteText.includes('privat')) {
            provider.confidenceScore += 20;
        }
    }
}

/**
 * Check if provider is a medical facility
 */
function isMedicalProvider(place) {
    if (!place.types) return true; // Can't filter, include it

    const medicalTypes = [
        'doctor',
        'hospital',
        'health',
        'medical',
        'clinic',
        'laboratory',
        'diagnostic',
        'pharmacy',
        'physiotherapy',
        'dentist'
    ];

    const placeTypes = place.types.join(' ').toLowerCase();
    return medicalTypes.some(type => placeTypes.includes(type));
}

// ===== Helper functions for advanced deduplication =====

// Normalize strings for comparison (case-insensitive, trimmed, collapsed spaces)
function normalizeText(value) {
    if (!value || typeof value !== 'string') return null;
    return value
        .normalize('NFKC')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

// Build a combined key from normalized name and address
function getNameAddressKey(entity) {
    const nameNorm = normalizeText(entity.name);
    const addrNorm = normalizeText(entity.formattedAddress);
    if (!nameNorm || !addrNorm) return null;
    return `${nameNorm}|${addrNorm}`;
}

// Haversine distance in meters between two coordinates
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Simple spatial index using ~100m grid cells
const SPATIAL_CELL_SIZE_DEG = 0.001; // ~111m in latitude

function getSpatialCellKey(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    const latIndex = Math.floor(lat / SPATIAL_CELL_SIZE_DEG);
    const lngIndex = Math.floor(lng / SPATIAL_CELL_SIZE_DEG);
    return `${latIndex}:${lngIndex}`;
}

function getNearbyProvidersFromIndex(spatialIndex, location) {
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
        return [];
    }
    const baseLatIndex = Math.floor(location.lat / SPATIAL_CELL_SIZE_DEG);
    const baseLngIndex = Math.floor(location.lng / SPATIAL_CELL_SIZE_DEG);
    const candidates = [];

    for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLng = -1; dLng <= 1; dLng++) {
            const key = `${baseLatIndex + dLat}:${baseLngIndex + dLng}`;
            const bucket = spatialIndex.get(key);
            if (bucket && bucket.length) {
                candidates.push(...bucket);
            }
        }
    }

    return candidates;
}

// Global indexes for efficient duplicate lookup across the whole run
const globalIdIndex = new Map(); // place_id -> provider
const globalNameAddrIndex = new Map(); // normalized name+address -> provider
const globalSpatialIndex = new Map(); // spatial cell key -> [providers]

function addProviderToIndexes(provider) {
    if (!provider) return;

    if (provider.place_id) {
        globalIdIndex.set(provider.place_id, provider);
    }

    const key = getNameAddressKey(provider);
    if (key && !globalNameAddrIndex.has(key)) {
        globalNameAddrIndex.set(key, provider);
    }

    if (provider.location && typeof provider.location.lat === 'number' && typeof provider.location.lng === 'number') {
        const cellKey = getSpatialCellKey(provider.location.lat, provider.location.lng);
        if (cellKey) {
            if (!globalSpatialIndex.has(cellKey)) {
                globalSpatialIndex.set(cellKey, []);
            }
            globalSpatialIndex.get(cellKey).push(provider);
        }
    }
}

function buildGlobalIndexes(providers) {
    globalIdIndex.clear();
    globalNameAddrIndex.clear();
    globalSpatialIndex.clear();

    for (const provider of providers) {
        addProviderToIndexes(provider);
    }
}

/**
 * Merge new results with existing data, deduplicating by:
 * - place_id (primary key)
 * - same normalized name + normalized formattedAddress
 * - distance < 50m when coordinates are available
 *
 * Only OPERATIONAL medical providers are kept.
 */
function mergeResults(existingData, newPlaces, context = {}) {
    const newCount = {
        added: 0,
        duplicates: 0,
        filtered: 0
    };

    for (const place of newPlaces) {
        // Keep only OPERATIONAL businesses
        if (place.businessStatus !== 'OPERATIONAL') {
            newCount.filtered++;
            continue;
        }

        // Filter for medical providers
        if (!isMedicalProvider(place)) {
            newCount.filtered++;
            continue;
        }

        const extracted = extractFields(place);
        let existing = null;

        // 1) Exact match by place_id
        if (extracted.place_id && globalIdIndex.has(extracted.place_id)) {
            existing = globalIdIndex.get(extracted.place_id);
        } else {
            // 2) Same normalized name + address
            const nameAddrKey = getNameAddressKey(extracted);
            if (nameAddrKey && globalNameAddrIndex.has(nameAddrKey)) {
                existing = globalNameAddrIndex.get(nameAddrKey);
            }

            // 3) Spatial proximity (< 50m)
            if (!existing && extracted.location) {
                const nearby = getNearbyProvidersFromIndex(globalSpatialIndex, extracted.location);
                for (const candidate of nearby) {
                    if (candidate.location) {
                        const dist = haversineDistanceMeters(
                            extracted.location.lat,
                            extracted.location.lng,
                            candidate.location.lat,
                            candidate.location.lng
                        );
                        if (dist < 50) {
                            existing = candidate;
                            break;
                        }
                    }
                }
            }
        }

        if (!existing) {
            // New provider
            extracted.sources = [context.source || 'unknown'];
            if (context.searchContext) {
                extracted.searchContext = context.searchContext;
            }

            if (context.pipeline) {
                updateConfidenceScore(extracted, context.pipeline);
            }
            existingData.push(extracted);

            // Update global indexes so subsequent batches can match
            addProviderToIndexes(extracted);

            newCount.added++;
        } else {
            // Duplicate found – merge sources only
            newCount.duplicates++;
            if (context.source) {
                if (!Array.isArray(existing.sources)) {
                    // Ensure sources is an array
                    existing.sources = existing.sources ? [existing.sources] : [];
                }
                if (!existing.sources.includes(context.source)) {
                    existing.sources.push(context.source);
                }
            }

            if (context.pipeline) {
                updateConfidenceScore(existing, context.pipeline);
            }
        }
    }

    return { data: existingData, counts: newCount };
}

/**
 * Save results to file
 */
function saveResults(data) {
    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
        log(`✓ Saved ${data.length} providers to ${OUTPUT_FILE}`);
        return true;
    } catch (error) {
        log(`❌ Error saving results: ${error.message}`);
        return false;
    }
}

// Autosave current results using a safe write strategy (temp file -> rename)
function autoSave(data) {
    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        const tmpFile = OUTPUT_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
        fs.renameSync(tmpFile, OUTPUT_FILE);

        log(`💾 Autosaved ${data.length} providers to ${OUTPUT_FILE}`);
    } catch (error) {
        log(`⚠️  Autosave failed: ${error.message}`);
    }
}

// Gracefully handle Ctrl+C (SIGINT) to persist the latest in-memory data
process.on('SIGINT', () => {
    log('⚠️  SIGINT received – performing final autosave before exit...');
    try {
        if (currentContext && Array.isArray(currentContext.allProviders)) {
            autoSave(currentContext.allProviders);
        } else {
            const data = loadExistingData();
            autoSave(data);
        }
    } catch (error) {
        log(`⚠️  Error during SIGINT autosave: ${error.message}`);
    } finally {
        process.exit(1);
    }
});

// Subdivide a tile into 4 smaller tiles
function subdivideTile(tile) {
    const midLat = (tile.north + tile.south) / 2;
    const midLng = (tile.east + tile.west) / 2;
    const depth = (tile.depth || 0) + 1;

    return [
        {
            id: `${tile.id}.0`,
            south: tile.south,
            north: midLat,
            west: tile.west,
            east: midLng,
            centerLat: (tile.south + midLat) / 2,
            centerLng: (tile.west + midLng) / 2,
            depth
        },
        {
            id: `${tile.id}.1`,
            south: tile.south,
            north: midLat,
            west: midLng,
            east: tile.east,
            centerLat: (tile.south + midLat) / 2,
            centerLng: (midLng + tile.east) / 2,
            depth
        },
        {
            id: `${tile.id}.2`,
            south: midLat,
            north: tile.north,
            west: tile.west,
            east: midLng,
            centerLat: (midLat + tile.north) / 2,
            centerLng: (tile.west + midLng) / 2,
            depth
        },
        {
            id: `${tile.id}.3`,
            south: midLat,
            north: tile.north,
            west: midLng,
            east: tile.east,
            centerLat: (midLat + tile.north) / 2,
            centerLng: (midLng + tile.east) / 2,
            depth
        }
    ];
}

// Recursively process a tile for a given pipeline and keyword list
async function processTileRecursive(tile, keywords, pipeline, context) {
    if (context.stopRequested) return;
    if (!keywords || keywords.length === 0) return;

    const tileKey = `tile_${pipeline}_${tile.id}`;
    const stateKey = `${pipeline}|${tile.id}`;
    let tileState = context.tileKeywordCache.get(stateKey);
    if (!tileState) {
        tileState = { zeroNewStreak: 0, executedKeywords: new Map(), lastResultIds: null };
        context.tileKeywordCache.set(stateKey, tileState);
    }

    if (!context.stats.gridResults[tileKey]) {
        context.stats.gridResults[tileKey] = { searched: 0, found: 0, added: 0, duplicates: 0 };
    }

    let shouldSubdivide = false;

    for (const keyword of keywords) {
        if (context.stopRequested) break;

        const normKey = keyword.toLowerCase().trim();
        if (tileState.executedKeywords.has(normKey)) {
            log(`   ⏭️  Skipping cached keyword "${keyword}" in tile ${tile.id}`);
            continue;
        }

        await applyRateLimit();
        context.stats.gridSearches++;
        context.stats.gridResults[tileKey].searched++;

        log(`   🔍 [${pipeline}] "${keyword}" in tile ${tile.id} (depth ${tile.depth || 0})`);

        let results = [];
        try {
            results = await searchPlaces(keyword, tile);
        } catch (error) {
            context.stats.errors++;
            log(`      ❌ ${error.message}`);
            continue;
        }

        context.stats.resultsFoundTotal += results.length;
        context.stats.gridResults[tileKey].found += results.length;

        // Build current result id set for lightweight similarity checks
        const currentIds = new Set();
        for (const place of results) {
            if (place && place.id) {
                currentIds.add(place.id);
            }
        }

        // If this keyword produced an identical id set to the previous one in this tile, treat it as redundant
        if (tileState.lastResultIds && currentIds.size > 0 && currentIds.size === tileState.lastResultIds.size) {
            let allSame = true;
            for (const id of currentIds) {
                if (!tileState.lastResultIds.has(id)) {
                    allSame = false;
                    break;
                }
            }
            if (allSame) {
                log(`      ↪ Results for "${keyword}" are identical to previous keyword in this tile – skipping merge.`);
                tileState.executedKeywords.set(normKey, { found: results.length, added: 0 });
                continue;
            }
        }

        let merged = false;
        if (results.length > 0) {
            const mergeContext = {
                pipeline,
                source: `grid:${pipeline}`,
                searchContext: {
                    pipeline,
                    tileId: tile.id,
                    keyword,
                    depth: tile.depth || 0,
                    coordinates: `${tile.centerLat.toFixed(2)},${tile.centerLng.toFixed(2)}`
                }
            };
            const { data, counts } = mergeResults(context.allProviders, results, mergeContext);
            context.allProviders = data;
            context.stats.newProviders += counts.added;
            context.stats.duplicates += counts.duplicates;
            context.stats.gridResults[tileKey].added += counts.added;
            context.stats.gridResults[tileKey].duplicates += counts.duplicates;

            const summary = `${results.length} found (+${counts.added} new, ${counts.duplicates} dup)`;
            log(`      ✓ ${summary}`);
            merged = true;

            // Update per-tile keyword cache & streaks
            tileState.executedKeywords.set(normKey, { found: results.length, added: counts.added });
            tileState.lastResultIds = currentIds;
            if (counts.added === 0) {
                tileState.zeroNewStreak++;
            } else {
                tileState.zeroNewStreak = 0;
            }

            // Autosave after accumulating a threshold of new providers
            if (counts.added > 0) {
                context.newSinceLastAutoSave = (context.newSinceLastAutoSave || 0) + counts.added;
                if (context.newSinceLastAutoSave >= AUTOSAVE_THRESHOLD) {
                    autoSave(context.allProviders);
                    context.newSinceLastAutoSave = 0;
                }
            }

            if (context.allProviders.length >= context.maxProviders) {
                log(`🚫 Reached max providers limit (${context.maxProviders}). Stopping early.`);
                context.stopRequested = true;
                break;
            }
        }

        // If we merged and observed 2 consecutive keywords with no new providers, skip remaining keywords in this tile
        if (merged && tileState.zeroNewStreak >= 2) {
            log(`      ⚠️ No new providers for 2 consecutive keywords in tile ${tile.id} – skipping remaining keywords.`);
            break;
        }

        if (results.length >= TILE_SUBDIVIDE_THRESHOLD) {
            shouldSubdivide = true;
        }
    }

    if (shouldSubdivide && (tile.depth || 0) < context.maxGridDepth && !context.stopRequested) {
        const children = subdivideTile(tile);
        for (const child of children) {
            await processTileRecursive(child, keywords, pipeline, context);
            if (context.stopRequested) break;
        }
    }
}

/**
 * Main function
 */
async function main() {
    log('\n' + '='.repeat(80));
    log('🗺️  GERMANY MEDICAL PROVIDERS - COMPREHENSIVE GRID-BASED COLLECTION');
    log('='.repeat(80));

    // Load configuration
    const config = loadConfig();
    if (!config) {
        log('❌ Invalid configuration');
        process.exit(1);
    }

    const dexaKeywords = config.dexaKeywords || [];
    const bloodKeywords = config.bloodKeywords || [];
    const maxProviders = typeof config.maxProviders === 'number' && config.maxProviders > 0
        ? config.maxProviders
        : 250;
    const maxGridDepth = config.grid && typeof config.grid.maxDepth === 'number'
        ? config.grid.maxDepth
        : DEFAULT_MAX_GRID_DEPTH;
    const tileSize = config.grid && typeof config.grid.tileSize === 'number'
        ? config.grid.tileSize
        : GRID_TILE_SIZE;

    const pipelineArg = (process.argv[2] || 'all').toLowerCase();
    const runDexa = pipelineArg === 'all' || pipelineArg === 'dexa';
    const runBlood = pipelineArg === 'all' || pipelineArg === 'blood';

    if (!runDexa && !runBlood) {
        log('❌ Invalid pipeline argument. Use "dexa", "blood", or "all".');
        process.exit(1);
    }

    log(`\n📋 Configuration:`);
    log(`   Region: ${config.region || 'N/A'}`);
    log(`   DEXA Keywords: ${dexaKeywords.length}`);
    log(`   Blood Keywords: ${bloodKeywords.length}`);
    log(`   Max Providers: ${maxProviders}`);
    log(`   Grid Tile Size: ${tileSize}° (base)`);
    log(`   Max Grid Depth: ${maxGridDepth}`);
    log(`   Pipeline: ${pipelineArg}`);

    // Generate geographic grid
    const gridTiles = generateGridTiles(tileSize).map(tile => ({ ...tile, depth: 0 }));
    log(`   Geographic Grid Tiles: ${gridTiles.length}`);
    log(`   Tile Size: ${tileSize}°`);

    // Load existing data
    let allProviders = loadExistingData();
    log(`\n📦 Starting with ${allProviders.length} existing providers\n`);
    buildGlobalIndexes(allProviders);

    // ==================== GRID-BASED SEARCH (PIPELINES) ====================
    log('\n' + '='.repeat(80));
    log('PHASE: GEOGRAPHIC GRID-BASED SEARCH (PIPELINES)');
    log('='.repeat(80) + '\n');

    const context = {
        allProviders,
        stats,
        maxProviders,
        maxGridDepth,
        stopRequested: false,
        tileKeywordCache: new Map(),
        newSinceLastAutoSave: 0
    };

    // Expose current context for SIGINT handler autosave
    currentContext = context;

    if (runDexa && dexaKeywords.length > 0) {
        log('\n' + '-'.repeat(40));
        log('🔬 PIPELINE: DEXA');
        log('-'.repeat(40));
        for (const tile of gridTiles) {
            await processTileRecursive(tile, dexaKeywords, 'dexa', context);
            if (context.stopRequested) break;
        }
    }

    if (!context.stopRequested && runBlood && bloodKeywords.length > 0) {
        log('\n' + '-'.repeat(40));
        log('🩸 PIPELINE: BLOOD TEST');
        log('-'.repeat(40));
        for (const tile of gridTiles) {
            await processTileRecursive(tile, bloodKeywords, 'blood', context);
            if (context.stopRequested) break;
        }
    }

    allProviders = context.allProviders;

    // ==================== FINAL REPORT ====================
    log('\n' + '='.repeat(80));
    log('📊 COMPREHENSIVE COLLECTION SUMMARY');
    log('='.repeat(80));

    log('\n🏙️  CITY-BASED SEARCH RESULTS:');
    let cityTotalSearched = 0;
    let cityTotalFound = 0;
    let cityTotalAdded = 0;
    for (const [city, data] of Object.entries(stats.cityResults)) {
        cityTotalSearched += data.searched;
        cityTotalFound += data.found;
        cityTotalAdded += data.added;
        log(`   ${city.padEnd(20)} - Queries: ${data.searched.toString().padStart(2)}, Found: ${data.found.toString().padStart(4)}, Added: ${data.added.toString().padStart(3)}, Duplicates: ${data.duplicates}`);
    }
    log(`   ${'CITY TOTALS'.padEnd(20)} - Queries: ${cityTotalSearched.toString().padStart(2)}, Found: ${cityTotalFound.toString().padStart(4)}, Added: ${cityTotalAdded.toString().padStart(3)}`);

    log('\n📍 GRID-BASED SEARCH RESULTS (Sample):');
    let gridTotalSearched = 0;
    let gridTotalFound = 0;
    let gridTotalAdded = 0;
    let gridProcessed = 0;
    for (const [tile, data] of Object.entries(stats.gridResults)) {
        if (data.searched > 0) {
            gridTotalSearched += data.searched;
            gridTotalFound += data.found;
            gridTotalAdded += data.added;
            gridProcessed++;
        }
    }
    log(`   Tiles Processed: ${gridProcessed}`);
    log(`   Total Grid Queries: ${gridTotalSearched}, Found: ${gridTotalFound}, Added: ${gridTotalAdded}`);

    log('\n📈 OVERALL STATISTICS:');
    log(`   City-Based Searches: ${stats.citieSearches}`);
    log(`   Grid-Based Searches: ${stats.gridSearches}`);
    log(`   Total API Queries: ${stats.citieSearches + stats.gridSearches}`);
    log(`   Total Results Found: ${stats.resultsFoundTotal}`);
    log(`   New Providers Added: ${stats.newProviders}`);
    log(`   Duplicates Detected: ${stats.duplicates}`);
    log(`   API Errors: ${stats.errors}`);
    log(`   Final Database Size: ${allProviders.length} providers`);

    const duration = ((new Date() - stats.startTime) / 1000).toFixed(1);
    log(`   Duration: ${duration}s`);
    log(`   Avg Time per Query: ${(duration / (stats.citieSearches + stats.gridSearches)).toFixed(2)}s`);

    log('='.repeat(80) + '\n');

    // Save results
    if (saveResults(allProviders)) {
        log('✅ Collection completed successfully!\n');
    } else {
        log('⚠️  Collection completed with save errors\n');
    }
}

// Run the script
main().catch(error => {
    log(`Fatal error: ${error.message}`);
});
