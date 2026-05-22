const DriverTracking = require("../models/DriverTracking");

/**
 * Récupérer tous les chauffeurs actifs (en ligne ou en livraison)
 */
exports.getActiveDrivers = async (req, res) => {
  try {
    const activeDrivers = await DriverTracking.find({
      status: { $in: ["online", "delivering"] }
    })
    .populate({
      path: "chauffeurId",
      populate: { path: "utilisateur", select: "username email" }
    })
    .populate({
      path: "voyageId",
      select: "numero_voyage id_formate statut"
    });

    res.json(activeDrivers);
  } catch (error) {
    console.error("Error fetching active drivers:", error);
    res.status(500).json({ message: "Erreur lors de la récupération des chauffeurs actifs" });
  }
};

/**
 * Récupérer le statut de tracking d'un chauffeur spécifique
 */
exports.getDriverStatus = async (req, res) => {
  try {
    const { chauffeurId } = req.params;
    const tracking = await DriverTracking.findOne({ chauffeurId })
      .populate("voyageId");

    if (!tracking) {
      return res.status(404).json({ message: "Aucune donnée de tracking pour ce chauffeur" });
    }

    res.json(tracking);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur" });
  }
};
