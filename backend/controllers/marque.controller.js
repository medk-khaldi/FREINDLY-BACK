const Marque = require("../models/MarqueProduit"); // Assure-toi que le modèle existe

// 🔹 Créer une marque
exports.create = async (req, res) => {
    try {
        const marque = new Marque({
            nom: req.body.nom
        });
        const saved = await marque.save();
        res.status(201).json(saved);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Lister toutes les marques
exports.getAll = async (req, res) => {
    try {
        const marques = await Marque.find();
        res.status(200).json(marques);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Récupérer une marque par id
exports.getById = async (req, res) => {
    try {
        const marque = await Marque.findById(req.params.id);
        if (!marque) return res.status(404).json({ message: "Marque non trouvée" });
        res.status(200).json(marque);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Modifier une marque
exports.update = async (req, res) => {
    try {
        const updated = await Marque.findByIdAndUpdate(
            req.params.id,
            { nom: req.body.nom },
            { new: true }
        );
        res.status(200).json(updated);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 Supprimer une marque (Hard Delete)
exports.delete = async (req, res) => {
    try {
        const deleted = await Marque.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Marque non trouvée" });
        
        res.status(200).json({ message: "Marque supprimée définitivement" });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

