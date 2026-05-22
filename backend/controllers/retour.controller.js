const mongoose = require("mongoose");
const Retour = require("../models/Retour");
const LigneCommande = require("../models/LigneCommande");
const Commande = require("../models/Commande");
const Livraison = require("../models/Livraison");
const Lot = require("../models/Lot");
const Produit = require("../models/Produit");
const PointDeVente = require("../models/PointDeVente");
const Stock = require("../models/Stock");
const StockConsolide = require("../models/StockConsolide");
const { enregistrerMouvement } = require("./mouvement.controller");
const { formatIdBadge } = require("../utils/idFormatter");
const { notifyAllAdmins } = require("./notification.controller");

/**
 * POST /api/retours
 * Créer un retour ET réintégrer la quantité au stock
 */
const create = async (req, res) => {
  try {
    const { 
      ligneCommande, 
      quantite, 
      motif, 
      impact_financier, 
      quantite_lots,
      livraison_id,
      ligne_livraison_id 
    } = req.body;

    if (!ligneCommande || !quantite) {
      return res.status(400).json({ message: "ligneCommande et quantite sont obligatoires" });
    }

    if (quantite <= 0) {
      return res.status(400).json({ message: "La quantité doit être supérieure à 0" });
    }

    // Récupérer la ligne de commande pour trouver le produit
    const ligneCmd = await LigneCommande.findById(ligneCommande).populate('lot');
    if (!ligneCmd) {
      return res.status(404).json({ message: "Ligne de commande introuvable" });
    }

    // Trouver la commande qui contient cette ligne
    const commande = await Commande.findOne({ lignesCommande: ligneCommande });
    if (!commande) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (commande.statut !== 'LIVREE') {
      return res.status(400).json({ 
        message: `Impossible de créer un retour. La commande doit être livrée (statut actuel: ${commande.statut})` 
      });
    }

    // Si on a une livraison spécifique, vérifier les quantités par rapport à cette livraison
    let quantiteRetournable = ligneCmd.quantite - (ligneCmd.quantite_retournee || 0);
    
    if (livraison_id && ligne_livraison_id) {
      // Vérifier que la ligne de livraison existe et correspond au produit
      const livraison = await Livraison.findById(livraison_id);
      
      if (livraison) {
        const ligneLivraison = livraison.lignesLivraison.id(ligne_livraison_id);
        
        if (ligneLivraison) {
          // Utiliser les quantités de la livraison pour la validation
          const dejaRetourneLivraison = ligneLivraison.quantite_retournee || 0;
          quantiteRetournable = ligneLivraison.quantite - dejaRetourneLivraison;
        }
      }
    }

    if (quantite > quantiteRetournable) {
      return res.status(400).json({
        message: `Impossible de retourner ${quantite} unités. Maximum retournable: ${quantiteRetournable}`
      });
    }

    // Trouver le stock consolidé correspondant au produit
    const stockConsolide = await StockConsolide.findOne({ produit: ligneCmd.produit });
    if (!stockConsolide) {
      return res.status(404).json({ message: "Stock consolidé introuvable pour ce produit" });
    }

    // 1. Créer le retour avec les références à la livraison si disponibles
    const retour = new Retour({
      ligneCommande,
      livraison: livraison_id || null,
      ligne_livraison_id: ligne_livraison_id || null,
      quantite,
      quantite_lots: quantite_lots || null,  // Sauvegarder si saisie en lots
      motif,
      impact_financier,
      date_traitement: new Date()
    });
    await retour.save();

    // 📢 Notifier les admins qu'un retour a été créé
    try {
      let responsableName = req.user?.username;
      if (!responsableName && req.user?.id) {
        const Utilisateur = require('../models/Utilisateur');
        const user = await Utilisateur.findById(req.user.id);
        if (user) responsableName = user.username;
      }
      responsableName = responsableName || 'Un responsable';
      await notifyAllAdmins(
        'RETOUR_CREE',
        '🔄 Retour créé',
        `${responsableName} a créé un retour produit (motif : ${motif || 'non précisé'})`,
        { ligneCommandeId: ligneCommande }
      );
    } catch (notifErr) {
      console.error('❌ Erreur notification RETOUR_CREE:', notifErr);
    }

    // 2. RETOUR DIRECT dans le stock consolidé
    try {
      // Marquer la quantité comme retournée (champ indépendant)
      // Les retours ne sont PAS ajoutés au stock disponible, ils restent séparés
      await stockConsolide.marquerRetourne(quantite);
      
    } catch (error) {
      console.error(`❌ Erreur stock consolidé: ${error.message}`);
      return res.status(400).json({
        message: `❌ Erreur lors du traitement du retour: ${error.message}`
      });
    }

    // 3. Enregistrer le mouvement pour traçabilité
    try {
      // Trouver un stock individuel pour l'enregistrement du mouvement
      const stockIndividuel = await Stock.findOne({ produit: ligneCmd.produit });
      
      if (stockIndividuel) {
        // Utiliser le motif saisi comme commentaire, avec info livraison si disponible
        let commentaire = motif || 'Retour produit';
        if (livraison_id) {
          const livraison = await Livraison.findById(livraison_id);
          if (livraison) {
            const livraisonId = livraison.id_formate || `LIV-${livraison.numero_livraison}`;
            commentaire += ` (Livraison: ${livraisonId})`;
          }
        }

        // Préparer les informations de lot si disponible
        let lotInfo = null;
        if (ligneCmd.lot) {
          const nbLots = quantite_lots || Math.floor(quantite / ligneCmd.lot.quantite_unitaire);
          const resteLots = quantite % ligneCmd.lot.quantite_unitaire;
          
          lotInfo = {
            lot_id: ligneCmd.lot._id,
            nom_lot: ligneCmd.lot.nom,
            quantite_unitaire: ligneCmd.lot.quantite_unitaire,
            nombre_lots: nbLots,
            reste_unites: resteLots
          };
        }

        await enregistrerMouvement({
          stockId: stockIndividuel._id,
          type: "RETOUR",
          quantite: quantite,
          utilisateurId: req.user?.id,
          reference: livraison_id || commande._id, // Référence vers la livraison si disponible, sinon la commande
          reference_type: livraison_id ? "Livraison" : "Commande",
          commentaire: commentaire,
          lot_info: lotInfo
        });
      } else {
        console.warn(`⚠️ Aucun stock individuel trouvé pour le produit ${ligneCmd.produit}, mouvement non enregistré`);
      }
    } catch (movementError) {
      console.error(`❌ Erreur mouvement: ${movementError.message}`);
      // Ne pas faire échouer la création du retour si l'enregistrement du mouvement échoue
    }

    // 4. Mettre à jour quantite_retournee dans la ligne de commande ET la ligne de livraison si applicable
    const dejaRetourne = ligneCmd.quantite_retournee || 0;
    ligneCmd.quantite_retournee = dejaRetourne + quantite;
    await ligneCmd.save();

    // Mettre à jour aussi la ligne de livraison si spécifiée
    if (livraison_id && ligne_livraison_id) {
      const livraison = await Livraison.findById(livraison_id);
      if (livraison) {
        const ligneLivraison = livraison.lignesLivraison.id(ligne_livraison_id);
        if (ligneLivraison) {
          const dejaRetourneLivraison = ligneLivraison.quantite_retournee || 0;
          ligneLivraison.quantite_retournee = dejaRetourneLivraison + quantite;
          await livraison.save();
        }
      }
    }

    // 5. Recharger le stock consolidé mis à jour
    const stockMisAJour = await StockConsolide.findById(stockConsolide._id);

    if (livraison_id) {
      // Retour lié à la livraison
    }

    res.status(201).json({
      message: "Retour enregistré et stock consolidé réintégré avec succès",
      retour,
      stock: stockMisAJour
    });
  } catch (err) {
    console.error("❌ Erreur création retour:", err);
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/retours
 * Lister tous les retours avec filtres optionnels
 */
const getAll = async (req, res) => {
  try {
    const { commande, produit, dateDebut, dateFin } = req.query;
    
    let filter = {};
    
    // Filtrer par commande
    if (commande) {
      const lignes = await LigneCommande.find({ commande });
      filter.ligneCommande = { $in: lignes.map(l => l._id) };
    }
    
    // Filtrer par produit
    if (produit) {
      const lignes = await LigneCommande.find({ produit });
      if (filter.ligneCommande) {
        // Intersection des deux filtres
        const ligneIds = lignes.map(l => l._id.toString());
        filter.ligneCommande.$in = filter.ligneCommande.$in.filter(id => 
          ligneIds.includes(id.toString())
        );
      } else {
        filter.ligneCommande = { $in: lignes.map(l => l._id) };
      }
    }
    
    // Filtrer par date
    if (dateDebut || dateFin) {
      filter.date_traitement = {};
      if (dateDebut) filter.date_traitement.$gte = new Date(dateDebut);
      if (dateFin) filter.date_traitement.$lte = new Date(dateFin);
    }

    const retours = await Retour.find(filter)
      .populate({
        path: "ligneCommande",
        populate: [
          { path: "produit", options: { withDeleted: true } },
          { path: "lot" }
        ]
      })
      .sort({ date_traitement: -1 })
      .lean();

    // ✅ Optimisation: charger toutes les données en batch au lieu de N+1 requêtes
    const ligneCommandeIds = retours
      .filter(r => r.ligneCommande && r.ligneCommande._id)
      .map(r => r.ligneCommande._id);

    // 1. Charger toutes les commandes liées en une seule requête
    const commandes = await Commande.find({ lignesCommande: { $in: ligneCommandeIds } })
      .populate({
        path: "lignesCommande",
        populate: [
          { path: "produit", options: { withDeleted: true } },
          { path: "lot" }
        ]
      })
      .populate('pointDeVente')
      .lean();

    // Créer un index ligneCommande -> commande pour lookup rapide
    const ligneToCommandeMap = new Map();
    for (const cmd of commandes) {
      if (cmd.lignesCommande) {
        for (const ligne of cmd.lignesCommande) {
          ligneToCommandeMap.set(ligne._id.toString(), cmd);
        }
      }
    }

    // 2. Collecter les IDs de livraisons déjà associées aux retours
    const livraisonIdsFromRetours = retours
      .filter(r => r.livraison)
      .map(r => r.livraison);

    // 3. Charger les livraisons spécifiques des retours + les livraisons ECHEC comme fallback
    const commandeIds = commandes.map(c => c._id);
    
    // Charger les livraisons spécifiques des retours
    const livraisonsSpecifiques = livraisonIdsFromRetours.length > 0
      ? await Livraison.find({ _id: { $in: livraisonIdsFromRetours } }).lean()
      : [];
    
    // Charger aussi les livraisons ECHEC comme fallback
    const livraisonsEchec = await Livraison.find({
      commande: { $in: commandeIds },
      statut: 'ECHEC'
    }).sort({ date_creation: -1 }).lean();

    // Combiner les deux listes
    const toutesLivraisons = [...livraisonsSpecifiques, ...livraisonsEchec];

    // Index par ID de livraison pour lookup rapide
    const livraisonByIdMap = new Map();
    for (const liv of toutesLivraisons) {
      livraisonByIdMap.set(liv._id.toString(), liv);
    }

    // Index commande+produit -> livraison ECHEC (la plus récente) pour fallback
    const livraisonEchecMap = new Map();
    for (const liv of livraisonsEchec) {
      if (liv.lignesLivraison) {
        for (const ligneLiv of liv.lignesLivraison) {
          const key = `${liv.commande.toString()}_${ligneLiv.produit.toString()}`;
          if (!livraisonEchecMap.has(key)) {
            livraisonEchecMap.set(key, liv);
          }
        }
      }
    }

    // 4. Enrichir les retours en mémoire (pas de requêtes supplémentaires)
    const retoursEnrichis = retours.map(retourObj => {
      if (!retourObj.ligneCommande || !retourObj.ligneCommande._id) {
        return retourObj;
      }

      const commande = ligneToCommandeMap.get(retourObj.ligneCommande._id.toString());
      if (commande) {
        retourObj.ligneCommande.commande = commande;

        let livraison = null;

        // Priorité 1: Utiliser la livraison spécifique du retour si elle existe
        if (retourObj.livraison) {
          livraison = livraisonByIdMap.get(retourObj.livraison.toString());
        }

        // Priorité 2: Fallback vers une livraison ECHEC si pas de livraison spécifique
        if (!livraison && retourObj.ligneCommande.produit && retourObj.ligneCommande.produit._id) {
          const key = `${commande._id.toString()}_${retourObj.ligneCommande.produit._id.toString()}`;
          livraison = livraisonEchecMap.get(key);
        }

        if (livraison) {
          const livraisonIdFormate = formatIdBadge(livraison._id, 'livraison');
          retourObj.livraison = {
            _id: livraison._id,
            id_formate: livraison.id_formate || livraisonIdFormate,
            numero_livraison: livraison.numero_livraison,
            commande: commande, // ← Add commande reference for proper code generation
            statut: livraison.statut,
            date_livraison: livraison.date_livraison,
            raison_echec: livraison.raison_echec
          };
        }
      }

      return retourObj;
    });

    res.json(retoursEnrichis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/retours/stats
 * Récupérer les statistiques des retours
 */
const getStats = async (req, res) => {
  try {
    const { dateDebut, dateFin } = req.query;
    
    let filter = {};
    if (dateDebut || dateFin) {
      filter.date_traitement = {};
      if (dateDebut) filter.date_traitement.$gte = new Date(dateDebut);
      if (dateFin) filter.date_traitement.$lte = new Date(dateFin);
    }
    
    const retours = await Retour.find(filter)
      .populate({
        path: "ligneCommande",
        populate: { path: "produit", options: { withDeleted: true } }
      });
    
    // Calculer les stats
    const totalRetours = retours.length;
    const valeurTotale = retours.reduce((sum, r) => sum + (r.impact_financier || 0), 0);
    const quantiteTotale = retours.reduce((sum, r) => sum + r.quantite, 0);
    
    // Top motifs
    const motifs = {};
    retours.forEach(r => {
      if (r.motif) {
        motifs[r.motif] = (motifs[r.motif] || 0) + 1;
      }
    });
    const topMotifs = Object.entries(motifs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([motif, count]) => ({ motif, count }));
    
    // Top produits retournés
    const produits = {};
    retours.forEach(r => {
      const produitId = r.ligneCommande?.produit?._id?.toString();
      const produitNom = r.ligneCommande?.produit?.nom;
      if (produitId) {
        if (!produits[produitId]) {
          produits[produitId] = { nom: produitNom, quantite: 0 };
        }
        produits[produitId].quantite += r.quantite;
      }
    });
    const topProduits = Object.entries(produits)
      .sort((a, b) => b[1].quantite - a[1].quantite)
      .slice(0, 5)
      .map(([id, data]) => data);
    
    res.json({
      totalRetours,
      valeurTotale,
      quantiteTotale,
      topMotifs,
      topProduits
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/retours/:id/remettre-stock
 * Remettre une quantité du retour en stock (total ou partiel)
 */
const remettreEnStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantite, commentaire } = req.body;
    
    // Validation
    if (!quantite || quantite <= 0) {
      return res.status(400).json({ message: "Quantité invalide" });
    }
    
    // Récupérer le retour avec ses relations
    const retour = await Retour.findById(id)
      .populate({
        path: "ligneCommande",
        populate: { path: "produit", options: { withDeleted: true } }
      });
      
    if (!retour) {
      return res.status(404).json({ message: "Retour non trouvé" });
    }
    
    // Vérifier qu'il reste de la quantité à remettre en stock
    const quantiteRestante = retour.quantite - (retour.quantite_remise_stock || 0);
    if (quantite > quantiteRestante) {
      return res.status(400).json({ 
        message: `Quantité trop élevée. Maximum disponible: ${quantiteRestante}` 
      });
    }
    
    // Récupérer le stock consolidé du produit
    const stockConsolide = await StockConsolide.findOne({ 
      produit: retour.ligneCommande.produit._id 
    });
    
    if (!stockConsolide) {
      return res.status(404).json({ 
        message: "Stock consolidé non trouvé pour ce produit" 
      });
    }
    
    console.log(`   Stock avant: Total=${stockConsolide.quantite_totale}, Disponible=${stockConsolide.quantite_disponible}, Retourné=${stockConsolide.quantite_retournee}`);
    
    // Transférer du stock retourné vers le stock disponible
    // Diminuer la quantité retournée et augmenter la quantité disponible
    if (stockConsolide.quantite_retournee < quantite) {
      return res.status(400).json({ 
        message: `Stock retourné insuffisant. Disponible: ${stockConsolide.quantite_retournee}, Demandé: ${quantite}` 
      });
    }
    
    stockConsolide.quantite_retournee -= quantite;
    stockConsolide.quantite_disponible += quantite;
    // Le total reste le même car on transfère juste entre catégories
    await stockConsolide.save();
    
    console.log(`   Stock après: Total=${stockConsolide.quantite_totale}, Disponible=${stockConsolide.quantite_disponible}, Retourné=${stockConsolide.quantite_retournee}`);
    
    // Enregistrer le mouvement de stock
    // Trouver un stock individuel pour l'enregistrement du mouvement
    const Stock = require('../models/Stock');
    const stockIndividuel = await Stock.findOne({ produit: retour.ligneCommande.produit._id });
    
    if (stockIndividuel) {
      await enregistrerMouvement({
        stockId: stockIndividuel._id, // Utiliser stockId au lieu de stock
        type: "ENTREE",
        quantite: quantite,
        utilisateurId: req.user?.id, // Utiliser utilisateurId au lieu de utilisateur
        reference: retour._id,
        reference_type: "Retour",
        commentaire: `Remise en stock depuis retour ${retour.id_formate}${commentaire ? ` - ${commentaire}` : ''}`
      });
      
    } else {
      console.warn(`⚠️ Aucun stock individuel trouvé pour le produit ${retour.ligneCommande.produit._id}, mouvement non enregistré`);
    }
    
    // Mettre à jour le retour
    retour.quantite_remise_stock = (retour.quantite_remise_stock || 0) + quantite;
    
    // Valider l'utilisateur ID avant de l'ajouter
    let validUtilisateurId = null;
    if (req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)) {
      validUtilisateurId = req.user.id;
    }
    
    retour.remises_stock.push({
      quantite: quantite,
      date_remise: new Date(),
      utilisateur: validUtilisateurId, // Peut être null si pas d'utilisateur valide
      commentaire: commentaire || ''
    });
    
    await retour.save();

    // 📢 Notifier les admins d'une remise en stock
    try {
      let responsableName = req.user?.username;
      if (!responsableName && req.user?.id) {
        const Utilisateur = require('../models/Utilisateur');
        const user = await Utilisateur.findById(req.user.id);
        if (user) responsableName = user.username;
      }
      responsableName = responsableName || 'Un responsable';
      await notifyAllAdmins(
        'REMISE_STOCK',
        '📦 Remise en stock',
        `${responsableName} a remis ${quantite} unité(s) en stock depuis un retour`,
        { retourId: retour._id }
      );
    } catch (notifErr) {
      console.error('❌ Erreur notification REMISE_STOCK:', notifErr);
    }

    console.log(`✅ Remise en stock effectuée: ${quantite} unités`);
    console.log(`   Total remis en stock: ${retour.quantite_remise_stock}/${retour.quantite}`);    
    res.json({
      message: "Remise en stock effectuée avec succès",
      retour: retour,
      quantite_remise: quantite,
      quantite_restante: retour.quantite - retour.quantite_remise_stock,
      stock_mis_a_jour: {
        quantite_totale: stockConsolide.quantite_totale,
        quantite_disponible: stockConsolide.quantite_disponible,
        quantite_retournee: stockConsolide.quantite_retournee
      }
    });
    
  } catch (err) {
    console.error('❌ Erreur remise en stock:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

module.exports = { create, getAll, getStats, remettreEnStock };

