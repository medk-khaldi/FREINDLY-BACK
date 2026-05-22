const User = require("../models/Utilisateur");
const Client = require("../models/Client");
const PointDeVente = require("../models/PointDeVente");
const Produit = require("../models/Produit");
const StockConsolide = require("../models/StockConsolide");
const Avis = require("../models/Avis");

// 🔹 TOGGLE FAVORI (Ajouter ou supprimer)
exports.toggleFavori = async (req, res) => {
    try {
        const { produitId } = req.body;
        const userId = req.user.id;
        const userType = req.user.userType; // 'client', 'pdv', or 'staff'

        const Model = userType === 'client' ? Client : userType === 'pdv' ? PointDeVente : User;
        const user = await Model.findById(userId);

        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });

        const favoris = user.favoris || [];
        const index = favoris.findIndex(id => id.toString() === produitId.toString());
        let message = "";

        if (index === -1) {
            // Ajouter aux favoris
            user.favoris.push(produitId);
            message = "Produit ajouté aux favoris";
        } else {
            // Supprimer des favoris
            user.favoris.splice(index, 1);
            message = "Produit supprimé des favoris";
        }

        await user.save();
        res.status(200).json({ message, favoris: user.favoris });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 OBTENIR TOUS LES FAVORIS
exports.getFavoris = async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.userType;

        const Model = userType === 'client' ? Client : userType === 'pdv' ? PointDeVente : User;
        const user = await Model.findById(userId).populate({
            path: 'favoris',
            populate: [
                { path: 'categorie' },
                { path: 'marque' },
                { path: 'format' },
                { path: 'lots' },
                { path: 'promotionActive' }
            ]
        });

        if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });
        
        const rawFavoris = (user.favoris || [])
            .filter(f => f !== null && f.visibleMarketplace !== false)
            .map(f => f.toObject());
        const produitIds = rawFavoris.map(f => f._id);

        // Récupérer les stocks consolidés pour ces produits
        const stocksConsolides = await StockConsolide.find({ produit: { $in: produitIds } }).lean();
        const stockMap = {};
        stocksConsolides.forEach(s => {
            stockMap[s.produit.toString()] = s.quantite_disponible || 0;
        });

        // Récupérer les avis pour ces produits
        const avisStats = await Avis.aggregate([
            { $match: { produit: { $in: produitIds } } },
            {
                $group: {
                    _id: "$produit",
                    moyenneNote: { $avg: "$note" },
                    nombreAvis: { $sum: 1 }
                }
            }
        ]);
        const avisMap = {};
        avisStats.forEach(a => {
            avisMap[a._id.toString()] = {
                moyenneNote: a.moyenneNote,
                nombreAvis: a.nombreAvis
            };
        });

        // Enrichir les produits
        const enrichedFavoris = rawFavoris.map(p => ({
            ...p,
            stockDisponible: stockMap[p._id.toString()] || 0,
            moyenneNote: avisMap[p._id.toString()]?.moyenneNote || 0,
            nombreAvis: avisMap[p._id.toString()]?.nombreAvis || 0
        }));

        res.status(200).json(enrichedFavoris);
    } catch (error) {
        console.error("❌ Error in getFavoris:", error);
        res.status(500).json({ message: "Erreur serveur lors de la récupération des favoris", error: error.message });
    }
};
