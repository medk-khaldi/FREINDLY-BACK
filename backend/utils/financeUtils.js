/**
 * financeUtils.js - Source unique de vérité pour tous les calculs financiers (Backend)
 */

/**
 * Calcule le sous-total des lignes (somme brute des articles)
 * @param {Array} lignes - Lignes de commande ou de livraison
 * @param {Object} options - { excludeEchec: boolean, commandeLignes: Array }
 * @returns {number} Le sous-total calculé
 */
function calculateSubtotal(lignes, options = {}) {
    const { excludeEchec = false, commandeLignes = [] } = options;
    
    if (!lignes || lignes.length === 0) return 0;

    return lignes.reduce((sum, ligne) => {
        // Ignorer si le produit est en échec (pour les livraisons)
        if (excludeEchec && ligne.statut_produit === 'ECHEC') {
            return sum;
        }

        // Récupérer le prix unitaire
        // Si absent de la ligne (cas fréquent lors de la création), chercher dans les lignes de commande
        let prix = ligne.prix_unitaire;
        
        if (prix === undefined && commandeLignes.length > 0) {
            const prodId = (ligne.produit?._id || ligne.produit)?.toString();
            const matchingCmdLine = commandeLignes.find(lc => 
                (lc.produit?._id || lc.produit)?.toString() === prodId
            );
            prix = matchingCmdLine?.prix_unitaire;
        }

        prix = prix || 0;
        
        // Quantité en unités individuelles
        const qte = (ligne.quantite !== undefined) ? ligne.quantite : 0;
        
        return sum + (qte * prix);
    }, 0);
}

function calculateOrderTotal({ lignes, fraisLivraison = 0, codePromo = null, fidelite = null }) {
    const sousTotal = calculateSubtotal(lignes);
    
    const remisePromo = codePromo?.reduction || 0;
    const remiseFidelite = fidelite?.reduction || 0;
    
    // ✅ RÈGLE: Livraison Gratuite si sous-total > 100 DT
    let frais = Number(fraisLivraison) || 0;
    if (sousTotal >= 100) {
        frais = 0;
    }

    const total = Math.max(0, sousTotal + frais - remisePromo - remiseFidelite);

    return {
        sousTotal: Number(sousTotal.toFixed(3)),
        fraisLivraison: Number(frais.toFixed(3)),
        remisePromo: Number(remisePromo.toFixed(3)),
        remiseFidelite: Number(remiseFidelite.toFixed(3)),
        total: Number(total.toFixed(3))
    };
}

/**
 * Calcule le montant d'une livraison
 * @param {Object} livraison - Objet livraison (avec commande populée)
 * @param {Object} options - { excludeEchec: boolean }
 * @returns {Object} Le détail financier complet
 */
function calculateLivraisonTotal(livraison, options = { excludeEchec: true }) {
    if (!livraison) return { total: 0 };

    // 1. Déterminer les lignes et les prix de référence
    const lignes = (livraison.lignesLivraison && livraison.lignesLivraison.length > 0) 
        ? livraison.lignesLivraison 
        : [];
    
    const commandeLignes = livraison.commande?.lignesCommande || [];

    const sousTotal = calculateSubtotal(lignes, { 
        excludeEchec: options.excludeEchec,
        commandeLignes: commandeLignes
    });

    // 2. Gestion des frais et remises (Uniquement pour Marketplace)
    const cmd = livraison.commande;
    const isMarketplace = !!(cmd?.client);
    
    if (isMarketplace && cmd) {
        // ✅ RÈGLE: Livraison Gratuite si sous-total > 100 DT
        let frais = cmd.fraisLivraison !== undefined ? cmd.fraisLivraison : 8;
        if (sousTotal >= 100) {
            frais = 0;
        }

        const remisePromo = cmd.codePromo?.reduction || 0;
        const remiseFidelite = cmd.fidelite?.reduction || 0;

        const total = Math.max(0, sousTotal + frais - remisePromo - remiseFidelite);

        return {
            sousTotal: Number(sousTotal.toFixed(3)),
            fraisLivraison: Number(frais.toFixed(3)),
            remisePromo: Number(remisePromo.toFixed(3)),
            remiseFidelite: Number(remiseFidelite.toFixed(3)),
            total: Number(total.toFixed(3))
        };
    }


    // Pour B2B / PDV — Appliquer les mêmes règles de frais
    let frais = cmd?.fraisLivraison !== undefined ? cmd.fraisLivraison : (sousTotal >= 100 ? 0 : 8);
    if (sousTotal >= 100) frais = 0;

    return {
        sousTotal: Number(sousTotal.toFixed(3)),
        fraisLivraison: Number(frais.toFixed(3)),
        remisePromo: 0,
        remiseFidelite: 0,
        total: Number((sousTotal + frais).toFixed(3))
    };
}

/**
 * Calcule le total d'une ligne (produit * quantité) avec promotions
 */
function calculateLineTotal(produit, quantite = 1, selectedLot = null) {
    if (!produit) return 0;
    
    const unitPrice = produit.prix_reference || produit.prix || 0;
    const lotSize = (selectedLot && selectedLot.quantite_unitaire) || 1;
    const totalUnits = quantite * lotSize;

    const promo = produit.promotionActive;
    
    // Pas de promo active
    if (!promo || !promo.actif) return Number((unitPrice * totalUnits).toFixed(3));
    
    const now = new Date();
    if (new Date(promo.dateDebut) > now || new Date(promo.dateFin) < now) return Number((unitPrice * totalUnits).toFixed(3));

    if (promo.type === 'PRIX') {
        const discountedUnitPrice = promo.isPercentage 
            ? unitPrice * (1 - (promo.reductionValeur || 0) / 100)
            : Math.max(0, unitPrice - (promo.reductionValeur || 0));
        return Number((discountedUnitPrice * totalUnits).toFixed(3));
    }

    if (promo.type === 'QUANTITE') {
        if (totalUnits >= (promo.quantiteMin || 0)) {
            if (promo.actionQuantite === 'GRATUIT') {
                const patternSize = (promo.quantiteMin || 0) + (promo.quantiteGratuite || 0);
                if (patternSize > 0) {
                    const freeUnits = Math.floor(totalUnits / patternSize) * (promo.quantiteGratuite || 0);
                    return Number((unitPrice * (totalUnits - freeUnits)).toFixed(3));
                }
            } else if (promo.actionQuantite === 'REDUCTION_LOT') {
                return Number(((unitPrice * totalUnits) * (1 - (promo.reductionLotValeur || 0) / 100)).toFixed(3));
            }
        }
    }

    return Number((unitPrice * totalUnits).toFixed(3));
}

/**
 * Calcule le prix unitaire d'un produit en tenant compte des promotions actives
 * (Utilisé pour le stockage en DB)
 */
function calculateProductPrice(produit, quantite = 1, selectedLot = null) {
    const total = calculateLineTotal(produit, quantite, selectedLot);
    return Number((total / (quantite || 1)).toFixed(6));
}

module.exports = {
    calculateSubtotal,
    calculateOrderTotal,
    calculateLivraisonTotal,
    calculateProductPrice,
    calculateLineTotal
};
