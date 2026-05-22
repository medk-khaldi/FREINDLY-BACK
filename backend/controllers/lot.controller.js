const Lot = require('../models/Lot');

// Créer un nouveau lot
exports.creerLot = async (req, res) => {
  try {
    const { nom, quantite_unitaire, description } = req.body;

    // Vérifier si le lot existe déjà
    const lotExistant = await Lot.findOne({ nom });
    if (lotExistant) {
      return res.status(400).json({ message: 'Un lot avec ce nom existe déjà' });
    }

    const lot = new Lot({
      nom,
      quantite_unitaire,
      description
    });

    await lot.save();
    res.status(201).json(lot);
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la création du lot', error: error.message });
  }
};

// Récupérer tous les lots
exports.obtenirTousLesLots = async (req, res) => {
  try {
    const lots = await Lot.find().sort({ nom: 1 });
    res.json(lots);
  } catch (error) {
    console.error('Erreur récupération lots:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des lots', error: error.message });
  }
};

// Récupérer un lot par ID
exports.obtenirLotParId = async (req, res) => {
  try {
    const lot = await Lot.findById(req.params.id);
    if (!lot) {
      return res.status(404).json({ message: 'Lot non trouvé' });
    }
    res.json(lot);
  } catch (error) {
    console.error('Erreur récupération lot:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du lot', error: error.message });
  }
};

// Mettre à jour un lot
exports.mettreAJourLot = async (req, res) => {
  try {
    const { nom, quantite_unitaire, description } = req.body;

    const lot = await Lot.findByIdAndUpdate(
      req.params.id,
      { nom, quantite_unitaire, description },
      { new: true, runValidators: true }
    );

    if (!lot) {
      return res.status(404).json({ message: 'Lot non trouvé' });
    }

    res.json(lot);
  } catch (error) {
    console.error('Erreur mise à jour lot:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du lot', error: error.message });
  }
};

// Supprimer un lot
exports.supprimerLot = async (req, res) => {
  try {
    const lot = await Lot.findByIdAndDelete(req.params.id);
    if (!lot) {
      return res.status(404).json({ message: 'Lot non trouvé' });
    }
    res.json({ message: 'Lot supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression lot:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression du lot', error: error.message });
  }
};

