const Entrepot = require("../models/Entrepot");

// Créer un nouvel entrepôt
exports.createEntrepot = async (req, res) => {
  try {
    const { nom, adresse, capacite } = req.body;

    const entrepot = await Entrepot.create({ nom, adresse, capacite });
    res.status(201).json(entrepot);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// Récupérer tous les entrepôts
exports.getAllEntrepots = async (req, res) => {
  try {
    const entrepots = await Entrepot.find();
    res.json(entrepots);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// Récupérer un entrepôt par ID
exports.getEntrepotById = async (req, res) => {
  try {
    const { id } = req.params;
    const entrepot = await Entrepot.findById(id);
    if (!entrepot) return res.status(404).json({ message: "Entrepôt introuvable" });
    res.json(entrepot);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

