const express = require('express');
const router = express.Router();

/**
 * Geocoding Relay Route
 * This bypasses CORS issues by performing the request server-side
 */
/**
 * Normalizes Tunisian addresses to handle common transliteration variations
 */
const normalizeTunisianQuery = (q) => {
    let query = q.toLowerCase();
    
    // Common transliteration swaps (manzah -> menzah, manza -> menza)
    query = query.replace(/\bmanzah\b/g, 'menzah');
    query = query.replace(/\bmanza\b/g, 'menza');
    
    // If it doesn't start with "el " but is a known neighborhood name, try adding it
    const commonNeighborhoods = ['menzah', 'marsa', 'kram', 'mourouj', 'agba', 'aouina'];
    commonNeighborhoods.forEach(name => {
        if (query.includes(name) && !query.startsWith('el ') && !query.includes(' el ')) {
            // We just ensure "el" is considered by the search engine
            // Deep search engines handle this well anyway
        }
    });

    return query;
};

/**
 * Geocoding Relay Route
 * Uses Photon for fast autocomplete, falls back to Nominatim for deep/fuzzy search
 */
router.get('/search', async (req, res) => {
    const { q, lat, lon } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query is required' });

    const normalizedQ = normalizeTunisianQuery(q);
    console.log(`🔍 Search: "${q}" -> normalized: "${normalizedQ}" (Bias: ${lat}, ${lon})`);
    
    const tunisiaBBox = "7.5,30.2,11.6,37.6";

    try {
        // 1. Primary Attempt: Photon (Fast & Typo Tolerant)
        let photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(normalizedQ)}&limit=10&lang=fr&bbox=${tunisiaBBox}`;
        if (lat && lon) photonUrl += `&lat=${lat}&lon=${lon}`;

        const photonRes = await fetch(photonUrl);
        let data = await photonRes.json();

        // 2. Fallback Attempt: Nominatim (Deep search, better with "El" and fragmented addresses)
        // If Photon returns few results, or if the user is typing a full address, we try Nominatim
        if (!data.features || data.features.length === 0) {
            console.log("   ⚠️ Photon returned no results. Trying Nominatim...");
            
            let nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(normalizedQ)}&format=json&limit=5&countrycodes=tn&accept-language=fr`;
            // Add viewbox/proximity if possible
            if (lat && lon) {
                // Nominatim uses viewbox=left,top,right,bottom
                const d = 0.1; // 10km radius approx
                nominatimUrl += `&viewbox=${parseFloat(lon)-d},${parseFloat(lat)+d},${parseFloat(lon)+d},${parseFloat(lat)-d}&bounded=0`;
            }

            const nomRes = await fetch(nominatimUrl, {
                headers: { 'User-Agent': 'Antigravity-PFE-Platform' }
            });
            const nomData = await nomRes.json();

            // Transform Nominatim JSON to GeoJSON for frontend compatibility
            if (nomData && nomData.length > 0) {
                data.features = nomData.map(item => ({
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [parseFloat(item.lon), parseFloat(item.lat)]
                    },
                    properties: {
                        name: item.display_name.split(',')[0],
                        street: item.address?.road || "",
                        city: item.address?.city || item.address?.town || item.address?.village || "",
                        country: "Tunisie"
                    }
                }));
            }
        }

        res.json(data);
    } catch (error) {
        console.error('Geocoding relay error:', error.message);
        res.status(500).json({ error: 'Search failed', details: error.message });
    }
});

/**
 * Reverse Geocoding Relay Route
 * Converts lat/lon coordinates into address components (Governorate, City)
 */
router.get('/reverse', async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Latitude and Longitude are required' });

    try {
        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fr`;
        const nomRes = await fetch(nominatimUrl, {
            headers: { 'User-Agent': 'Antigravity-PFE-Platform' }
        });
        const nomData = await nomRes.json();

        if (nomData && nomData.address) {
            const addr = nomData.address;
            
            // Extract governorate (state in Tunisia)
            let governorate = addr.state || addr.county || '';
            governorate = governorate.replace(/gouvernorat de\s+/gi, '').replace(/\s+governorate/gi, '').trim();

            const city = addr.city || addr.town || addr.village || addr.suburb || '';

            res.json({
                governorate,
                city,
                display_name: nomData.display_name,
                address: addr
            });
        } else {
            res.status(404).json({ error: 'Address not found for these coordinates' });
        }
    } catch (error) {
        console.error('Reverse geocoding error:', error.message);
        res.status(500).json({ error: 'Reverse geocoding failed', details: error.message });
    }
});

module.exports = router;
