const Format = require('../models/Format');

// Récupérer tous les formats
exports.getAllFormats = async (req, res) => {
  try {
    const formats = await Format.find().populate('lots').sort({ nom: 1 });
    res.json(formats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Créer un nouveau format
exports.createFormat = async (req, res) => {
  try {
    const { nom, volume } = req.body;
    
    if (!nom || nom.trim() === '') {
      return res.status(400).json({ message: 'Le nom du format est requis' });
    }

    const format = new Format({
      nom: nom.trim(),
      volume: volume || null
    });

    const newFormat = await format.save();
    res.status(201).json(newFormat);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Mettre à jour un format
exports.updateFormat = async (req, res) => {
  try {
    const { nom, volume } = req.body;
    
    const format = await Format.findById(req.params.id);
    if (!format) {
      return res.status(404).json({ message: 'Format non trouvé' });
    }

    if (nom) format.nom = nom.trim();
    if (volume !== undefined) format.volume = volume;
    if (req.body.lots !== undefined) format.lots = req.body.lots;

    const updatedFormat = await format.save();
    res.json(updatedFormat);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Supprimer un format (Soft Delete)
exports.deleteFormat = async (req, res) => {
  try {
    const format = await Format.findById(req.params.id);
    if (!format) {
      return res.status(404).json({ message: 'Format non trouvé' });
    }

    await format.softDelete();
    res.json({ message: 'Format supprimé (soft delete)' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Restaurer un format
exports.restoreFormat = async (req, res) => {
  try {
    const format = await Format.findOne({ _id: req.params.id, isDeleted: true }).options({ withDeleted: true });
    if (!format) {
      return res.status(404).json({ message: 'Format supprimé non trouvé' });
    }

    await format.restore();
    res.json({ message: 'Format restauré avec succès', format });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 Mettre à jour les lots d'un format (+ propagation rétroactive)
// PATCH /api/formats/:id/lots
exports.updateFormatLots = async (req, res) => {
  try {
    const { lots } = req.body; // Array of lot IDs
    const Produit = require('../models/Produit');
    
    const format = await Format.findById(req.params.id);
    if (!format) {
      return res.status(404).json({ message: 'Format non trouvé' });
    }

    format.lots = lots;
    await format.save();

    // Propagation rétroactive : REMPLACER les lots de tous les produits ayant ce format
    const result = await Produit.updateMany(
      { format: format._id },
      { $set: { lots: lots } }
    );

    console.log(`🔄 Sync lots format ${format.nom} : ${result.modifiedCount} produits mis à jour`);

    res.json({ 
      message: `Lots du format mis à jour. ${result.modifiedCount} produits synchronisés.`,
      format,
      updatedProductsCount: result.modifiedCount
    });
  } catch (err) {
    console.error('❌ Erreur updateFormatLots:', err);
    res.status(500).json({ message: err.message });
  }
};

