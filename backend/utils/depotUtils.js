const GlobalConfig = require("../models/GlobalConfig");

const DEFAULT_DEPOT = {
  nom: "Dépôt Central de Tunis",
  adresse: "Tunis, Tunisie",
  latitude: 36.8065,
  longitude: 10.1815
};

/**
 * Dynamically fetches the central depot coordinates and address from GlobalConfig.
 * Falls back seamlessly to the Tunis default coordinates if no database value exists.
 * Returns an object containing both coordinate formats (latitude/longitude and lat/lng)
 * to prevent any breaking changes in backend services.
 * 
 * @returns {Promise<Object>} { nom, adresse, latitude, longitude, lat, lng }
 */
async function getDepotCentral() {
  try {
    const config = await GlobalConfig.findOne({ key: "DEPOT_CENTRAL" });
    if (config && config.value) {
      const { nom, adresse, latitude, longitude } = config.value;
      return {
        nom: nom || DEFAULT_DEPOT.nom,
        adresse: adresse || DEFAULT_DEPOT.adresse,
        latitude: Number(latitude) || DEFAULT_DEPOT.latitude,
        longitude: Number(longitude) || DEFAULT_DEPOT.longitude,
        lat: Number(latitude) || DEFAULT_DEPOT.latitude,
        lng: Number(longitude) || DEFAULT_DEPOT.longitude
      };
    }
  } catch (error) {
    console.error("⚠️ Error fetching dynamic depot config:", error.message);
  }
  return {
    ...DEFAULT_DEPOT,
    lat: DEFAULT_DEPOT.latitude,
    lng: DEFAULT_DEPOT.longitude
  };
}

module.exports = {
  DEFAULT_DEPOT,
  getDepotCentral
};
