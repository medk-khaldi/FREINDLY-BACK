const Unite = require("../models/Unite"); // Assure-toi que le modèle existe

// 🔹 Créer une unité
exports.create = async (req, res) => {
    try {
        const unite = new Unite({
            nom: req.body.nom
        });
        const saved = await unite.save();
        res.status(201).json(saved);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Lister toutes les unités
exports.getAll = async (req, res) => {
    try {
        const unites = await Unite.find();
        res.status(200).json(unites);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Récupérer une unité par id
exports.getById = async (req, res) => {
    try {
        const unite = await Unite.findById(req.params.id);
        if (!unite) return res.status(404).json({ message: "Unité non trouvée" });
        res.status(200).json(unite);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Modifier une unité
exports.update = async (req, res) => {
    try {
        const updated = await Unite.findByIdAndUpdate(
            req.params.id,
            { nom: req.body.nom },
            { new: true }
        );
        res.status(200).json(updated);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Supprimer une unité (Soft Delete)
exports.delete = async (req, res) => {
    try {
        const unite = await Unite.findById(req.params.id);
        if (!unite) return res.status(404).json({ message: "Unité non trouvée" });
        
        await unite.softDelete();
        res.status(200).json({ message: "Unité supprimée (soft delete)" });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Restaurer une unité
exports.restore = async (req, res) => {
    try {
        const unite = await Unite.findOne({ _id: req.params.id, isDeleted: true }).setOptions({ withDeleted: true });
        if (!unite) return res.status(404).json({ message: "Unité supprimée non trouvée" });
        
        await unite.restore();
        res.status(200).json({ message: "Unité restaurée avec succès", unite });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

