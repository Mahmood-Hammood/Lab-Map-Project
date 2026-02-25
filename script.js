// Initialize the map centered on Germany
let map;
let markers = [];
let markerClusterGroup = null;
let markerById = {};
let allProviders = [];
let currentFilter = 'all';
let currentSearch = '';
let currentFilterLocation = null;
let currentFilterDistance = null;
let selectedMarker = null;

// Initialize map on page load
document.addEventListener('DOMContentLoaded', function () {
    initMap();
    loadProviders();
    setupFilterListener();
    setupSearchListener();
    setupDistanceSearchListener();
    setupSidebarControls();
});

// Initialize Leaflet map
function initMap() {
    // Center coordinates for Germany
    const germanyCenter = [51.1657, 10.4515];

    map = L.map('map').setView(germanyCenter, 6);

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        minZoom: 5
    }).addTo(map);

    // Initialize marker clustering group
    if (L.markerClusterGroup) {
        markerClusterGroup = L.markerClusterGroup();
        map.addLayer(markerClusterGroup);
    }

    // Close any open popups when clicking on the map
    map.on('click', function () {
        map.closePopup();
    });
}

// Load providers from JSON and add markers
function loadProviders() {
    fetch('data-collection/germany_verified.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to load providers data');
            }
            return response.json();
        })
        .then(data => {
            // Map verified provider data into the structure expected by the map
            allProviders = data.map(provider => {
                // Prefer human-friendly category label from scraping, fall back to raw classification
                const rawType = provider.categoryLabel || provider.category || provider.preClassification || '';
                let type = 'unknown';
                if (/^dexa$/i.test(rawType) || rawType === 'dexa_candidate') {
                    type = 'dexa';
                } else if (/^blutlabor$/i.test(rawType) || rawType === 'blood_candidate') {
                    type = 'blood';
                }

                // Build structured services array if price snippets are available
                let services = [];
                if (Array.isArray(provider.prices) && provider.prices.length > 0) {
                    const serviceName = type === 'dexa'
                        ? 'DEXA Body Composition'
                        : 'Blood test (self-pay)';
                    services = provider.prices.map(priceSnippet => ({
                        name: serviceName,
                        price: priceSnippet,
                        currency: 'EUR',
                        selfPay: provider.selfPay === true
                    }));
                }

                return {
                    id: provider.place_id,
                    name: provider.name,
                    address: provider.formattedAddress,
                    latitude: provider.location?.lat,
                    longitude: provider.location?.lng,
                    type,
                    phone: provider.phone || null,
                    website: provider.website || null,
                    city: provider.searchContext?.city || provider.city || null,
                    services
                };
            }).filter(p => typeof p.latitude === 'number' && typeof p.longitude === 'number');
            // Initial render: show all markers with no filters
            addMarkers(allProviders);
        })
        .catch(error => {
            console.error('Error loading providers:', error);
            alert('Error loading providers data. Please check the data-collection/germany_verified.json file.');
        });
}

// Toggle visibility of the services section inside a popup
function toggleServices(providerId, buttonEl) {
    const section = document.getElementById(`services-${providerId}`);
    if (!section) return;

    const isCollapsed = section.classList.contains('collapsed');
    if (isCollapsed) {
        section.classList.remove('collapsed');
        if (buttonEl) {
            buttonEl.textContent = 'Hide Services';
        }
    } else {
        section.classList.add('collapsed');
        if (buttonEl) {
            buttonEl.textContent = 'Show Services';
        }
    }
}

// Open the sliding provider sidebar and show details for a given provider
function openSidebar(provider) {
    const sidebar = document.getElementById('provider-sidebar');
    const detail = document.getElementById('provider-detail');
    if (!sidebar || !detail || !provider) return;

    detail.innerHTML = createPopup(provider);
    sidebar.classList.add('open');

    // Give the layout a moment to adjust, then fix map sizing
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 320);
}

// Close the sliding provider sidebar
function closeSidebar() {
    const sidebar = document.getElementById('provider-sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('open');

    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 320);
}

// Setup sidebar close button listener
function setupSidebarControls() {
    const closeBtn = document.getElementById('sidebar-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSidebar);
    }

    const listEl = document.getElementById('provider-list');
    if (listEl) {
        listEl.addEventListener('click', function (event) {
            const item = event.target.closest('.provider-list-item');
            if (!item) return;

            const providerId = item.getAttribute('data-provider-id');
            if (!providerId) return;

            const provider = allProviders.find(p => p.id === providerId);
            const marker = markerById[providerId];
            if (!provider || !marker || !map) return;

            map.setView([provider.latitude, provider.longitude], Math.max(map.getZoom(), 13));
            setSelectedMarker(marker);
            openSidebar(provider);
        });
    }
}

// Render the list of providers in the sidebar based on current filters
function renderProviderList(providers) {
    const listEl = document.getElementById('provider-list');
    if (!listEl) return;

    if (!providers || providers.length === 0) {
        listEl.innerHTML = '<p class="provider-list-empty">No providers match your filters.</p>';
        return;
    }

    const itemsHtml = providers.map(provider => {
        const typeLabel = provider.type ? provider.type.toUpperCase() : '';
        const locationLabel = provider.city || provider.address || '';
        const hasServices = Array.isArray(provider.services) && provider.services.length > 0;
        const hasSelfPay = hasServices && provider.services.some(s => s.selfPay);

        const serviceBadge = hasServices
            ? '<span class="list-badge list-badge-service">Services</span>'
            : '';
        const selfPayBadge = hasSelfPay
            ? '<span class="list-badge list-badge-selfpay">Self-pay</span>'
            : '';

        return `
            <div class="provider-list-item" data-provider-id="${provider.id}">
                <div class="provider-list-main">
                    <div class="provider-list-name">${provider.name}</div>
                    <div class="provider-list-meta">${typeLabel}${locationLabel ? ' · ' + locationLabel : ''}</div>
                </div>
                <div class="provider-list-tags">
                    ${serviceBadge}
                    ${selfPayBadge}
                </div>
            </div>
        `;
    }).join('');

    listEl.innerHTML = itemsHtml;
}

// Add markers to the map
function addMarkers(providers) {
    // Clear existing markers
    if (markerClusterGroup) {
        markerClusterGroup.clearLayers();
    } else {
        markers.forEach(marker => map.removeLayer(marker));
    }
    markers = [];
    markerById = {};

    // Clear any previous selection styling
    if (selectedMarker && selectedMarker._icon) {
        selectedMarker._icon.classList.remove('marker-selected');
    }
    selectedMarker = null;

    providers.forEach(provider => {
        const markerIcon = L.divIcon({
            html: `<div></div>`,
            className: `custom-marker type-${provider.type.toLowerCase()}`,
            iconSize: [30, 30],
            popupAnchor: [0, -15]
        });

        const marker = L.marker(
            [provider.latitude, provider.longitude],
            { icon: markerIcon }
        );

        // When a marker is clicked, highlight it and show details in the sidebar
        marker.on('click', function () {
            setSelectedMarker(marker);
            openSidebar(provider);
        });

        if (markerClusterGroup) {
            markerClusterGroup.addLayer(marker);
        } else {
            marker.addTo(map);
        }

        markers.push(marker);

        // Store references on marker for filtering and lookup
        marker.providerType = provider.type;
        marker.providerId = provider.id;
        markerById[provider.id] = marker;
    });
}

// Visually mark the currently selected marker on the map
function setSelectedMarker(marker) {
    // Remove highlight from previous marker
    if (selectedMarker && selectedMarker._icon) {
        selectedMarker._icon.classList.remove('marker-selected');
    }

    selectedMarker = marker;

    if (selectedMarker && selectedMarker._icon) {
        selectedMarker._icon.classList.add('marker-selected');
    }
}

// Create popup content for markers
function createPopup(provider) {
    const phoneLine = provider.phone
        ? `<p class="provider-detail"><strong>Phone:</strong> ${provider.phone}</p>`
        : '';

    const websiteLine = provider.website
        ? `<p class="provider-detail"><strong></strong> <a href="${provider.website}" target="_blank" rel="noopener noreferrer">Visit Website</a></p>`
        : '';

    // Services & prices section
    let servicesSection = '';
    if (Array.isArray(provider.services) && provider.services.length > 0) {
        const servicesItems = provider.services.map(service => {
            const priceBadge = service.price
                ? `<span class="badge badge-price">${service.price}</span>`
                : '';
            const selfPayBadge = `<span class="badge ${service.selfPay ? 'badge-selfpay' : 'badge-selfpay-no'}">${service.selfPay ? 'Self-pay' : 'Insurance only'}</span>`;
            return `
                <li class="service-item">
                    <span class="service-name">${service.name}</span>
                    <span class="service-badges">
                        ${priceBadge}
                        ${selfPayBadge}
                    </span>
                </li>
            `;
        }).join('');

        servicesSection = `
            <div class="services-container">
                <button type="button" class="services-toggle" onclick="toggleServices('${provider.id}', this)">Show Services</button>
                <div id="services-${provider.id}" class="services-section collapsed">
                    <h4 class="services-title">Services & Prices</h4>
                    <ul class="services-list">
                        ${servicesItems}
                    </ul>
                </div>
            </div>
        `;
    }

    return `
        <div class="provider-popup">
            <h3 class="provider-name">${provider.name}</h3>
            <div class="provider-type provider-type-${provider.type.toLowerCase()}">
                ${provider.type.toUpperCase()}
            </div>
            <p class="provider-detail">
                <strong>Address:</strong> ${provider.address}
            </p>
            ${phoneLine}
            ${websiteLine}
            ${servicesSection}
        </div>
    `;
}

// Setup filter dropdown listener
function setupFilterListener() {
    const filterDropdown = document.getElementById('filter-dropdown');

    filterDropdown.addEventListener('change', function (e) {
        const selectedFilter = e.target.value;
        filterMarkers(selectedFilter);
    });
}

// Filter markers based on selected type
function filterMarkers(filterType) {
    currentFilter = filterType;
    updateMarkers();
}

// Setup search input listener
function setupSearchListener() {
    const searchInput = document.getElementById('search-input');

    // Real-time search as user types
    searchInput.addEventListener('input', function (e) {
        // Only trigger automatic search if no postal code distance search is active
        currentSearch = e.target.value.toLowerCase();
        clearDistanceError();
        updateMarkers();
    });

    // Press Enter to search
    searchInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            const searchValue = searchInput.value.trim();
            const postalCodeValue = document.getElementById('postal-code-input').value.trim();
            if (!searchValue && !postalCodeValue) {
                showDistanceError('Please enter a city name or postal code.');
                return;
            }
            clearDistanceError();
            currentSearch = searchValue.toLowerCase();
            updateMarkers();
        }
    });
}

// Search providers based on name or address
function searchProviders(providers, query) {
    if (!query) {
        return providers;
    }
    return providers.filter(provider =>
        provider.name.toLowerCase().includes(query) ||
        provider.address.toLowerCase().includes(query)
    );
}

// Update markers based on current filter and search
function updateMarkers() {
    let filteredProviders = allProviders;

    // Apply type filter
    if (currentFilter !== 'all') {
        filteredProviders = filteredProviders.filter(provider =>
            provider.type.toLowerCase() === currentFilter.toLowerCase()
        );
    }

    // Apply search filter
    filteredProviders = searchProviders(filteredProviders, currentSearch);

    // Apply distance filter
    if (currentFilterLocation && currentFilterDistance) {
        filteredProviders = filterByDistance(filteredProviders, currentFilterLocation, currentFilterDistance);
    }

    // Update markers on map
    addMarkers(filteredProviders);

    // Adjust map view to ensure filtered markers are visible
    if (map && filteredProviders.length > 0) {
        const bounds = L.latLngBounds(
            filteredProviders.map(p => [p.latitude, p.longitude])
        );
        map.fitBounds(bounds, { padding: [40, 40] });
    }
}

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Filter providers by distance from a location
function filterByDistance(providers, location, distanceKm) {
    return providers.filter(provider => {
        const distance = calculateDistance(
            location.latitude,
            location.longitude,
            provider.latitude,
            provider.longitude
        );
        return distance <= distanceKm;
    });
}

// Geocode postal code to coordinates using Nominatim API
async function geocodePostalCode(postalCode) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(postalCode)}&country=de&format=json&limit=1`
        );
        const data = await response.json();
        if (data.length > 0) {
            return {
                latitude: parseFloat(data[0].lat),
                longitude: parseFloat(data[0].lon),
                name: data[0].display_name
            };
        }
        return null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}

function showDistanceError(message) {
    const errorEl = document.getElementById('distance-error');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function clearDistanceError() {
    const errorEl = document.getElementById('distance-error');
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.style.display = 'none';
}

// Perform distance-based search
async function performDistanceSearch() {
    const searchBtn = document.getElementById('distance-search-btn');
    const postalCodeInput = document.getElementById('postal-code-input');
    const distanceInput = document.getElementById('distance-input');
    const searchInput = document.getElementById('search-input');
    const postalCode = postalCodeInput.value.trim();
    const distance = parseInt(distanceInput.value) || 10;
    const citySearch = searchInput.value.trim();

    clearDistanceError();

    // Check if at least one search value is provided
    if (!postalCode && !citySearch) {
        showDistanceError('Please enter either a postal code, a city name or an address.');
        return;
    }

    // If postal code is provided, do geocoding and distance search
    if (postalCode) {
        // Show loading feedback
        searchBtn.disabled = true;
        searchBtn.textContent = 'Searching...';

        // Geocode the postal code
        const location = await geocodePostalCode(postalCode);
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';

        if (!location) {
            showDistanceError('Postal code not found. Please try another.');
            return;
        }

        // Set filter location and distance
        currentFilterLocation = location;
        currentFilterDistance = distance;
    } else {
        // If only city search is provided, clear distance filter
        currentFilterLocation = null;
        currentFilterDistance = null;
    }

    // Update markers with combined filters
    updateMarkers();
}

// Setup distance search listener
function setupDistanceSearchListener() {
    const searchBtn = document.getElementById('distance-search-btn');
    const postalCodeInput = document.getElementById('postal-code-input');
    const distanceInput = document.getElementById('distance-input');

    // Search button click event
    searchBtn.addEventListener('click', performDistanceSearch);

    // Enter key in postal code input
    postalCodeInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            performDistanceSearch();
        }
    });

    // Enter key in distance input
    distanceInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            performDistanceSearch();
        }
    });
}

// Map click handler is registered inside initMap for proper initialization
