const Avis = require('../models/Avis');
const mongoose = require('mongoose');

// 🔹 OBTENIR LES AVIS D'UN PRODUIT
exports.getAvisByProduct = async (req, res) => {
    try {
        const { produitId } = req.params;
        const { sort } = req.query;

        let sortQuery = { createdAt: -1 }; // Défaut: plus récents
        if (sort === 'note') {
            sortQuery = { note: -1, createdAt: -1 };
        }

        const avis = await Avis.find({ produit: produitId })
            .populate('client', 'nom prenom userType')
            .sort(sortQuery);

        res.status(200).json(avis);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 OBTENIR LES STATISTIQUES D'AVIS
exports.getStatsForProduct = async (req, res) => {
    try {
        const { produitId } = req.params;
        
        const stats = await Avis.aggregate([
            { $match: { produit: new mongoose.Types.ObjectId(produitId) } },
            { 
                $group: {
                    _id: null,
                    moyenneNote: { $avg: "$note" },
                    nombreTotal: { $sum: 1 },
                    note5: { $sum: { $cond: [{ $eq: ["$note", 5] }, 1, 0] } },
                    note4: { $sum: { $cond: [{ $eq: ["$note", 4] }, 1, 0] } },
                    note3: { $sum: { $cond: [{ $eq: ["$note", 3] }, 1, 0] } },
                    note2: { $sum: { $cond: [{ $eq: ["$note", 2] }, 1, 0] } },
                    note1: { $sum: { $cond: [{ $eq: ["$note", 1] }, 1, 0] } },
                }
            }
        ]);

        if (stats.length === 0) {
            return res.status(200).json({
                moyenneNote: 0,
                nombreTotal: 0,
                repartitionNotes: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
            });
        }

        const result = stats[0];
        res.status(200).json({
            moyenneNote: result.moyenneNote,
            nombreTotal: result.nombreTotal,
            repartitionNotes: {
                5: result.note5,
                4: result.note4,
                3: result.note3,
                2: result.note2,
                1: result.note1
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 OBTENIR MON AVIS SUR UN PRODUIT
exports.getMyAvis = async (req, res) => {
    try {
        const { produitId } = req.params;
        const userId = req.user.id;

        const avis = await Avis.findOne({ 
            client: userId, 
            produit: produitId,
            userModel: req.user.userType === 'pdv' ? 'PointDeVente' : 'Client'
        });
        if (!avis) return res.status(404).json({ message: "Aucun avis trouvé" });

        res.status(200).json(avis);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 CRÉER UN AVIS
exports.createAvis = async (req, res) => {
    try {
        const { produitId, note, commentaire } = req.body;
        const userId = req.user.id;
        const userType = req.user.userType;

        if (userType !== 'client' && userType !== 'pdv') {
            return res.status(403).json({ message: "Seuls les clients et points de vente peuvent laisser des avis" });
        }

        const userModel = userType === 'pdv' ? 'PointDeVente' : 'Client';
        
        // Vérifier si un avis existe déjà
        const existing = await Avis.findOne({ client: userId, produit: produitId, userModel });
        if (existing) {
            return res.status(400).json({ message: "Vous avez déjà noté ce produit" });
        }

        const newAvis = new Avis({
            client: userId,
            userModel,
            produit: produitId,
            note,
            commentaire
        });

        await newAvis.save();

        // 🎯 FIDÉLITÉ: Points pour avis posté
        try {
            const { earnPoints, getPointsConfig } = require('../services/pointsService');
            const config = await getPointsConfig();
            await earnPoints(userId, config.pointsParAvis || 50, `Avis posté`);
        } catch (pointsErr) {
            console.error('❌ Erreur points avis:', pointsErr);
        }

        res.status(201).json(newAvis);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 MODIFIER UN AVIS
exports.updateAvis = async (req, res) => {
    try {
        const { id } = req.params;
        const { note, commentaire } = req.body;
        const userId = req.user.id;

        const avis = await Avis.findById(id);
        if (!avis) return res.status(404).json({ message: "Avis non trouvé" });

        // Vérifier la propriété
        if (avis.client.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Action non autorisée" });
        }

        avis.note = note;
        avis.commentaire = commentaire;
        await avis.save();

        res.status(200).json(avis);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 SUPPRIMER UN AVIS
exports.deleteAvis = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const avis = await Avis.findById(id);
        if (!avis) return res.status(404).json({ message: "Avis non trouvé" });

        // Vérifier la propriété
        if (avis.client.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Action non autorisée" });
        }

        await Avis.findByIdAndDelete(id);
        res.status(200).json({ message: "Avis supprimé avec succès" });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};
