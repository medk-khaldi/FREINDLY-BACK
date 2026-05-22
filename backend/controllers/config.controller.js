const GlobalConfig = require("../models/GlobalConfig");

// 🔹 Obtenir une configuration par clé
exports.getConfig = async (req, res) => {
  try {
    const { key } = req.params;
    let config = await GlobalConfig.findOne({ key });
    
    // Si la clé n'existe pas, on peut renvoyer une valeur par défaut ou 404
    if (!config) {
      if (key === 'MIN_ORDER_AMOUNT') {
        return res.json({ key, value: 100 }); // Valeur par défaut hardcodée si non en DB
      }
      if (key === 'LOYALTY_CONFIG') {
        return res.json({ key, value: {
          pointsParDT: 10, pointsParAvis: 50, bonusInscription: 100,
          valeurPoint: 0.01, seuilSilver: 1000, seuilGold: 5000,
          multiplicateurSilver: 1.5, multiplicateurGold: 2.0
        }});
      }
      if (key === 'DELIVERY_FEE') {
        return res.json({ key, value: 8 });
      }
      if (key === 'FREE_SHIPPING_THRESHOLD') {
        return res.json({ key, value: 100 });
      }
      if (key === 'DEPOT_CENTRAL') {
        const { DEFAULT_DEPOT } = require("../utils/depotUtils");
        return res.json({ key, value: DEFAULT_DEPOT });
      }
      return res.status(404).json({ message: "Configuration non trouvée" });
    }
    
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 Mettre à jour ou créer une configuration
exports.updateConfig = async (req, res) => {
  try {
    const { key, value, description } = req.body;
    const userId = req.user.id;

    let config = await GlobalConfig.findOneAndUpdate(
      { key },
      { value, description, updatedBy: userId },
      { new: true, upsert: true }
    );

    res.json({ message: "Configuration mise à jour", config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 Obtenir toutes les configurations
exports.getAllConfigs = async (req, res) => {
  try {
    const configs = await GlobalConfig.find();
    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
