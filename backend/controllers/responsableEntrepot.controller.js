const ResponsableEntrepot = require("../models/ResponsableEntrepot");
const Utilisateur = require("../models/Utilisateur");

exports.creer = async (req, res) => {
  try {
    const { utilisateur, role } = req.body;
    if (!utilisateur) {
      return res.status(400).json({ message: "utilisateur (id) requis" });
    }
    const user = await Utilisateur.findById(utilisateur);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    const responsable = await ResponsableEntrepot.create({ utilisateur, role: role || "RESPONSABLE" });
    res.status(201).json(responsable);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.lister = async (req, res) => {
  try {
    const withDeleted = req.query.withDeleted === 'true';
    const query = ResponsableEntrepot.find();
    if (withDeleted) {
      query.setOptions({ withDeleted: true });
    }
    const responsables = await query
      .populate("utilisateur", "nom prenom email username isDeleted");
    res.json(responsables);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const responsable = await ResponsableEntrepot.findById(req.params.id)
      .populate("utilisateur");
    if (!responsable) return res.status(404).json({ message: "Responsable introuvable" });
    res.json(responsable);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.modifier = async (req, res) => {
  try {
    const update = {};
    if (req.body.utilisateur !== undefined) update.utilisateur = req.body.utilisateur;
    if (req.body.role !== undefined) update.role = req.body.role;
    const responsable = await ResponsableEntrepot.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    ).populate("utilisateur");
    if (!responsable) return res.status(404).json({ message: "Responsable introuvable" });
    res.json(responsable);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.supprimer = async (req, res) => {
  try {
    const responsable = await ResponsableEntrepot.findById(req.params.id);
    if (!responsable) return res.status(404).json({ message: "Responsable introuvable" });
    
    // Soft delete de l'utilisateur associé
    if (responsable.utilisateur) {
      const user = await Utilisateur.findById(responsable.utilisateur);
      if (user) await user.softDelete();
    }
    
    // Soft delete du responsable
    await responsable.softDelete();
    
    res.json({ message: "Responsable et utilisateur supprimés (soft delete)" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.restaurer = async (req, res) => {
  try {
    // Trouver le responsable supprimé
    const responsable = await ResponsableEntrepot.findOne({ _id: req.params.id, isDeleted: true }).setOptions({ withDeleted: true });
    if (!responsable) return res.status(404).json({ message: "Responsable supprimé introuvable" });
    
    // Restaurer l'utilisateur associé
    if (responsable.utilisateur) {
      const user = await Utilisateur.findOne({ _id: responsable.utilisateur, isDeleted: true }).setOptions({ withDeleted: true });
      if (user) await user.restore();
    }
    
    // Restaurer le responsable
    await responsable.restore();
    
    res.json({ message: "Responsable et utilisateur restaurés avec succès", responsable });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

