/**
 * routingService.js
 * OpenRouteService client module with node-cache caching integration.
 */
const axios = require("axios");
const NodeCache = require("node-cache");

// Cache routes for 2 hours (7200 seconds)
const routeCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

const ORS_BASE_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

/**
 * Generates a unique cache key based on route coordinates.
 */
function getRouteCacheKey(coordinates) {
  const hashString = coordinates
    .map(coord => `${coord[0].toFixed(5)},${coord[1].toFixed(5)}`)
    .join("|");
  
  // Return simple hash
  return `route_${Buffer.from(hashString).toString("base64").substring(0, 40)}`;
}

/**
 * Fetches directions from OpenRouteService.
 * @param {Array} coordinates - Array of coordinates in [lng, lat] format (GeoJSON style)
 * @returns {Promise<Object>} { polyline, distance (m), duration (s) }
 */
async function getDirections(coordinates) {
  if (!coordinates || coordinates.length < 2) {
    throw new Error("At least two coordinates are required for routing.");
  }

  // 1. Check in-memory cache
  const cacheKey = getRouteCacheKey(coordinates);
  const cachedRoute = routeCache.get(cacheKey);
  
  if (cachedRoute) {
    console.log("⚡ [CACHE HIT] Route retrieved from local cache memory.");
    return cachedRoute;
  }

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    throw new Error("ORS_API_KEY is not defined in environment variables.");
  }

  console.log(`🌐 [API CALL] Contacting OpenRouteService for ${coordinates.length} points...`);
  
  try {
    const response = await axios.post(
      ORS_BASE_URL,
      {
        coordinates: coordinates,
        elevation: false,
        instructions: false, // Turn off instructions to reduce payload size
        units: "m"
      },
      {
        headers: {
          "Accept": "application/json, application/geo+json; charset=utf-8",
          "Content-Type": "application/json",
          "Authorization": apiKey
        },
        timeout: 8000 // 8 seconds timeout
      }
    );

    const routeData = response.data.routes[0];
    const result = {
      polyline: routeData.geometry, // polyline encoded string
      distance: routeData.summary.distance, // in meters
      duration: routeData.summary.duration  // in seconds
    };

    // 2. Persist to cache
    routeCache.set(cacheKey, result);
    return result;

  } catch (error) {
    console.error("❌ OpenRouteService Request Failed:", error.response?.data || error.message);
    throw new Error(`Failed to calculate road routing: ${error.message}`);
  }
}

module.exports = {
  getDirections
};
