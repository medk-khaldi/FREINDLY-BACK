const Camion = require("../models/Camion");

exports.creer = async (req, res) => {
  try {
    const { immatriculation, marque, modele, capacite } = req.body;
    if (!immatriculation) {
      return res.status(400).json({ message: "immatriculation requise" });
    }
    if (!marque) {
      return res.status(400).json({ message: "marque requise" });
    }
    if (!modele) {
      return res.status(400).json({ message: "modèle requis" });
    }
    const camion = await Camion.create({ 
      immatriculation, 
      marque, 
      modele, 
      capacite: capacite || null 
    });
    res.status(201).json(camion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.lister = async (req, res) => {
  try {
    const camions = await Camion.find().populate("chauffeur_assigne", "utilisateur");
    res.json(camions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const camion = await Camion.findById(req.params.id).populate("chauffeur_assigne");
    if (!camion) return res.status(404).json({ message: "Camion introuvable" });
    res.json(camion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.modifier = async (req, res) => {
  try {
    const camion = await Camion.findById(req.params.id);
    if (!camion) return res.status(404).json({ message: "Camion introuvable" });

    // ✅ Validation: Impossible de modifier SEULEMENT le statut d'un camion EN_COURS manuellement
    // Les autres champs peuvent être modifiés
    if (camion.statut === 'EN_COURS' && req.body.statut && req.body.statut !== 'EN_COURS') {
      return res.status(400).json({ 
        message: "Impossible de modifier le statut d'un camion en cours de voyage. Le voyage doit d'abord être terminé." 
      });
    }

    const update = {};
    if (req.body.immatriculation !== undefined) update.immatriculation = req.body.immatriculation;
    if (req.body.marque !== undefined) update.marque = req.body.marque;
    if (req.body.modele !== undefined) update.modele = req.body.modele;
    if (req.body.capacite !== undefined) update.capacite = req.body.capacite;
    
    // Ne mettre à jour le statut que si le camion n'est pas EN_COURS ou si on ne change pas le statut
    if (req.body.statut !== undefined) {
      if (camion.statut !== 'EN_COURS' || req.body.statut === 'EN_COURS') {
        update.statut = req.body.statut;
      }
    }
    
    if (req.body.chauffeur_assigne !== undefined) update.chauffeur_assigne = req.body.chauffeur_assigne;
    
    const updatedCamion = await Camion.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    res.json(updatedCamion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.supprimer = async (req, res) => {
  try {
    const camion = await Camion.findById(req.params.id);
    if (!camion) return res.status(404).json({ message: "Camion introuvable" });
    
    await camion.softDelete();
    res.json({ message: "Camion supprimé (soft delete)" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.restaurer = async (req, res) => {
  try {
    const camion = await Camion.findOne({ _id: req.params.id, isDeleted: true }).setOptions({ withDeleted: true });
    if (!camion) return res.status(404).json({ message: "Camion supprimé introuvable" });
    
    await camion.restore();
    res.json({ message: "Camion restauré avec succès", camion });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

