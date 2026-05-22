const PointDeVente = require('../models/PointDeVente');

// Créer un point de vente réel
exports.create = async (req, res) => {
  try {
    const point = new PointDeVente({
      nom: req.body.nom,
      adresse: req.body.adresse,
      telephone: req.body.telephone,
      email: req.body.email,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      localisation_gps: req.body.localisation_gps,
      responsable_nom: req.body.responsable_nom,
      actif: true // Par défaut actif
    });
    await point.save();
    res.status(201).json(point); // renvoie le point créé
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Récupérer tous les points de vente approuvés
exports.getAll = async (req, res) => {
  try {
    // Par défaut, on ne retourne que les PDV approuvés pour éviter d'afficher des comptes non validés
    // dans les listes de commande ou de gestion standard.
    const points = await PointDeVente.find({ 
      $or: [
        { statut_validation: 'APPROUVE' },
        { statut_validation: { $exists: false } }
      ] 
    });
    res.json(points);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Récupérer un point de vente par ID
exports.getById = async (req, res) => {
  try {
    const point = await PointDeVente.findById(req.params.id);
    if (!point) {
      return res.status(404).json({ message: 'Point de vente introuvable' });
    }
    res.json(point);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Mettre à jour un point de vente
exports.update = async (req, res) => {
  try {
    const updateData = {
      nom: req.body.nom,
      adresse: req.body.adresse,
      telephone: req.body.telephone,
      email: req.body.email,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      localisation_gps: req.body.localisation_gps,
      responsable_nom: req.body.responsable_nom,
      classification: req.body.classification,
      segment: req.body.segment,
      categorie_client: req.body.categorie_client,
      notes_interne: req.body.notes_interne,
      actif: req.body.actif
    };
    
    // Supprimer les champs undefined
    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);
    
    const point = await PointDeVente.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!point) {
      return res.status(404).json({ message: 'Point de vente introuvable' });
    }
    
    res.json(point);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Désactiver un point de vente (au lieu de supprimer pour garder l'historique)
exports.delete = async (req, res) => {
  try {
    const point = await PointDeVente.findByIdAndUpdate(
      req.params.id,
      { actif: false },
      { new: true }
    );
    if (!point) {
      return res.status(404).json({ message: 'Point de vente introuvable' });
    }
    res.json({ message: 'Point de vente désactivé avec succès', point });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Réactiver un point de vente
exports.reactivate = async (req, res) => {
  try {
    const point = await PointDeVente.findByIdAndUpdate(
      req.params.id,
      { actif: true },
      { new: true }
    );
    if (!point) {
      return res.status(404).json({ message: 'Point de vente introuvable' });
    }
    res.json({ message: 'Point de vente réactivé avec succès', point });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Récupérer les inscriptions PDV en attente (et dont l'email est vérifié)
exports.getInscriptionsEnAttente = async (req, res) => {
  try {
    const points = await PointDeVente.find({ 
      statut_validation: 'EN_ATTENTE',
      isEmailVerified: true 
    });
    res.json(points);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Approuver une inscription PDV
exports.approuverInscription = async (req, res) => {
  try {
    const point = await PointDeVente.findByIdAndUpdate(
      req.params.id,
      { statut_validation: 'APPROUVE' },
      { new: true }
    );
    if (!point) {
      return res.status(404).json({ message: 'Point de vente introuvable' });
    }
    res.json({ message: 'Inscription approuvée avec succès', point });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Rejeter une inscription PDV
exports.rejeterInscription = async (req, res) => {
  try {
    const point = await PointDeVente.findByIdAndUpdate(
      req.params.id,
      { statut_validation: 'REJETE' },
      { new: true }
    );
    if (!point) {
      return res.status(404).json({ message: 'Point de vente introuvable' });
    }
    res.json({ message: 'Inscription rejetée avec succès', point });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
