const Stock = require("../models/Stock");
const StockConsolide = require("../models/StockConsolide");
const Produit = require("../models/Produit");
const Entrepot = require("../models/Entrepot");
const MouvementStock = require("../models/MouvementStock");
const Lot = require("../models/Lot");
const MarqueProduit = require("../models/MarqueProduit");
const CategorieProduit = require("../models/CategorieProduit");
const Unite = require("../models/Unite");
const Format = require("../models/Format");
const Commande = require("../models/Commande");
const mongoose = require("mongoose");
const { enregistrerMouvement } = require("./mouvement.controller");
const { notifyAllAdmins } = require("./notification.controller");

// 🔹 Champs autorisés
const CHAMPS_CREATE = ["produit", "quantite", "lot_selectionne", "prix_unitaire", "commentaire", "batch_id"];
const CHAMPS_UPDATE = ["produit", "quantite", "lot_selectionne", "seuil_minimum", "commentaire"];

// 🔹 Lister tous les stocks
exports.getAll = async (req, res) => {
  try {
    const stocks = await Stock.find()
      .populate({
        path: "produit",
        populate: [
          { path: "marque", model: "MarqueProduit" },
          { path: "categorie", model: "CategorieProduit" },
          { path: "unite", model: "Unite" },
          { path: "format", model: "Format" },
          { path: "lots", model: "Lot" }
        ]
      })
      .populate("entrepot")
      .lean();
    
    // Pour chaque stock, récupérer le dernier mouvement ENTREE avec lot_info
    const stocksWithLotInfo = await Promise.all(
      stocks.map(async (stock) => {
        const dernierMouvementEntree = await MouvementStock
          .findOne({ 
            stock: stock._id, 
            type: "ENTREE",
            "lot_info.nombre_lots": { $exists: true, $gt: 0 }
          })
          .sort({ date_mouvement: -1 })
          .limit(1)
          .lean();
        
        const stockObj = { ...stock };
        if (dernierMouvementEntree && dernierMouvementEntree.lot_info) {
          // Recalculer le nombre de lots basé sur la quantité actuelle du stock
          const lotInfo = dernierMouvementEntree.lot_info;
          const quantiteActuelle = stock.quantite || 0;
          const quantiteUnitaire = lotInfo.quantite_unitaire || 1;
          
          stockObj.dernier_lot_info = {
            lot_id: lotInfo.lot_id,
            nom_lot: lotInfo.nom_lot,
            quantite_unitaire: quantiteUnitaire,
            nombre_lots: Math.floor(quantiteActuelle / quantiteUnitaire),
            reste_unites: quantiteActuelle % quantiteUnitaire
          };
        }
        
        return stockObj;
      })
    );
    
    res.status(200).json(stocksWithLotInfo);
  } catch (err) {
    console.error("❌ Erreur getAll stocks:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Récupérer un stock par ID
exports.getById = async (req, res) => {
  try {
    const stock = await Stock.findById(req.params.id)
      .populate({
        path: "produit",
        populate: [
          { path: "marque", model: "MarqueProduit" },
          { path: "categorie", model: "CategorieProduit" },
          { path: "unite", model: "Unite" },
          { path: "format", model: "Format" }
        ]
      })
      .populate("entrepot");
    if (!stock) return res.status(404).json({ message: "Stock non trouvé" });
    res.status(200).json(stock);
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Créer un nouveau stock
exports.ajouterStock = async (req, res) => {
  try {
    const champsInconnus = Object.keys(req.body).filter(
      key => !CHAMPS_CREATE.includes(key)
    );
    if (champsInconnus.length > 0) {
      return res.status(400).json({
        message: `Champs non autorisés: ${champsInconnus.join(", ")}`
      });
    }

    const { produit, quantite, lot_selectionne, prix_unitaire, commentaire, batch_id } = req.body;

    if (!produit || quantite === undefined) {
      return res.status(400).json({ message: "Produit et quantité obligatoires" });
    }

    if (quantite <= 0) {
      return res.status(400).json({ message: "La quantité doit être supérieure à 0" });
    }

    // 🔹 Populate le lot pour conversion automatique
    const produitExists = await Produit.findById(produit).populate('lots');
    if (!produitExists) {
      return res.status(400).json({ message: "Produit invalide" });
    }

    // 🔹 Utiliser le premier entrepôt disponible (ou créer une logique par défaut)
    const entrepots = await Entrepot.find();
    if (entrepots.length === 0) {
      return res.status(400).json({ message: "Aucun entrepôt disponible" });
    }
    const entrepot = entrepots[0]._id; // Utiliser le premier entrepôt par défaut

    // 🔹 Conversion automatique UNIQUEMENT si un lot est explicitement sélectionné
    let quantite_finale = quantite;
    let conversion_info = null;

    if (lot_selectionne && produitExists.lots && produitExists.lots.length > 0) {
      // Utiliser le lot spécifiquement sélectionné
      const lotSelectionne = produitExists.lots.find(lot => lot._id.toString() === lot_selectionne);
      if (lotSelectionne && lotSelectionne.quantite_unitaire) {
        quantite_finale = quantite * lotSelectionne.quantite_unitaire;
        conversion_info = {
          quantite_saisie: quantite,
          lot: lotSelectionne.nom,
          quantite_unitaire: lotSelectionne.quantite_unitaire,
          quantite_finale: quantite_finale
        };
      }
    } else {
      // Pas de lot sélectionné = quantité en unités simples
    }

    // Créer le stock avec quantité 0 d'abord
    const newStock = new Stock({
      produit,
      entrepot,
      quantite: 0,
      date_mise_a_jour: new Date()
    });
    await newStock.save();

    // Enregistrer un mouvement ENTREE pour traçabilité complète
    if (quantite_finale > 0) {
      
      // Préparer les informations de lot si applicable
      let lotInfo = null;
      if (conversion_info) {
        const lotUtilise = lot_selectionne 
          ? produitExists.lots.find(lot => lot._id.toString() === lot_selectionne)
          : produitExists.lots[0];
        
        if (lotUtilise) {
          lotInfo = {
            lot_id: lotUtilise._id,
            nom_lot: lotUtilise.nom,
            quantite_unitaire: lotUtilise.quantite_unitaire,
            nombre_lots: conversion_info.quantite_saisie,
            reste_unites: 0
          };
        }
      }
      
      await enregistrerMouvement({
        stockId: newStock._id,
        type: "ENTREE",
        quantite: quantite_finale,
        utilisateurId: req.user?.id,
        prix_unitaire: prix_unitaire || null,
        commentaire: commentaire || "Ajout initial de stock",
        lot_info: lotInfo,
        reference: newStock._id,
        reference_type: 'Stock',
        batch_id: batch_id || null
      });
    }

    // Recharger après mouvement (déjà mis à jour par enregistrerMouvement)
    const stockFinal = await Stock.findById(newStock._id);

    // 🔹 NOUVEAU: Mettre à jour le stock consolidé directement
    try {
      // Obtenir ou créer le stock consolidé
      const stockConsolide = await StockConsolide.obtenirOuCreer(produit, entrepot);
      
      // Ajouter la quantité au stock total
      await stockConsolide.ajouterStock(quantite_finale);
    } catch (error) {
      console.error('❌ [TRACE] Erreur mise à jour stock consolidé:', error);
      console.error('   Stack:', error.stack);
      // Ne pas faire échouer la création de stock si la consolidation échoue
    }

    res.status(201).json({
      message: "Stock créé avec succès",
      stock: stockFinal,
      conversion: conversion_info
    });

    // 📢 Notifier les admins qu'un stock a été ajouté
    try {
      let responsableName = req.user?.username;
      if (!responsableName && req.user?.id) {
        const Utilisateur = require('../models/Utilisateur');
        const user = await Utilisateur.findById(req.user.id);
        if (user) responsableName = user.username;
      }
      responsableName = responsableName || 'Un responsable';
      const produitNom = produitExists?.nom || 'produit';
      await notifyAllAdmins(
        'STOCK_AJOUTE',
        '📦 Nouveau stock ajouté',
        `${responsableName} a ajouté du stock pour "${produitNom}" (${quantite_finale} unités)`,
        { produitId: produit }
      );
    } catch (notifErr) {
      console.error('❌ Erreur notification STOCK_AJOUTE:', notifErr);
    }
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Ajouter plusieurs stocks (BULK)
exports.ajouterStocksBulk = async (req, res) => {
  try {
    const { stocks } = req.body;

    if (!Array.isArray(stocks) || stocks.length === 0) {
      return res.status(400).json({ message: "stocks doit être un tableau non vide" });
    }

    const docs = [];
    const conversions = [];

    for (const s of stocks) {
      const champsInconnus = Object.keys(s).filter(key => !CHAMPS_CREATE.includes(key));
      if (champsInconnus.length > 0) {
        return res.status(400).json({ message: `Champs non autorisés: ${champsInconnus.join(", ")}` });
      }

      if (!s.produit || !s.entrepot || s.quantite === undefined) {
        return res.status(400).json({ message: "Produit, entrepôt et quantite obligatoires" });
      }

      if (s.quantite < 0) {
        return res.status(400).json({ message: "Quantité invalide" });
      }

      // 🔹 Populate le lot pour conversion automatique
      const produitExists = await Produit.findById(s.produit).populate('lot');
      const entrepotExists = await Entrepot.findById(s.entrepot);
      if (!produitExists || !entrepotExists) {
        return res.status(400).json({ message: `Produit ou entrepôt invalide pour ${s.produit}` });
      }

      // 🔹 Conversion automatique si le produit a un lot
      let quantite_finale = s.quantite;
      if (produitExists.lot && produitExists.lot.quantite_unitaire) {
        quantite_finale = s.quantite * produitExists.lot.quantite_unitaire;
        conversions.push({
          produit: produitExists.nom,
          quantite_saisie: s.quantite,
          lot: produitExists.lot.nom,
          quantite_unitaire: produitExists.lot.quantite_unitaire,
          quantite_finale: quantite_finale
        });
      }

      docs.push({
        produit: s.produit,
        entrepot: s.entrepot,
        quantite: quantite_finale,
        date_mise_a_jour: new Date()
      });
    }

    const result = await Stock.insertMany(docs);
    res.status(201).json({
      message: "Stocks ajoutés avec succès",
      stocks: result,
      conversions: conversions.length > 0 ? conversions : null
    });
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Mettre à jour un stock (MODIFICATION DE QUANTITÉ ET/OU PRODUIT)
exports.update = async (req, res) => {
  try {
    const champsInconnus = Object.keys(req.body).filter(
      key => !CHAMPS_UPDATE.includes(key)
    );
    if (champsInconnus.length > 0) {
      return res.status(400).json({
        message: `Champs non autorisés: ${champsInconnus.join(", ")}`
      });
    }

    const stock = await Stock.findById(req.params.id);
    if (!stock) return res.status(404).json({ message: "Stock non trouvé" });

    const { produit, quantite, lot_selectionne, seuil_minimum, commentaire } = req.body;

    // Modification du produit
    if (produit !== undefined && produit !== stock.produit.toString()) {
      const produitExists = await Produit.findById(produit);
      if (!produitExists) {
        return res.status(400).json({ message: "Produit invalide" });
      }
      stock.produit = produit;
    }

    // Modification de quantité : enregistrement via mouvement AJUSTEMENT
    if (quantite !== undefined) {
      const ancienneQuantite = stock.quantite;
      let nouvelleQuantite = quantite;
      
      // Si un lot est sélectionné, convertir en unités
      let lotInfo = null;
      if (lot_selectionne) {
        const lot = await Lot.findById(lot_selectionne);
        if (lot) {
          nouvelleQuantite = quantite * lot.quantite_unitaire;
          lotInfo = {
            lot_id: lot._id,
            nom_lot: lot.nom,
            quantite_unitaire: lot.quantite_unitaire,
            nombre_lots: quantite
          };
        }
      }

      if (nouvelleQuantite < 0) {
        return res.status(400).json({ message: "La quantité ne peut pas être négative" });
      }

      const difference = nouvelleQuantite - ancienneQuantite;
      const quantiteReservee = stock.quantite_reservee || 0;
      const ancienDisponible = ancienneQuantite - quantiteReservee;
      const nouveauDisponible = nouvelleQuantite - quantiteReservee;

      if (nouveauDisponible < 0) {
        return res.status(400).json({
          message: `Impossible de réduire la quantité. Stock réservé: ${quantiteReservee}, quantité demandée: ${nouvelleQuantite}`
        });
      }

      // Enregistrer le mouvement AJUSTEMENT (quantite = nouvelle valeur absolue)
      await enregistrerMouvement({
        stockId: stock._id,
        type: "AJUSTEMENT",
        quantite: nouvelleQuantite,
        utilisateurId: req.user?.id,
        commentaire: commentaire || `Ajustement: ${ancienneQuantite} → ${nouvelleQuantite} (${difference >= 0 ? '+' : ''}${difference})`,
        reference: stock._id,
        reference_type: 'Stock',
        lot_info: lotInfo
      });

      // Recharger le stock (déjà mis à jour par enregistrerMouvement)
      const stockMisAJour = await Stock.findById(stock._id);
      if (stockMisAJour) {
        stock.quantite = stockMisAJour.quantite;
        stock.date_mise_a_jour = stockMisAJour.date_mise_a_jour;
      }

      // 🔹 NOUVEAU: Mettre à jour le stock consolidé avec la différence
      if (difference !== 0) {
        try {
          // Obtenir le stock consolidé
          const stockConsolide = await StockConsolide.findOne({ produit: stock.produit });
          if (stockConsolide) {
            if (difference > 0) {
              // Ajout de stock
              await stockConsolide.ajouterStock(difference);
            } else {
              // Réduction de stock
              await stockConsolide.retirerStock(Math.abs(difference));
            }
          } else {
            console.warn(`⚠️ Stock consolidé introuvable pour le produit ${stock.produit}`);
          }
        } catch (error) {
          console.error('❌ Erreur mise à jour stock consolidé:', error);
          // Ne pas faire échouer la modification si la consolidation échoue
        }
      }

    }

    if (seuil_minimum !== undefined) {
      stock.seuil_minimum = seuil_minimum;
      stock.date_mise_a_jour = new Date();
      await stock.save();
    }

    // Recharger pour retourner les données fraîches
    const stockFinal = await Stock.findById(stock._id)
      .populate({ 
        path: "produit", 
        populate: [
          { path: "marque", model: "MarqueProduit" }, 
          { path: "categorie", model: "CategorieProduit" }, 
          { path: "unite", model: "Unite" }, 
          { path: "format", model: "Format" }
        ] 
      })
      .populate("entrepot");

    res.status(200).json({ message: "Stock mis à jour avec succès", stock: stockFinal });
  } catch (err) {
    console.error("❌ Erreur dans stock.controller.update:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Supprimer un stock
exports.delete = async (req, res) => {
  try {
    const stock = await Stock.findById(req.params.id);
    if (!stock) return res.status(404).json({ message: "Stock non trouvé" });

    const quantiteTotal = stock.quantite || 0;
    const quantiteReservee = stock.quantite_reservee || 0;
    const quantiteDisponible = quantiteTotal - quantiteReservee;

    // Récupérer le seuil minimum du produit
    const produit = await Produit.findById(stock.produit);
    const seuilMinimum = produit?.seuil_minimum || 0;

    // Vérifier si la suppression est autorisée
    // On peut supprimer seulement si quantité disponible + seuil minimum >= quantité totale à supprimer
    if (quantiteTotal > (quantiteDisponible + seuilMinimum)) {
      return res.status(400).json({
        message: `Suppression interdite. Quantité à supprimer (${quantiteTotal}) dépasse la quantité disponible (${quantiteDisponible}) + seuil minimum (${seuilMinimum}). Stock réservé: ${quantiteReservee}`
      });
    }

    await Stock.findByIdAndDelete(req.params.id);
    res.status(200).json({
      message: "Stock supprimé avec succès",
      details: {
        quantite_supprimee: quantiteTotal,
        quantite_disponible: quantiteDisponible,
        quantite_reservee: quantiteReservee,
        seuil_minimum: seuilMinimum
      }
    });
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};


// 🔹 Stock consolidé avec filtrage par date
exports.getConsolidatedWithMovements = async (req, res) => {
  try {
    const { dateDebut, dateFin } = req.query;
    
    // Construire le filtre de date
    let dateFilter = {};
    if (dateDebut || dateFin) {
      dateFilter.date_mouvement = {};
      if (dateDebut) {
        dateFilter.date_mouvement.$gte = new Date(dateDebut);
      }
      if (dateFin) {
        // Ajouter 23:59:59 à la date de fin pour inclure toute la journée
        const endDate = new Date(dateFin);
        endDate.setHours(23, 59, 59, 999);
        dateFilter.date_mouvement.$lte = endDate;
      }
    }

    // Récupérer tous les stocks actuels
    const stocks = await Stock.find()
      .populate({
        path: "produit",
        populate: [
          { path: "marque", model: "MarqueProduit" },
          { path: "categorie", model: "CategorieProduit" },
          { path: "unite", model: "Unite" },
          { path: "format", model: "Format" },
          { path: "lots", model: "Lot" }
        ]
      })
      .populate("entrepot");

    // Récupérer les mouvements pour la période
    const mouvements = await MouvementStock.find(dateFilter)
      .populate({
        path: "stock",
        populate: {
          path: "produit",
          populate: [
            { path: "marque", model: "MarqueProduit" },
            { path: "categorie", model: "CategorieProduit" },
            { path: "unite", model: "Unite" },
            { path: "format", model: "Format" }
          ]
        }
      })
      .populate("reference")
      .sort({ date_mouvement: -1 });

    // Consolider par produit
    const productMap = new Map();

    // Initialiser avec les stocks actuels
    stocks.forEach(stock => {
      const produitId = stock.produit?._id?.toString();
      if (!produitId) return;

      if (!productMap.has(produitId)) {
        productMap.set(produitId, {
          produit: stock.produit,
          quantite_actuelle: 0,
          quantite_reservee_actuelle: 0,
          quantite_retournee_actuelle: 0,
          quantite_disponible_actuelle: 0,
          mouvements_periode: {
            entrees: 0,
            sorties: 0,
            retours: 0,
            ajustements: 0,
            transferts: 0
          },
          historique_mouvements: [],
          stocks_details: []
        });
      }

      const consolidated = productMap.get(produitId);
      const quantite = stock.quantite || 0;
      const quantiteReservee = stock.quantite_reservee || 0;
      const quantiteRetournee = stock.quantite_retournee || 0;

      consolidated.quantite_actuelle += quantite;
      consolidated.quantite_reservee_actuelle += quantiteReservee;
      consolidated.quantite_retournee_actuelle += quantiteRetournee;
      consolidated.quantite_disponible_actuelle += (quantite - quantiteReservee);
      consolidated.stocks_details.push({
        localisation: stock.entrepot,
        quantite: quantite,
        quantite_reservee: quantiteReservee,
        quantite_retournee: quantiteRetournee,
        quantite_disponible: quantite - quantiteReservee
      });
    });

    // Ajouter les mouvements de la période
    mouvements.forEach(mouvement => {
      const produitId = mouvement.stock?.produit?._id?.toString();
      if (!produitId) return;

      if (!productMap.has(produitId)) {
        // Produit qui n'existe plus en stock mais a eu des mouvements
        productMap.set(produitId, {
          produit: mouvement.stock.produit,
          quantite_actuelle: 0,
          quantite_reservee_actuelle: 0,
          quantite_retournee_actuelle: 0,
          quantite_disponible_actuelle: 0,
          mouvements_periode: {
            entrees: 0,
            sorties: 0,
            retours: 0,
            ajustements: 0,
            transferts: 0
          },
          historique_mouvements: [],
          stocks_details: []
        });
      }

      const consolidated = productMap.get(produitId);
      const quantite = mouvement.quantite || 0;

      // Compter les mouvements par type
      switch (mouvement.type) {
        case 'ENTREE':
          consolidated.mouvements_periode.entrees += quantite;
          break;
        case 'SORTIE':
          consolidated.mouvements_periode.sorties += quantite;
          break;
        case 'RETOUR':
          consolidated.mouvements_periode.retours += quantite;
          break;
        case 'AJUSTEMENT':
          consolidated.mouvements_periode.ajustements += quantite;
          break;
        case 'TRANSFERT':
          consolidated.mouvements_periode.transferts += quantite;
          break;
      }

      // Ajouter à l'historique
      consolidated.historique_mouvements.push({
        _id: mouvement._id,
        type: mouvement.type,
        quantite: quantite,
        date_mouvement: mouvement.date_mouvement,
        commentaire: mouvement.commentaire,
        utilisateur: mouvement.utilisateur,
        lot_info: mouvement.lot_info,
        reference_formatee: mouvement.reference_formatee
      });
    });

    // Convertir en array et trier
    const result = Array.from(productMap.values()).map(consolidated => {
      // Trier l'historique par date (plus récent en premier)
      consolidated.historique_mouvements.sort((a, b) => 
        new Date(b.date_mouvement) - new Date(a.date_mouvement)
      );
      return consolidated;
    });

    // Statistiques globales pour la période
    const stats = {
      total_produits: result.length,
      total_mouvements: mouvements.length,
      periode: {
        debut: dateDebut || null,
        fin: dateFin || null
      },
      totaux: {
        entrees: result.reduce((sum, p) => sum + p.mouvements_periode.entrees, 0),
        sorties: result.reduce((sum, p) => sum + p.mouvements_periode.sorties, 0),
        retours: result.reduce((sum, p) => sum + p.mouvements_periode.retours, 0),
        ajustements: result.reduce((sum, p) => sum + p.mouvements_periode.ajustements, 0),
        transferts: result.reduce((sum, p) => sum + p.mouvements_periode.transferts, 0)
      }
    };

    res.status(200).json({
      stocks: result,
      stats: stats
    });
  } catch (err) {
    console.error("❌ Erreur getConsolidatedWithMovements:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * GET /api/stocks/analysis
 * Analyse détaillée par produit avec filtrage par période et catégorie.
 * Calcule Qté In, Qté Out (LIVREE/CONFIRMEE), Prix Achat, Prix Vente et Gain.
 * Fournit également les données quotidiennes pour les graphiques.
 */
exports.getStockAnalysis = async (req, res) => {
  try {
    const { dateDebut, dateFin, categorie } = req.query;

    const query = {};
    if (dateDebut || dateFin) {
      query.date_mouvement = {};
      if (dateDebut) query.date_mouvement.$gte = new Date(dateDebut);
      if (dateFin) {
        const endDate = new Date(dateFin);
        endDate.setHours(23, 59, 59, 999);
        query.date_mouvement.$lte = endDate;
      }
    }

    // Récupérer les IDs des produits de la catégorie si spécifiée
    let productIds = null;
    if (categorie && categorie !== 'all') {
      const productsInCategory = await Produit.find({ categorie }).select('_id');
      productIds = productsInCategory.map(p => p._id);
    }

    // Filtrer les mouvements
    const mouvementFilter = { ...query };
    if (productIds) {
      const stocksInCat = await Stock.find({ produit: { $in: productIds } }).select('_id');
      mouvementFilter.stock = { $in: stocksInCat.map(s => s._id) };
    }

    const mouvements = await MouvementStock.find(mouvementFilter)
      .populate({
        path: 'stock',
        populate: { 
          path: 'produit', 
          populate: [
            { path: 'categorie' },
            { path: 'marque' }
          ]
        }
      })
      .populate('reference')
      .sort({ date_mouvement: 1 });

    const productsData = {};

    for (const mov of mouvements) {
      const produit = mov.stock?.produit;
      if (!produit) continue;
      const pid = produit._id.toString();

      if (!productsData[pid]) {
        productsData[pid] = {
          produit: {
            _id: produit._id,
            nom: produit.nom,
            image: produit.image,
            code: produit.code,
            prix_reference: produit.prix_reference || 0,
            categorie: produit.categorie?.nom || 'N/A',
            marque: produit.marque?.nom || 'N/A'
          },
          quantite_in: 0,
          total_prix_achat: 0,
          count_achat: 0,
          quantite_out: 0,
          daily_data: {}
        };
      }

      const pData = productsData[pid];
      const dateStr = mov.date_mouvement.toISOString().split('T')[0];
      
      if (!pData.daily_data[dateStr]) {
        pData.daily_data[dateStr] = { date: dateStr, qte_out: 0, revenue: 0 };
      }

      if (mov.type === 'ENTREE') {
        pData.quantite_in += (mov.quantite || 0);
        if (mov.prix_unitaire) {
          pData.total_prix_achat += (mov.prix_unitaire * mov.quantite);
          pData.count_achat += mov.quantite;
        }
      } else if (mov.type === 'SORTIE' || mov.type === 'RESERVATION') {
        // Uniquement si la commande est LIVREE ou CONFIRMEE
        let isValidSale = true;
        if (mov.reference_type === 'Commande' && mov.reference) {
          const status = mov.reference.statut;
          if (status !== 'LIVREE' && status !== 'CONFIRMEE') {
            isValidSale = false;
          }
        }

        if (isValidSale) {
          const qte = mov.quantite || 0;
          pData.quantite_out += qte;
          pData.daily_data[dateStr].qte_out += qte;
          pData.daily_data[dateStr].revenue += (qte * (produit.prix_reference || 0));
        }
      }
    }

    // Finaliser les calculs
    const result = Object.values(productsData).map(p => {
      const avgPurchasePrice = p.count_achat > 0 ? (p.total_prix_achat / p.count_achat) : 0;
      // Gain = (Prix Vente - Prix Achat) * Qté Vendue
      const gain = (p.produit.prix_reference - avgPurchasePrice) * p.quantite_out;
      
      // Convertir daily_data en tableau trié
      const sortedDaily = Object.values(p.daily_data).sort((a, b) => a.date.localeCompare(b.date));

      return {
        ...p.produit,
        quantite_in: p.quantite_in,
        quantite_out: p.quantite_out,
        prix_achat: avgPurchasePrice,
        prix_vente: p.produit.prix_reference,
        gain: gain,
        daily_data: sortedDaily
      };
    });

    res.json(result);
  } catch (err) {
    console.error("❌ Erreur Stock Analysis:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};