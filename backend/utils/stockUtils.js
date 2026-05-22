const Stock = require('../models/Stock');
const StockConsolide = require('../models/StockConsolide');

/**
 * Ajouter une quantité au stock consolidé d'un produit
 * LOGIQUE SIMPLE: Ajoute directement la quantité au stock total consolidé du produit
 * 
 * @param {String} produitId - ID du produit
 * @param {Number} quantite - Quantité à ajouter (peut être négative pour réduire)
 * @param {String} entrepotId - ID de l'entrepôt (optionnel, utilise l'entrepôt par défaut si null)
 * @param {Object} options - Options supplémentaires (ignorées)
 * @returns {Object} - Stock consolidé mis à jour
 */
async function ajouterStockConsolide(produitId, quantite, entrepotId = null, options = {}) {
  try {
    // Obtenir ou créer le stock consolidé pour ce produit
    const stockConsolide = await StockConsolide.obtenirOuCreer(produitId, entrepotId);
    
    const ancienneQuantite = stockConsolide.quantite_totale;
    
    // Ajouter la quantité au stock total (peut être négative)
    if (quantite >= 0) {
      await stockConsolide.ajouterStock(quantite);
    } else {
      // Quantité négative = réduction de stock
      await stockConsolide.retirerStock(Math.abs(quantite));
    }
    
    console.log(`📦 Stock consolidé mis à jour: ${ancienneQuantite} → ${stockConsolide.quantite_totale} (${quantite >= 0 ? '+' : ''}${quantite} unités)`);
    console.log(`   Disponible: ${stockConsolide.quantite_disponible} unités (total ${stockConsolide.quantite_totale} - réservé ${stockConsolide.quantite_reservee})`);
    
    return stockConsolide;

  } catch (error) {
    console.error('❌ Erreur lors de l\'ajout de stock consolidé:', error);
    throw error;
  }
}

/**
 * Réserver une quantité de stock pour un produit
 * 
 * @param {String} produitId - ID du produit
 * @param {Number} quantite - Quantité à réserver
 * @returns {Boolean} - Succès de l'opération
 */
async function reserverStockConsolide(produitId, quantite) {
  try {
    const stockConsolide = await StockConsolide.findOne({ produit: produitId });
    
    if (!stockConsolide) {
      console.warn(`⚠️ Stock consolidé non trouvé pour le produit ${produitId}`);
      return false;
    }
    
    await stockConsolide.reserverStock(quantite);
    console.log(`🔒 Réservé ${quantite} unités pour produit ${produitId} (réservé total: ${stockConsolide.quantite_reservee})`);
    
    return true;
  } catch (error) {
    console.error('❌ Erreur lors de la réservation de stock consolidé:', error);
    return false;
  }
}

/**
 * Libérer une quantité du stock réservé d'un produit
 * 
 * @param {String} produitId - ID du produit
 * @param {Number} quantite - Quantité à libérer
 * @returns {Boolean} - Succès de l'opération
 */
async function libererStockReserveConsolide(produitId, quantite) {
  try {
    const stockConsolide = await StockConsolide.findOne({ produit: produitId });
    
    if (!stockConsolide) {
      console.warn(`⚠️ Stock consolidé non trouvé pour le produit ${produitId}`);
      return false;
    }
    
    await stockConsolide.libererStockReserve(quantite);
    console.log(`🔓 Libéré ${quantite} unités réservées pour produit ${produitId} (réservé restant: ${stockConsolide.quantite_reservee})`);
    
    return true;
  } catch (error) {
    console.error('❌ Erreur lors de la libération de stock réservé consolidé:', error);
    return false;
  }
}

/**
 * Obtenir le stock consolidé d'un produit
 * 
 * @param {String} produitId - ID du produit
 * @returns {Object} - Informations consolidées du stock
 */
async function getStockConsolide(produitId) {
  try {
    // Utiliser le nouveau modèle StockConsolide
    const stockConsolide = await StockConsolide.findOne({ produit: produitId })
      .populate('produit')
      .populate('entrepot');
    
    if (!stockConsolide) {
      return {
        quantite_totale: 0,
        quantite_reservee: 0,
        quantite_retournee: 0,
        quantite_disponible: 0,
        nombre_stocks: 0,
        stocks_details: []
      };
    }
    
    return {
      quantite_totale: stockConsolide.quantite_totale,
      quantite_reservee: stockConsolide.quantite_reservee,
      quantite_retournee: stockConsolide.quantite_retournee,
      quantite_disponible: stockConsolide.quantite_disponible,
      nombre_stocks: 1, // Un seul enregistrement consolidé
      stocks_details: [{
        stock_id: stockConsolide._id,
        entrepot: stockConsolide.entrepot,
        quantite: stockConsolide.quantite_totale,
        quantite_reservee: stockConsolide.quantite_reservee,
        quantite_retournee: stockConsolide.quantite_retournee,
        quantite_disponible: stockConsolide.quantite_disponible
      }]
    };
  } catch (error) {
    console.error('❌ Erreur lors de la récupération du stock consolidé:', error);
    throw error;
  }
}

module.exports = {
  ajouterStockConsolide,
  reserverStockConsolide,
  libererStockReserveConsolide,
  getStockConsolide
};