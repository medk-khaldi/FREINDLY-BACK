const Promotion = require("../models/Promotion");
const Produit = require("../models/Produit");

// 🔹 CRÉER UNE PROMOTION
exports.createPromotion = async (req, res) => {
    try {
        const { 
            produit, type, reductionValeur, isPercentage, 
            quantiteMin, quantiteGratuite, actionQuantite, 
            reductionLotValeur, dateDebut, dateFin, description 
        } = req.body;

        // Désactiver les promos existantes pour ce produit (Règle : une seule promo à la fois)
        await Promotion.updateMany({ produit, actif: true }, { actif: false });

        const promotion = await Promotion.create({
            produit, type, reductionValeur, isPercentage,
            quantiteMin, quantiteGratuite, actionQuantite,
            reductionLotValeur, dateDebut, dateFin, description
        });

        // Lier la promo au produit
        await Produit.findByIdAndUpdate(produit, { promotionActive: promotion._id });

        res.status(201).json(promotion);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la création de la promotion", error: error.message });
    }
};

// 🔹 OBTENIR TOUTES LES PROMOTIONS (POUR LE RESPONSABLE)
exports.getAllPromotions = async (req, res) => {
    try {
        const promotions = await Promotion.find()
            .populate('produit', 'nom prix_reference image')
            .sort({ createdAt: -1 });
        res.status(200).json(promotions);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 SUPPRIMER UNE PROMOTION
exports.deletePromotion = async (req, res) => {
    try {
        const promo = await Promotion.findById(req.params.id);
        if (!promo) return res.status(404).json({ message: "Promotion non trouvée" });

        // Détacher du produit
        await Produit.findByIdAndUpdate(promo.produit, { promotionActive: null });
        
        await Promotion.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Promotion supprimée" });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 TOGGLE STATUT (ACTIF/INACTIF)
exports.toggleStatus = async (req, res) => {
    try {
        const promo = await Promotion.findById(req.params.id);
        if (!promo) return res.status(404).json({ message: "Promotion non trouvée" });

        const newStatus = !promo.actif;
        await Promotion.findByIdAndUpdate(req.params.id, { actif: newStatus });
        
        // Si on désactive, on détache aussi du produit pour l'affichage marketplace
        if (!newStatus) {
            await Produit.findByIdAndUpdate(promo.produit, { promotionActive: null });
        } else {
            // Si on active, on s'assure qu'elle est liée
            await Produit.findByIdAndUpdate(promo.produit, { promotionActive: promo._id });
        }

        res.status(200).json({ message: "Statut mis à jour", actif: newStatus });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// 🔹 MODIFIER UNE PROMOTION
exports.updatePromotion = async (req, res) => {
    try {
        const { 
            produit, type, reductionValeur, isPercentage, 
            quantiteMin, quantiteGratuite, actionQuantite, 
            reductionLotValeur, dateDebut, dateFin, description, actif 
        } = req.body;

        const promo = await Promotion.findById(req.params.id);
        if (!promo) return res.status(404).json({ message: "Promotion non trouvée" });

        // Si le produit a changé, gérer les liaisons
        if (produit && produit !== promo.produit.toString()) {
            // Détacher l'ancien produit
            await Produit.findByIdAndUpdate(promo.produit, { promotionActive: null });
            // Lier le nouveau
            await Produit.findByIdAndUpdate(produit, { promotionActive: promo._id });
        }

        const updatedPromo = await Promotion.findByIdAndUpdate(
            req.params.id,
            { 
                produit, type, reductionValeur, isPercentage, 
                quantiteMin, quantiteGratuite, actionQuantite, 
                reductionLotValeur, dateDebut, dateFin, description, actif 
            },
            { new: true }
        );

        res.status(200).json(updatedPromo);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la mise à jour", error: error.message });
    }
};
