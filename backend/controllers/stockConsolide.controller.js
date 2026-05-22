const StockConsolide = require('../models/StockConsolide');
const Produit = require('../models/Produit');
const Entrepot = require('../models/Entrepot');
const CategorieProduit = require('../models/CategorieProduit');
const MarqueProduit = require('../models/MarqueProduit');
const Unite = require('../models/Unite');
const Format = require('../models/Format');

/**
 * Lister tous les stocks consolidés
 */
const lister = async (req, res) => {
  try {
    console.log('--- [DEBUG] LISTER STOCK CONSOLIDE START ---');
    
    // 1. Récupérer TOUS les produits non supprimés
    const produits = await Produit.find({ isDeleted: { $ne: true } })
      .populate('categorie marque unite format')
      .lean();
    
    console.log(`[DEBUG] Produits trouvés dans la collection Produit: ${produits.length}`);

    // 2. Récupérer tous les stocks consolidés existants
    const stocksConsolides = await StockConsolide.find().populate('entrepot').lean();
    console.log(`[DEBUG] Records StockConsolide trouvés: ${stocksConsolides.length}`);

    // 3. Migration/Correction à la volée pour quantite_entree_totale
    const bulkUpdates = [];
    stocksConsolides.forEach(s => {
      if (s.quantite_entree_totale === undefined) {
        bulkUpdates.push({
          updateOne: {
            filter: { _id: s._id },
            update: { $set: { quantite_entree_totale: s.quantite_totale || 0 } }
          }
        });
        s.quantite_entree_totale = s.quantite_totale || 0;
      }
    });

    if (bulkUpdates.length > 0) {
      console.log(`[DEBUG] Migration de ${bulkUpdates.length} records existants...`);
      await StockConsolide.bulkWrite(bulkUpdates);
    }

    // 4. Créer une map pour la fusion
    const stockMap = new Map();
    stocksConsolides.forEach(s => {
      if (s.produit) {
        stockMap.set(s.produit.toString(), s);
      }
    });

    // 5. Fusionner pour garantir que CHAQUE produit a une ligne
    const result = produits.map(p => {
      const stock = stockMap.get(p._id.toString());
      if (stock) {
        return {
          ...stock,
          produit: p, // Utiliser l'objet produit frais et populé
          virtuel: false
        };
      } else {
        return {
          produit: p,
          quantite_totale: 0,
          quantite_reservee: 0,
          quantite_retournee: 0,
          quantite_disponible: 0,
          quantite_entree_totale: 0,
          virtuel: true
        };
      }
    });

    console.log(`[DEBUG] Resultat final envoyé au frontend: ${result.length} items`);
    console.log('--- [DEBUG] LISTER STOCK CONSOLIDE END ---');

    res.setHeader('X-Debug-Count', result.length);
    res.json(result);
  } catch (err) {
    console.error('❌ Erreur liste stocks consolidés:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

/**
 * Obtenir le stock consolidé d'un produit spécifique
 */
const getByProduit = async (req, res) => {
  try {
    const { produitId } = req.params;

    const stockConsolide = await StockConsolide.findOne({ produit: produitId })
      .populate({
        path: 'produit',
        populate: [
          { path: 'categorie' },
          { path: 'marque' },
          { path: 'unite' },
          { path: 'format' }
        ]
      })
      .populate('entrepot');

    if (!stockConsolide) {
      return res.status(404).json({ message: 'Stock consolidé introuvable pour ce produit' });
    }

    res.json(stockConsolide);
  } catch (err) {
    console.error('❌ Erreur récupération stock consolidé:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

/**
 * Ajouter une quantité au stock consolidé
 */
const ajouterQuantite = async (req, res) => {
  try {
    const { produitId } = req.params;
    const { quantite } = req.body;

    if (!quantite || quantite <= 0) {
      return res.status(400).json({ message: 'La quantité doit être supérieure à 0' });
    }

    // Obtenir ou créer le stock consolidé
    const stockConsolide = await StockConsolide.obtenirOuCreer(produitId);
    
    const ancienneQuantite = stockConsolide.quantite_totale;
    await stockConsolide.ajouterStock(quantite);

    // Populer avant de renvoyer
    await stockConsolide.populate({
      path: 'produit',
      populate: [
        { path: 'categorie' },
        { path: 'marque' },
        { path: 'unite' },
        { path: 'format' }
      ]
    });

    res.json({
      message: 'Quantité ajoutée avec succès',
      stockConsolide,
      ancienneQuantite,
      nouvelleQuantite: stockConsolide.quantite_totale,
      quantiteDisponible: stockConsolide.quantite_disponible,
      quantiteAjoutee: quantite
    });
  } catch (err) {
    console.error('❌ Erreur ajout quantité:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

/**
 * Retirer une quantité du stock consolidé
 */
const retirerQuantite = async (req, res) => {
  try {
    const { produitId } = req.params;
    const { quantite } = req.body;

    if (!quantite || quantite <= 0) {
      return res.status(400).json({ message: 'La quantité doit être supérieure à 0' });
    }

    const stockConsolide = await StockConsolide.findOne({ produit: produitId });
    
    if (!stockConsolide) {
      return res.status(404).json({ message: 'Stock consolidé introuvable pour ce produit' });
    }

    const ancienneQuantite = stockConsolide.quantite_disponible;
    
    try {
      await stockConsolide.retirerQuantite(quantite);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    // Populer avant de renvoyer
    await stockConsolide.populate({
      path: 'produit',
      populate: [
        { path: 'categorie' },
        { path: 'marque' },
        { path: 'unite' },
        { path: 'format' }
      ]
    });

    res.json({
      message: 'Quantité retirée avec succès',
      stockConsolide,
      ancienneQuantite,
      nouvelleQuantite: stockConsolide.quantite_disponible,
      quantiteRetiree: quantite
    });
  } catch (err) {
    console.error('❌ Erreur retrait quantité:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

/**
 * Définir la quantité du stock consolidé (remplace la quantité existante)
 */
const definirQuantite = async (req, res) => {
  try {
    const { produitId } = req.params;
    const { quantite } = req.body;

    if (quantite === undefined || quantite < 0) {
      return res.status(400).json({ message: 'La quantité doit être supérieure ou égale à 0' });
    }

    // Obtenir ou créer le stock consolidé
    const stockConsolide = await StockConsolide.obtenirOuCreer(produitId);
    
    const ancienneQuantite = stockConsolide.quantite_disponible;
    const difference = quantite - ancienneQuantite;
    stockConsolide.quantite_disponible = quantite;
    // Si on augmente le stock, on le trace comme entrée
    if (difference > 0) {
      stockConsolide.quantite_entree_totale = (stockConsolide.quantite_entree_totale || 0) + difference;
    }
    await stockConsolide.save();

    // Populer avant de renvoyer
    await stockConsolide.populate({
      path: 'produit',
      populate: [
        { path: 'categorie' },
        { path: 'marque' },
        { path: 'unite' },
        { path: 'format' }
      ]
    });

    res.json({
      message: 'Quantité définie avec succès',
      stockConsolide,
      ancienneQuantite,
      nouvelleQuantite: quantite
    });
  } catch (err) {
    console.error('❌ Erreur définition quantité:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

module.exports = {
  lister,
  getByProduit,
  ajouterQuantite,
  retirerQuantite,
  definirQuantite
};
