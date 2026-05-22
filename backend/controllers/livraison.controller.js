const mongoose = require('mongoose');
const Livraison = require("../models/Livraison");
const Commande = require("../models/Commande");
const LigneCommande = require("../models/LigneCommande");
const Stock = require("../models/Stock");
const { enregistrerMouvement } = require("./mouvement.controller");
const { formatIdBadge } = require("../utils/idFormatter");
const { createDeliveryNotification, notifyAllResponsables, notifyAllAdmins } = require("./notification.controller");
const { ajouterStockConsolide } = require("../utils/stockUtils");
const { calculateItemsWeight } = require("../utils/weightUtils");
const Camion = require("../models/Camion");
const Voyage = require("../models/Voyage");
const Facture = require("../models/Facture");
const StockConsolide = require("../models/StockConsolide");
const { calculateLivraisonTotal } = require("../utils/financeUtils");
const orderEmitter = require("../services/orderEvents");




exports.lister = async (req, res) => {
  try {
    const { excludeAnnulees } = req.query; // Nouveau paramètre pour exclure les commandes annulées
    
    const livraisons = await Livraison.find()
      .populate({
        path: "commande",
        select: "numero_commande statut date_creation id_formate sousTotal fraisLivraison codePromo fidelite client pointDeVente adresse_livraison mode_paiement",
        populate: [
          { path: "client", select: "nom prenom email telephone" },
          { path: "pointDeVente", select: "nom adresse telephone latitude longitude localisation_gps" },
          {
            path: "lignesCommande",
            select: "produit lot quantite quantite_restante prix_unitaire quantite_retournee",
            populate: [
              { 
                path: "produit",
                select: "nom reference image",
                populate: { path: "unite" }
              },
              { path: "lot", select: "nom quantite_unitaire" }
            ]
          }
        ]
      })
      .populate({
        path: "voyage",
        select: "statut date_depart chauffeur camion id_formate numero_voyage",
        populate: [
          { path: "camion", select: "immatriculation marque modele", options: { withDeleted: true } },
          { 
            path: "chauffeur", 
            select: "nom prenom telephone", 
            options: { withDeleted: true },
            populate: { path: "utilisateur", select: "username", options: { withDeleted: true } } 
          }
        ]
      })
      .populate({
        path: "lignesLivraison",
        populate: [
          { 
            path: "produit",
            select: "nom reference image poids_unitaire",
            options: { withDeleted: true },
            populate: { path: "unite", options: { withDeleted: true } }
          },
          { path: "lot", select: "nom quantite_unitaire" }
        ]
      })
      .populate({
        path: "camion_assigne",
        select: "marque modele immatriculation",
        options: { withDeleted: true }
      })
      .lean(); // Faster serialization since we only read

    // ✅ NOUVEAU: Filtrer les livraisons de commandes annulées si demandé
    let livraisonsFiltered = livraisons;
    if (excludeAnnulees === 'true') {
      livraisonsFiltered = livraisons.filter(livraison => 
        !livraison.commande || livraison.commande.statut !== 'ANNULEE'
      );
      
      console.log(`🔍 Filtrage des commandes annulées: ${livraisons.length} → ${livraisonsFiltered.length} livraisons`);
    }

    // ✅ NOUVEAU: Ajouter un indicateur pour les livraisons de commandes annulées
    const livraisonsAvecIndicateur = livraisonsFiltered.map(livraison => ({
      ...livraison,
      commande_annulee: livraison.commande?.statut === 'ANNULEE',
      livrable: livraison.commande?.statut !== 'ANNULEE' && livraison.statut !== 'LIVREE' && livraison.statut !== 'ANNULEE',
      // ✅ NOUVEAU: Indicateurs pour la gestion du stock
      peut_liberer_stock: livraison.statut === 'ANNULEE' && 
                         livraison.annulation_origine === 'MANUELLE' && 
                         !livraison.stock_libere,
      stock_deja_libere: livraison.stock_libere || livraison.annulation_origine === 'COMMANDE'
    }));

    const livraisonsWithFinance = livraisonsAvecIndicateur.map(liv => {
      const detail = calculateLivraisonTotal(liv, { excludeEchec: true });
      return {
        ...liv,
        detail_financier: detail
      };
    });

    res.json(livraisonsWithFinance);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// ✅ NOUVELLE FONCTION: Lister les livraisons pour les chauffeurs (exclut les commandes annulées)
exports.listerPourChauffeurs = async (req, res) => {
  try {
    const { chauffeurId } = req.query;
    
    let filter = {};
    
    // Si un chauffeur spécifique est demandé, filtrer par voyage
    if (chauffeurId) {
      const Voyage = require('../models/Voyage');
      const voyagesChauffeur = await Voyage.find({ chauffeur: chauffeurId }).select('_id');
      const voyageIds = voyagesChauffeur.map(v => v._id);
      filter.voyage = { $in: voyageIds };
    }
    
    const livraisons = await Livraison.find(filter)
      .populate({
        path: "commande",
        select: "numero_commande statut date_creation id_formate sousTotal fraisLivraison codePromo fidelite client pointDeVente adresse_livraison mode_paiement",
        populate: [
          { path: "client", select: "nom prenom email telephone" },
          { path: "pointDeVente", select: "nom adresse telephone latitude longitude localisation_gps" },
          {
            path: "lignesCommande",
            select: "produit lot quantite quantite_restante prix_unitaire quantite_retournee",
            populate: [
              { 
                path: "produit",
                select: "nom reference image",
                populate: { path: "unite" }
              },
              { path: "lot", select: "nom quantite_unitaire" }
            ]
          }
        ]
      })
      .populate({
        path: "voyage",
        select: "statut date_depart chauffeur camion id_formate numero_voyage",
        populate: [
          { path: "camion", select: "immatriculation marque modele", options: { withDeleted: true } },
          { 
            path: "chauffeur", 
            select: "nom prenom telephone", 
            options: { withDeleted: true },
            populate: { path: "utilisateur", select: "username", options: { withDeleted: true } } 
          }
        ]
      })
      .populate({
        path: "lignesLivraison",
        populate: [
          { 
            path: "produit",
            select: "nom reference image",
            options: { withDeleted: true },
            populate: { path: "unite", options: { withDeleted: true } }
          },
          { path: "lot", select: "nom quantite_unitaire" }
        ]
      })
      .lean();

    // ✅ FILTRAGE AUTOMATIQUE: Exclure les livraisons de commandes annulées
    const livraisonsLivrables = livraisons.filter(livraison => {
      // Exclure si la commande est annulée
      if (livraison.commande?.statut === 'ANNULEE') {
        return false;
      }
      
      // Exclure si la livraison est déjà livrée ou annulée
      if (livraison.statut === 'LIVREE' || livraison.statut === 'ANNULEE') {
        return false;
      }
      
      return true;
    });

    console.log(`🚚 Livraisons pour chauffeurs: ${livraisons.length} → ${livraisonsLivrables.length} livrables`);

    // Ajouter des indicateurs utiles pour l'interface chauffeur
    const livraisonsAvecIndicateurs = livraisonsLivrables.map(livraison => ({
      ...livraison,
      peut_livrer: true, // Toutes les livraisons retournées peuvent être livrées
      statut_commande: livraison.commande?.statut,
      commande_active: livraison.commande?.statut !== 'ANNULEE'
    }));

    const livraisonsWithFinance = livraisonsAvecIndicateurs.map(liv => {
      const detail = calculateLivraisonTotal(liv, { excludeEchec: true });
      return {
        ...liv,
        detail_financier: detail
      };
    });

    res.json(livraisonsWithFinance);

  } catch (err) {
    console.error('❌ Erreur listing livraisons chauffeurs:', err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

exports.getById = async (req, res) => {
  try {
    const livraison = await Livraison.findById(req.params.id)
      .populate({
        path: "commande",
        populate: [
          { path: "pointDeVente" },
          { 
            path: "lignesCommande", 
            select: "produit lot quantite prix_unitaire",
            populate: { path: "lot", select: "nom quantite_unitaire" }
          }
        ]
      })
      .populate({
        path: "voyage",
        select: "statut date_depart chauffeur camion id_formate numero_voyage",
        populate: [
          { path: "camion" },
          { 
            path: "chauffeur", 
            options: { withDeleted: true },
            populate: { path: "utilisateur", options: { withDeleted: true } } 
          }
        ]
      })
      .populate({
        path: "lignesLivraison",
        populate: [
          { 
            path: "produit",
            select: "nom reference image prix_unitaire prix_reference poids_unitaire",
            options: { withDeleted: true },
            populate: { path: "unite", options: { withDeleted: true } }
          },
          { path: "lot" }
        ]
      })
      .populate("camion_assigne");
    if (!livraison) return res.status(404).json({ message: "Livraison introuvable" });
    res.json(livraison);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * Créer une livraison (SANS déstockage)
 */
exports.creerLivraison = async (req, res) => {
  try {
    const { commandeId } = req.params;
    const { lignesLivraison, camion_assigne } = req.body;

    const commande = await Commande.findById(commandeId)
      .populate({
        path: "lignesCommande",
        populate: { 
          path: "produit",
          select: "nom reference image"
        }
      });

    if (!commande) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (!["PREPAREE", "EN_LIVRAISON"].includes(commande.statut)) {
      return res.status(400).json({ message: "Commande non livrable" });
    }

    // 🔒 Vérifier que les quantités livrées ne dépassent pas le restant (par produit + format)
    for (const ligneLiv of lignesLivraison) {
      const ligneCmd = commande.lignesCommande.find(
        l =>
          l.produit._id.toString() === ligneLiv.produit &&
          l.format_id.toString() === ligneLiv.format_id
      );

      if (!ligneCmd) {
        const Produit = require('../models/Produit');
        const produit = await Produit.findById(ligneLiv.produit);
        const produitNom = produit?.nom || ligneLiv.produit;
        return res.status(400).json({
          message: `Produit "${produitNom}" non présent dans la commande`
        });
      }

      // ⚠️ VÉRIFICATION CRITIQUE: La quantité demandée ne doit pas dépasser la quantité restante
      if (ligneLiv.quantite > ligneCmd.quantite_restante) {
        return res.status(400).json({
          message: `❌ Impossible de créer la livraison: La quantité spécifiée pour "${produitNom}" dépasse la quantité restante dans la commande.`
        });
      }

      // Vérification supplémentaire: quantité positive
      if (ligneLiv.quantite <= 0) {
        return res.status(400).json({
          message: `❌ La quantité doit être supérieure à 0`
        });
      }
    }

    // ⚖️ VÉRIFICATION DE LA CAPACITÉ DU CAMION
    const Produits = require('../models/Produit');
    const produitsInfos = await Produits.find({ _id: { $in: lignesLivraison.map(l => l.produit) } }).lean();
    
    let poidsLivraison = 0;
    for (const ligne of lignesLivraison) {
      const p = produitsInfos.find(prod => prod._id.toString() === ligne.produit);
      if (p && p.poids_unitaire) {
        poidsLivraison += p.poids_unitaire * ligne.quantite;
      }
    }

    // ✅ Toutes les validations sont passées, créer la livraison
    const livraison = new Livraison({
      commande: commandeId,
      lignesLivraison: lignesLivraison.map(l => ({
        produit: l.produit,
        format_id: l.format_id,
        quantite: l.quantite,
        lot: l.lot || null,
        quantite_lots: l.quantite_lots || null
      })),
      statut: "EN_ATTENTE",
      camion_assigne: camion_assigne || null,
      date_creation: new Date()
    });

    await livraison.save();

    // 📄 GÉNÉRATION AUTOMATIQUE DE LA FACTURE PROFORMA
    try {
      // S'assurer que la commande est populée pour le calcul financier
      if (!livraison.populated('commande')) {
        await livraison.populate('commande');
      }

      // CALCUL CENTRALISÉ VIA FINANCEUTILS
      const resultFinance = calculateLivraisonTotal(livraison, { excludeEchec: false });
      const montantTotal = resultFinance.total;

      // Mettre à jour le montant total de la livraison
      livraison.montant_total = montantTotal;
      await livraison.save();


      // Créer la facture proforma
      const Facture = require('../models/Facture');
      const nouvelleFacture = new Facture({
        livraison: livraison._id,
        commande: commandeId,
        montant_total: montantTotal,
        statut: 'PROFORMA', // Statut proforma pour facture avant livraison
        date_echeance: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 jours
      });

      await nouvelleFacture.save();
      
      // Mettre à jour la livraison avec la référence de la facture
      livraison.facture = nouvelleFacture._id;
      await livraison.save();
      
      console.log(`📄 Facture proforma générée: ${await nouvelleFacture.getIdFormate()}`);
      
      // Ajouter la facture à la réponse
      livraison.facture = nouvelleFacture;
      
    } catch (factureError) {
      console.error('❌ Erreur génération facture proforma:', factureError);
      // Ne pas bloquer la création de livraison si la facture échoue
    }

    // ✅ Mettre à jour quantite_restante dans les lignes de commande (produit + format)
    for (const ligneLiv of lignesLivraison) {
      const ligneCmd = commande.lignesCommande.find(
        l =>
          l.produit._id.toString() === ligneLiv.produit &&
          l.format_id.toString() === ligneLiv.format_id
      );

      if (ligneCmd) {
        const ancienneQte = ligneCmd.quantite_restante;
        ligneCmd.quantite_restante -= ligneLiv.quantite;
        await ligneCmd.save();
      }
    }

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('new_delivery', {
        timestamp: new Date()
      });
    }

    res.status(201).json({
      message: "Livraison créée avec succès",
      livraison
    });

    // 📢 Notifier les admins qu'une livraison a été créée par un responsable
    try {
      let responsableName = req.user?.username;
      if (!responsableName && req.user?.id) {
        const Utilisateur = require('../models/Utilisateur');
        const user = await Utilisateur.findById(req.user.id);
        if (user) responsableName = user.username;
      }
      responsableName = responsableName || 'Un responsable';
      await notifyAllAdmins(
        'LIVRAISON_CREEE',
        '📦 Nouvelle livraison créée',
        `${responsableName} a créé une nouvelle livraison`,
        { commandeId: commandeId }
      );
    } catch (notifErr) {
      console.error('❌ Erreur notification LIVRAISON_CREEE:', notifErr);
    }

  } catch (err) {
    console.error("❌ Erreur création livraison:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Changer statut livraison (DÉSTOCKAGE ICI)
 */
exports.changerStatutLivraison = async (req, res) => {
  // Utiliser une session MongoDB pour assurer l'atomicité
  const session = await mongoose.startSession();
  
  try {
    const { livraisonId } = req.params;
    const { statut } = req.body;

    // Démarrer la transaction
    await session.startTransaction();

    console.log('🔍 [DEBUG] Recherche livraison:', livraisonId);
    const livraison = await Livraison.findById(livraisonId)
      .populate({
        path: 'commande',
        select: 'lignesCommande pointDeVente client sousTotal fraisLivraison codePromo fidelite statut mode_paiement',
        populate: {
          path: 'lignesCommande',
          populate: [
            { path: 'lot' },
            { path: 'produit', select: 'nom prix_reference promotionActive' }
          ]
        }
      })
      .populate({
        path: 'voyage',
        populate: {
          path: 'chauffeur',
          populate: { path: 'utilisateur', select: 'username' }
        }
      })
      .session(session);
    
    if (!livraison) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Livraison introuvable" });
    }

    if (livraison.statut === "LIVREE") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Livraison déjà livrée" });
    }

    // ✅ NOUVEAU: Vérifier que la commande associée n'est pas annulée
    if (livraison.commande && livraison.commande.statut === "ANNULEE") {
      await session.abortTransaction();
      return res.status(400).json({ 
        message: "Impossible de livrer: la commande associée a été annulée",
        commandeId: livraison.commande._id,
        commandeStatut: livraison.commande.statut
      });
    }

    // ✅ NOUVEAU: Vérifier si le déstockage a déjà été effectué pour éviter les doubles clics
    if ((statut === "LIVREE" || statut === "ECHEC") && livraison.destockage_effectue) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Cette livraison a déjà été traitée" });
    }

    if (!["EN_ATTENTE", "EN_COURS", "LIVREE", "ECHEC"].includes(statut)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Statut invalide" });
    }

    // Vérifier que la raison est fournie pour un échec
    if (statut === "ECHEC" && !req.body.raison_echec) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Raison d'échec requise" });
    }

    // 🚚 LIVRAISON FINALE → DÉSTOCKAGE + MOUVEMENTS SORTIE
    if (statut === "LIVREE") {
      // ✅ NOUVEAU: Vérifier s'il y a au moins un produit qui n'est pas en échec
      const produitsValides = livraison.lignesLivraison.filter(ligne => ligne.statut_produit !== 'ECHEC');
      
      if (produitsValides.length === 0) {
        console.log('⚠️ Tentative de livraison sans produits valides (tous en échec)');
        await session.abortTransaction();
        return res.status(400).json({ 
          message: "Impossible de valider cette livraison car tous les produits ont été signalés en échec." 
        });
      }

        
      for (const [index, ligne] of livraison.lignesLivraison.entries()) {
        console.log(`🔍 [DEBUG] Traitement ligne ${index + 1}:`, {
          produit: ligne.produit,
          quantite: ligne.quantite,
          statut_produit: ligne.statut_produit
        });
        
        // ✅ NOUVELLE LOGIQUE: Ignorer les produits signalés en échec
        if (ligne.statut_produit === 'ECHEC') {
          console.log(`⏭️ [DEBUG] Produit signalé en échec ignoré: ${ligne.produit?.nom || ligne.produit} (déjà traité comme retour)`);
          continue; // Passer au produit suivant
        }
        
        // ✅ Utiliser le stock consolidé pour le déstockage immédiat
        const StockConsolide = require('../models/StockConsolide');
        const stockConsolide = await StockConsolide.findOne({ produit: ligne.produit?._id || ligne.produit }).session(session);
        
        if (!stockConsolide) {
          console.log('🔍 [DEBUG] Aucun stock consolidé trouvé pour ce produit');
          await session.abortTransaction();
          return res.status(400).json({
            message: "Aucun stock consolidé trouvé pour ce produit"
          });
        }
        
        console.log(`🔍 [DEBUG] Stock consolidé trouvé:`, {
          total: stockConsolide.quantite_totale,
          reserve: stockConsolide.quantite_reservee,
          disponible: stockConsolide.quantite_disponible
        });

        // Vérifier si assez de stock réservé
        if (stockConsolide.quantite_reservee < ligne.quantite) {
          console.log('🔍 [DEBUG] Stock consolidé réservé insuffisant:', {
            reserve: stockConsolide.quantite_reservee,
            requis: ligne.quantite
          });
          await session.abortTransaction();
          return res.status(400).json({
            message: `Stock réservé insuffisant pour valider la livraison.`
          });
        }

        // Récupérer les informations de lot depuis la commande
        const ligneCmd = livraison.commande?.lignesCommande?.find(lc => {
          const lcId = (lc.produit?._id || lc.produit).toString();
          const lId = (ligne.produit?._id || ligne.produit).toString();
          return lcId === lId;
        });
        const lot = ligneCmd?.lot;
        console.log('🔍 [DEBUG] Lot trouvé:', !!lot);

        // Préparer les informations de lot
        let lotInfo = null;
        
        // Obtenir l'ID formaté de la livraison (nouveau système)
        let livraisonIdFormate;
        try {
          console.log('🔍 [DEBUG] Appel getIdFormate...');
          livraisonIdFormate = await livraison.getIdFormate();
          console.log('🔍 [DEBUG] ID formaté obtenu:', livraisonIdFormate);
        } catch (formatError) {
          console.error('❌ [DEBUG] Erreur getIdFormate:', formatError.message);
          livraisonIdFormate = `LIV-${livraison._id}`;
          console.log('🔍 [DEBUG] ID formaté fallback:', livraisonIdFormate);
        }
        
        let commentaire = `Livraison individuelle ${livraisonIdFormate}`;
        
        if (lot) {
          const nbLots = Math.floor(ligne.quantite / lot.quantite_unitaire);
          const resteLots = ligne.quantite % lot.quantite_unitaire;
          
          lotInfo = {
            lot_id: lot._id,
            nom_lot: lot.nom,
            quantite_unitaire: lot.quantite_unitaire,
            nombre_lots: nbLots,
            reste_unites: resteLots
          };
        }

        // ✅ DÉSTOCKAGE IMMÉDIAT: Consommer le stock réservé (livraison effectuée)
        // Dans le nouveau système, on diminue seulement le stock réservé
        // Le stock total sera recalculé automatiquement: Total = Disponible + Réservé + Retourné
        stockConsolide.quantite_reservee -= ligne.quantite;  // Libérer la réservation
        stockConsolide.date_mise_a_jour = new Date();
        await stockConsolide.save({ session });
        
        console.log('🔍 [DEBUG] Stock consolidé mis à jour (déstockage immédiat):', {
          nouveau_total: stockConsolide.quantite_disponible + stockConsolide.quantite_reservee + stockConsolide.quantite_retournee,
          nouveau_disponible: stockConsolide.quantite_disponible,
          nouveau_reserve: stockConsolide.quantite_reservee,
          nouveau_retourne: stockConsolide.quantite_retournee
        });

        // Enregistrer le mouvement pour traçabilité (utiliser le premier stock individuel pour la référence)
        try {
          const stocks = await Stock.find({ produit: ligne.produit }).limit(1).session(session);
          if (stocks.length > 0) {
            console.log('🔍 [DEBUG] Appel enregistrerMouvement...');
            await enregistrerMouvement({
              stockId: stocks[0]._id,
              type: "SORTIE",
              quantite: ligne.quantite,
              utilisateurId: req.user?.id || null,
              reference: livraison._id,
              reference_type: "Livraison",
              commentaire: commentaire,
              lot_info: lotInfo,
              session: session  // Passer la session pour la transaction
            });
            console.log('🔍 [DEBUG] Mouvement enregistré avec succès');
          } else {
            console.log('🔍 [DEBUG] Aucun stock individuel trouvé pour le mouvement, passage sans enregistrement');
          }
        } catch (movementError) {
          console.error('❌ [DEBUG] Erreur enregistrement mouvement:', movementError.message);
          console.error('❌ [DEBUG] Stack mouvement:', movementError.stack);
          // Annuler la transaction en cas d'erreur de mouvement
          await session.abortTransaction();
          return res.status(500).json({ 
            message: "Erreur lors de l'enregistrement du mouvement", 
            error: movementError.message 
          });
        }
      }
      
      // ✅ Marquer que le déstockage a été effectué pour cette livraison
      livraison.destockage_effectue = true;
      console.log(`🔍 [DEBUG] Déstockage marqué comme effectué pour la livraison`);

      livraison.date_livraison = new Date();

      // 💰 NOUVEAU: Recalculer le montant total réel (en excluant les articles en échec partiel)
      let financialDetails = { total: livraison.montant_total };
      try {
        const { calculateLivraisonTotal } = require('../utils/financeUtils');
        financialDetails = calculateLivraisonTotal(livraison, { excludeEchec: true });
        livraison.montant_total = financialDetails.total;
        console.log(`💰 Montant total livraison recalculé après échecs partiels: ${livraison.montant_total} DT`);
      } catch (finErr) {
        console.error('❌ Erreur recalcul montant livraison:', finErr);
      }

      // 📄 MISE À JOUR DU STATUT DE LA FACTURE (version simplifiée)
      try {
        const Facture = require('../models/Facture');
        const facture = await Facture.findOne({ livraison: livraisonId }).session(session);
        
        if (facture) {
          if (facture.statut === 'PROFORMA') {
            // Passer la facture de PROFORMA à EN_ATTENTE lors de la livraison
            facture.statut = 'EN_ATTENTE';
          }
          // Toujours synchroniser le montant total final
          facture.montant_total = financialDetails.total;
          await facture.save({ session });
          console.log(`📄 Facture mise à jour: Statut=${facture.statut}, Montant=${facture.montant_total}`);
        }
      } catch (factureError) {
        console.error('❌ Erreur mise à jour facture:', factureError);
      }
    }

    // 🚫 ÉCHEC DE LIVRAISON → CRÉER UN RETOUR
    if (statut === "ECHEC") {
      console.log('🔍 [DEBUG] Traitement ECHEC - Création de retours');
      
      const Retour = require('../models/Retour');
      
      for (const [index, ligne] of livraison.lignesLivraison.entries()) {
        console.log(`🔍 [DEBUG] Création retour pour ligne ${index + 1}:`, {
          produit: ligne.produit,
          quantite: ligne.quantite
        });
        
        // Trouver la ligne de commande correspondante
        const ligneCmd = livraison.commande?.lignesCommande?.find(lc => {
          const lcId = (lc.produit?._id || lc.produit).toString();
          const lId = (ligne.produit?._id || ligne.produit).toString();
          return lcId === lId;
        });
        
        if (!ligneCmd) {
          console.error('❌ [DEBUG] Ligne de commande non trouvée pour le retour');
          await session.abortTransaction();
          return res.status(400).json({
            message: "Ligne de commande non trouvée pour créer le retour"
          });
        }
        
        // Calculer l'impact financier du retour (Convention unifiée : quantite × prix_unitaire = total)
        const impactFinancier = (ligne.quantite || 0) * (ligneCmd.prix_unitaire || 0);
        
        console.log('🔍 [DEBUG] Calcul impact financier:', {
          prix_unitaire: ligneCmd.prix_unitaire,
          quantite_unites: ligne.quantite,
          impact_calcule: impactFinancier
        });
        
        // Créer l'entrée de retour
        const retour = new Retour({
          ligneCommande: ligneCmd._id,
          quantite: ligne.quantite,
          quantite_lots: ligne.quantite_lots,
          motif: `Échec de livraison: ${req.body.raison_echec}`,
          impact_financier: impactFinancier,
          statut: 'TRAITE',
          utilisateur: req.user?.id,
          date_traitement: new Date()
        });
        
        await retour.save({ session });
        console.log('🔍 [DEBUG] Retour créé:', retour._id);
        
        // Ajouter la quantité au stock consolidé comme retour
        const StockConsolide = require('../models/StockConsolide');
        const stockConsolide = await StockConsolide.findOne({ produit: ligne.produit?._id || ligne.produit }).session(session);
        
        if (stockConsolide) {
          // Libérer la réservation et marquer comme retourné
          stockConsolide.quantite_reservee -= ligne.quantite;
          // Ajouter au stock retourné (sera compté dans le total automatiquement)
          stockConsolide.quantite_retournee += ligne.quantite;
          await stockConsolide.save({ session });
          
          console.log('🔍 [DEBUG] Stock consolidé mis à jour (échec → retour):', {
            nouveau_total: stockConsolide.quantite_disponible + stockConsolide.quantite_reservee + stockConsolide.quantite_retournee,
            nouveau_disponible: stockConsolide.quantite_disponible,
            nouveau_reserve: stockConsolide.quantite_reservee,
            nouveau_retourne: stockConsolide.quantite_retournee
          });
          
          // 🚀 NOUVEAU: Enregistrer le mouvement de stock pour traçabilité
          try {
            const { enregistrerMouvement } = require('./mouvement.controller');
            const Stock = require('../models/Stock');
            
            // Trouver un stock individuel pour l'enregistrement du mouvement
            const stockIndividuel = await Stock.findOne({ produit: ligne.produit }).session(session);
            
            if (stockIndividuel) {
              // Préparer les informations de lot si disponible
              let lotInfo = null;
              if (ligneCmd.lot) {
                const nbLots = ligne.quantite_lots || Math.floor(ligne.quantite / ligneCmd.lot.quantite_unitaire);
                const resteLots = ligne.quantite % ligneCmd.lot.quantite_unitaire;
                
                lotInfo = {
                  lot_id: ligneCmd.lot._id,
                  nom_lot: ligneCmd.lot.nom,
                  quantite_unitaire: ligneCmd.lot.quantite_unitaire,
                  nombre_lots: nbLots,
                  reste_unites: resteLots
                };
              }

              // Déterminer le nom de l'utilisateur pour le commentaire (chauffeur ou connecté)
              const auteurNom = req.user?.username || livraison.voyage?.chauffeur?.utilisateur?.username || 'Système';
              const auteurId = req.user?.id || livraison.voyage?.chauffeur?.utilisateur?._id || null;

              await enregistrerMouvement({
                stockId: stockIndividuel._id,
                type: "RETOUR",
                quantite: ligne.quantite,
                utilisateurId: auteurId,
                reference: livraison._id,
                reference_type: "Livraison",
                commentaire: `Retour automatique (${auteurNom}) - Échec de livraison: ${req.body.raison_echec}`,
                lot_info: lotInfo,
                session: session
              });

              console.log('🔍 [DEBUG] Mouvement de stock RETOUR enregistré:', {
                produit: ligne.produit,
                quantite: ligne.quantite,
                reference: livraison._id,
                motif: req.body.raison_echec
              });
            } else {
              console.warn(`⚠️ [DEBUG] Aucun stock individuel trouvé pour le produit ${ligne.produit}, mouvement non enregistré`);
            }
          } catch (movementError) {
            console.error(`❌ [DEBUG] Erreur enregistrement mouvement de stock:`, movementError.message);
            // Ne pas faire échouer la transaction pour une erreur de mouvement
          }
        }
        
        // Mettre à jour la ligne de commande
        ligneCmd.quantite_retournee = (ligneCmd.quantite_retournee || 0) + ligne.quantite;
        
        // ✅ CORRECTION: Diminuer aussi quantite_reellement_commandee en cas d'échec
        // Car cette quantité ne sera finalement pas livrée
        if (ligneCmd.quantite_reellement_commandee) {
          const ancienneQteReelle = ligneCmd.quantite_reellement_commandee;
          ligneCmd.quantite_reellement_commandee = Math.max(0, ligneCmd.quantite_reellement_commandee - ligne.quantite);
          console.log(`🔍 [DEBUG] Quantité réellement commandée mise à jour: ${ancienneQteReelle} → ${ligneCmd.quantite_reellement_commandee} (-${ligne.quantite} à cause de l'échec)`);
        }
        
        await ligneCmd.save({ session });
        console.log('🔍 [DEBUG] Ligne de commande mise à jour avec quantité retournée et quantité réellement commandée diminuée');
      }
      
      // ✅ Marquer que le traitement a été effectué pour cette livraison (échec)
      livraison.destockage_effectue = true;
      console.log('🔍 [DEBUG] Traitement échec marqué comme effectué pour la livraison');
    }

    console.log('🔍 [DEBUG] Mise à jour du statut de la livraison...');
    // Sauvegarder l'ancien statut pour le log
    const ancienStatut = livraison.statut;
    livraison.statut = statut;
    
    // Ajouter la raison d'échec si nécessaire + mettre la facture à 0
    if (statut === "ECHEC") {
      livraison.raison_echec = req.body.raison_echec;
      livraison.montant_total = 0;
      
      // Mettre la facture à 0 en cas d'échec complet
      try {
        const Facture = require('../models/Facture');
        const facture = await Facture.findOne({ livraison: livraisonId }).session(session);
        if (facture) {
          facture.montant_total = 0;
          await facture.save({ session });
          console.log(`📄 Facture mise à 0 (livraison ECHEC)`);
        }

      } catch (factureErr) {
        console.error('❌ Erreur mise à jour facture (ECHEC):', factureErr);
      }
    } else {
      // Effacer la raison d'échec si on change vers un autre statut
      livraison.raison_echec = undefined;
    }

    // ✅ NOUVEAU: Gérer les informations de paiement (Support multi-méthodes)
    if (statut === "LIVREE") {
      if (req.body.montant_total !== undefined) {
        livraison.montant_total = req.body.montant_total;
      }
      
      // Gérer le tableau de paiements multiples
      if (req.body.paiements && Array.isArray(req.body.paiements)) {
        // ✅ CORRECTION: AJOUTER les nouveaux paiements aux existants (ne pas écraser les avances)
        const nouveauxPaiements = req.body.paiements
          .filter(p => p.montant > 0) // Ignorer les paiements à 0
          .map(p => ({
            methode: p.methode,
            montant: p.montant,
            date: p.date || new Date()
          }));
        
        if (nouveauxPaiements.length > 0) {
          livraison.paiements.push(...nouveauxPaiements);
        }
        
        // Calculer le montant_paye CUMULATIF (avances + nouveaux paiements)
        livraison.montant_paye = livraison.paiements.reduce((sum, p) => sum + (p.montant || 0), 0);
      } 
      // Fallback pour compatibilité ascendante si montant_paye est envoyé seul
      else if (req.body.montant_paye !== undefined) {
        // ✅ CORRECTION: Ajouter au montant existant, ne pas remplacer
        const montantAdditionnel = Math.max(0, req.body.montant_paye - (livraison.montant_paye || 0));
        if (montantAdditionnel > 0 && req.body.methode_paiement) {
          livraison.paiements.push({
            methode: req.body.methode_paiement,
            montant: montantAdditionnel,
            date: new Date()
          });
        }
        livraison.montant_paye = livraison.paiements.reduce((sum, p) => sum + (p.montant || 0), 0);
      }
      
      // Vérifier si la commande a été payée en ligne par carte bancaire
      const isCardOrder = livraison.commande && (
        livraison.commande.mode_paiement === 'CARTE' || 
        livraison.commande.mode_paiement === 'CARTE_STRIPE' || 
        livraison.commande.mode_paiement === 'stripe'
      );
      const isOrderPaid = livraison.commande && (
        livraison.commande.statut_paiement === 'PAYEE' || 
        livraison.commande.statut_paiement === 'PAYEE_CARTE'
      );

      if (isCardOrder || isOrderPaid) {
        console.log(`💳 [DEBUG] Commande payée en ligne par carte. Validation automatique du paiement de la livraison.`);
        livraison.statut_paiement = "PAYEE";
        livraison.montant_paye = livraison.montant_total;
        if (!livraison.paiements.some(p => p.methode === 'CARTE' || p.methode === 'CARTE_STRIPE')) {
          livraison.paiements.push({
            methode: 'CARTE',
            montant: livraison.montant_total,
            date: new Date()
          });
        }
      } else {
        // Calculer le statut de paiement basé sur montant_paye
        // ✅ TOLÉRANCE: Tolérance de 1 DT comme demandé (ex: 258 DT payés pour 258,01 DT)
        if (livraison.montant_paye >= (livraison.montant_total - 0.999) && livraison.montant_total > 0) {
          livraison.statut_paiement = "PAYEE";
        } else if (livraison.montant_paye > 0) {
          livraison.statut_paiement = "PARTIELLEMENT_PAYEE";
        } else {
          livraison.statut_paiement = "NON_PAYEE";
        }
      }

      // Synchroniser avec la facture associée
      try {
        const facture = await Facture.findOne({ livraison: livraisonId }).session(session);
        if (facture) {
          facture.statut = livraison.statut_paiement === 'NON_PAYEE' ? 'EN_ATTENTE' : livraison.statut_paiement;
          if (livraison.montant_total !== undefined) {
            facture.montant_total = livraison.montant_total;
          }
          await facture.save({ session });
          console.log(`📄 Statut facture synchronisé: ${facture.statut}`);
        }
      } catch (factureErr) {
        console.error('❌ Erreur synchronisation facture (LIVREE):', factureErr);
      }
    }
    
    await livraison.save({ session });
    console.log('🔍 [DEBUG] Livraison sauvegardée avec succès');

    // ✅ NOUVEAU: Mettre à jour le total dépensé du client Marketplace si livré
    if (statut === "LIVREE" && livraison.commande?.client) {
      try {
        const Client = require('../models/Client');
        const client = await Client.findById(livraison.commande.client).session(session);
        if (client) {
          await client.updateSpend(livraison.montant_total);
          console.log(`💰 Stats depenses mises à jour pour client Marketplace: +${livraison.montant_total} DT`);
        }
      } catch (clientStatsErr) {
        console.error('❌ Erreur mise à jour stats client Marketplace:', clientStatsErr);
        // On ne fait pas échouer la transaction pour ça
      }
    }
    
    console.log(`🔄 Changement statut livraison ${livraisonId}: ${ancienStatut} → ${statut}`);

    // 📢 Notifier les responsables et admins pour les changements de statut importants
    try {
      // Récupérer le nom du chauffeur via la livraison -> voyage -> chauffeur
      let chauffeurName = 'Un chauffeur';
      if (livraison.voyage) {
        const Voyage = require('../models/Voyage');
        const voyageComplet = await Voyage.findById(livraison.voyage)
          .populate({ path: 'chauffeur', populate: { path: 'utilisateur', select: 'username' } });
        chauffeurName = voyageComplet?.chauffeur?.utilisateur?.username || 'Un chauffeur';
      }

      if (statut === 'LIVREE') {
        const title = '✅ Livraison effectuée';
        const msg = `${chauffeurName} a marqué une livraison comme livrée`;
        const data = { deliveryId: livraisonId, voyageId: livraison.voyage };
        
        const notifications = [
          notifyAllResponsables('LIVRAISON_LIVREE', title, msg, data),
          notifyAllAdmins('LIVRAISON_LIVREE', title, msg, data)
        ];

        // ⚠️ NOUVEAU: Notification pour remboursement si trop-perçu (avance > total)
        console.log(`🔍 [DEBUG-Paiement] Livraison ${livraisonId}: Payé=${livraison.montant_paye}, Total=${livraison.montant_total}`);
        if (livraison.montant_paye > livraison.montant_total + 0.001) {
          const diff = (livraison.montant_paye - livraison.montant_total).toFixed(3);
          const refundTitle = '💰 Remboursement requis';
          
          // Récupérer un ID lisible pour la notification
          let readableId = livraisonId;
          try {
            // Tenter d'utiliser l'id_formate s'il est déjà peuplé ou disponible
            readableId = livraison.id_formate || await livraison.getIdFormate() || livraisonId;
          } catch (e) {
            console.warn('Erreur getIdFormate pour notification:', e.message);
          }

          const refundMsg = `Remboursement de ${diff} DT requis pour la livraison ${readableId}. L'avance (${livraison.montant_paye.toFixed(3)} DT) est supérieure au montant final (${livraison.montant_total.toFixed(3)} DT).`;
          
          notifications.push(
            notifyAllResponsables('LIVRAISON_REMBOURSEMENT', refundTitle, refundMsg, { ...data, amount: diff }),
            notifyAllAdmins('LIVRAISON_REMBOURSEMENT', refundTitle, refundMsg, { ...data, amount: diff })
          );
          console.log(`📢 Notification remboursement envoyée pour ${readableId}: ${diff} DT`);

          // 🆕 Trace dans les mouvements pour traçabilité financière
          await enregistrerMouvement({
            type: 'PAIEMENT',
            quantite: 0,
            utilisateurId: req.user?.id,
            reference: livraison._id,
            reference_type: 'Livraison',
            commentaire: `⚠️ Remboursement requis: ${diff} DT (Avance: ${livraison.montant_paye.toFixed(3)} DT, Final: ${livraison.montant_total.toFixed(3)} DT)`,
            session
          });
        }

        await Promise.all(notifications);
      } else if (statut === 'ECHEC') {
        const title = '⚠️ Livraison en échec';
        const msg = `${chauffeurName} a signalé un échec de livraison : ${req.body.raison_echec || 'raison non précisée'}`;
        const data = { deliveryId: livraisonId, voyageId: livraison.voyage };
        
        const notifications = [
          notifyAllResponsables('LIVRAISON_ECHEC', title, msg, data),
          notifyAllAdmins('LIVRAISON_ECHEC', title, msg, data)
        ];

        // ⚠️ NOUVEAU: Notification pour remboursement total si l'avance existe sur un échec complet
        if (livraison.montant_paye > 0.001) {
          const diff = livraison.montant_paye.toFixed(3);
          const refundTitle = '💰 Remboursement total requis';
          
          let readableId = livraisonId;
          try {
            readableId = livraison.id_formate || await livraison.getIdFormate() || livraisonId;
          } catch (e) {}

          const refundMsg = `Remboursement TOTAL de ${diff} DT requis pour la livraison ${readableId}. Livraison en ÉCHEC mais avance déjà payée.`;
          
          notifications.push(
            notifyAllResponsables('LIVRAISON_REMBOURSEMENT', refundTitle, refundMsg, { ...data, amount: diff }),
            notifyAllAdmins('LIVRAISON_REMBOURSEMENT', refundTitle, refundMsg, { ...data, amount: diff })
          );
          console.log(`📢 Notification remboursement TOTAL envoyée pour ${readableId}: ${diff} DT`);

          // 🆕 Trace dans les mouvements pour traçabilité financière
          await enregistrerMouvement({
            type: 'PAIEMENT',
            quantite: 0,
            utilisateurId: req.user?.id,
            reference: livraison._id,
            reference_type: 'Livraison',
            commentaire: `🛑 ÉCHEC - Remboursement TOTAL requis: ${diff} DT (Avance: ${diff} DT, Livraison échouée)`,
            session
          });
        }

        await Promise.all(notifications);
      }
    } catch (notifErr) {
      console.error('❌ Erreur notification statut livraison:', notifErr);
    }

    // 🔁 Mise à jour statut commande selon la logique métier
    try {
      const { calculerStatutCommande } = require('./commande.controller');
      
      // Utiliser la nouvelle logique de calcul de statut
      const statutInfo = await calculerStatutCommande(livraison.commande);
      
      if (statutInfo) {
        const commande = await Commande.findById(livraison.commande).session(session);
        
        if (commande && commande.statut !== statutInfo.statut) {
          const ancienStatut = commande.statut;
          commande.statut = statutInfo.statut;
          
          // Ajouter les informations de pourcentage si disponibles
          if (statutInfo.pourcentageLivraison !== null) {
            commande.pourcentage_livraison = statutInfo.pourcentageLivraison;
          }
          
          await commande.save({ session });

          // 📧 Notification Email
          orderEmitter.emit('order_status_changed', { 
            commandeId: commande._id, 
            oldStatus: ancienStatut, 
            newStatus: statutInfo.statut, 
            source: 'SYSTEME',
            commentaire: `Mise à jour automatique suite à livraison (${statutInfo.pourcentageLivraison || 0}%)`
          });
          
          console.log(`✅ Commande ${commande.numero_commande} mise à jour: ${ancienStatut} → ${statutInfo.statut}${statutInfo.pourcentageLivraison ? ` (${statutInfo.pourcentageLivraison}%)` : ''}`);
        } else if (commande) {

          console.log(`📋 Commande ${commande.numero_commande} reste en statut ${commande.statut}${statutInfo.pourcentageLivraison ? ` (${statutInfo.pourcentageLivraison}%)` : ''}`);
        }
      }
    } catch (commandeError) {
      console.error('❌ [DEBUG] Erreur mise à jour commande:', commandeError.message);
      console.error('❌ [DEBUG] Stack commande:', commandeError.stack);
      // Annuler la transaction en cas d'erreur de mise à jour de commande
      await session.abortTransaction();
      return res.status(500).json({ 
        message: "Erreur lors de la mise à jour de la commande", 
        error: commandeError.message 
      });
    }

    // ✅ Valider la transaction - toutes les opérations ont réussi
    await session.commitTransaction();
    console.log('🔍 [DEBUG] Transaction validée avec succès');

    // 🎯 FIDÉLITÉ: Attribution des points après confirmation de livraison
    if (statut === "LIVREE" && livraison.commande && livraison.commande.client) {
      try {
        const { earnPoints, getPointsConfig } = require('../services/pointsService');
        const config = await getPointsConfig();
        
        // On utilise le montant_total de la livraison (qui peut être différent du total commande si livraison partielle)
        const basePoints = Math.round((livraison.montant_total || 0) * (config.pointsParDT || 10));
        
        if (basePoints > 0) {
          await earnPoints(
            livraison.commande.client._id || livraison.commande.client,
            basePoints,
            `Achat marketplace - Livraison #${livraison.id_formate || livraison._id}`
          );
          console.log(`⭐ Points fidélité attribués au client ${livraison.commande.client._id || livraison.commande.client}: ${basePoints} pts`);
        }
      } catch (pointsErr) {
        console.error('❌ Erreur attribution points fidélité:', pointsErr);
      }
    }

    console.log('🔍 [DEBUG] Fin du traitement, envoi de la réponse');

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('delivery_status_changed', {
        _id: livraison._id,
        statut: statut,
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('order_status_changed', {
        timestamp: new Date()
      });
      // Emit a specific event if the voyage/chauffeur needs tracking updates
      if (livraison.voyage) {
        dashboardIo.to('staff').emit('voyage_updated', {
          _id: livraison.voyage,
          timestamp: new Date()
        });
      }
    }

    res.json({
      message: "Statut livraison mis à jour",
      livraison
    });

  } catch (err) {
    // ❌ Annuler la transaction en cas d'erreur
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error('❌ [CRITIQUE] Erreur dans changerStatutLivraison:', err.message);
    console.error('❌ [CRITIQUE] Stack:', err.stack);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  } finally {
    // Toujours fermer la session
    await session.endSession();
  }
};


/**
 * Supprimer/Annuler une livraison
 */
exports.supprimerLivraison = async (req, res) => {
  try {
    const { id } = req.params;
    const livraison = await Livraison.findById(id);

    if (!livraison) {
      return res.status(404).json({ message: "Livraison introuvable" });
    }

    if (livraison.statut === "LIVREE") {
      return res.status(400).json({ message: "Impossible de supprimer une livraison déjà livrée" });
    }

    // ⚠️ IMPORTANT: Vérifier si la livraison est déjà annulée
    if (livraison.statut === "ANNULEE") {
      return res.status(400).json({ message: "Livraison déjà annulée" });
    }

    console.log(`🗑️ Annulation livraison ${id} (statut actuel: ${livraison.statut})`);

    // Récupérer la commande pour remettre les quantités
    const commande = await Commande.findById(livraison.commande)
      .populate({
        path: "lignesCommande",
        populate: [
          { path: "produit" },
          { path: "lot" }
        ]
      });

    // Populer les lignes de livraison avec les lots
    await livraison.populate({
      path: "lignesLivraison",
      populate: [
        { path: "produit" },
        { path: "lot" }
      ]
    });

    if (commande) {
      console.log(`📦 Libération automatique du stock pour la livraison annulée ${id}`);
      let prixTotalARetirer = 0;

      // Pour chaque ligne de livraison, libérer le stock et mettre à jour la commande
      for (const ligneLiv of livraison.lignesLivraison) {
        // Trouver la ligne de commande correspondante (produit + lot)
        const ligneCmd = commande.lignesCommande.find(lc => {
          const produitMatch = lc.produit?._id?.toString() === ligneLiv.produit?._id?.toString();
          if (ligneLiv.lot) {
            const lotMatch = lc.lot?._id?.toString() === ligneLiv.lot?._id?.toString();
            return produitMatch && lotMatch;
          }
          return produitMatch && !lc.lot;
        });

        if (ligneCmd) {
          // Quantité à libérer (en unités)
          const quantiteALibererUnites = ligneLiv.quantite;
          
          // Calculer l'équivalent en lots pour la facturation/annulation
          let quantiteALibererLots;
          if (ligneCmd.lot && ligneCmd.lot.quantite_unitaire) {
            quantiteALibererLots = ligneLiv.quantite_lots || Math.floor(quantiteALibererUnites / ligneCmd.lot.quantite_unitaire);
          } else {
            quantiteALibererLots = quantiteALibererUnites;
          }

          // ÉTAPE 1: Libérer le stock réservé dans StockConsolide
          try {
            const sc = await StockConsolide.findOne({ produit: ligneLiv.produit._id });
            if (sc) {
              await sc.libererStockReserve(quantiteALibererUnites);
              console.log(`    🔓 Stock réservé libéré pour ${ligneCmd.produit?.nom}: ${quantiteALibererUnites} unités`);
            }
          } catch (scErr) {
            console.error(`    ⚠️ Erreur libération stock réservé pour ${ligneCmd.produit?.nom}:`, scErr.message);
          }

          // ÉTAPE 2: Mettre à jour la ligne de commande (Retrait définitif)
          // Convention unifiée : quantite × prix_unitaire = total
          const prixUnitaire = ligneCmd.prix_unitaire || 0;
          prixTotalARetirer += (quantiteALibererUnites * prixUnitaire);

          // On retire définitivement la quantité de la commande "réellement commandée"
          ligneCmd.quantite_reellement_commandee = Math.max(0, (ligneCmd.quantite_reellement_commandee || ligneCmd.quantite) - quantiteALibererUnites);
          ligneCmd.quantite_annulee = (ligneCmd.quantite_annulee || 0) + quantiteALibererUnites;
          // La quantite_restante reste inchangée par rapport à avant la remise (puisqu'on n'ajoute pas les annulés)
          
          await ligneCmd.save();

          // Enregistrer le mouvement de LIBERATION
          try {
            const stocksMouvement = await Stock.find({ produit: ligneLiv.produit._id }).limit(1);
            await enregistrerMouvement({
              stockId: stocksMouvement[0]?._id,
              type: "LIBERATION",
              quantite: quantiteALibererUnites,
              utilisateurId: req.user?.id,
              reference: livraison._id,
              reference_type: "Livraison",
              commentaire: `Libération automatique - Annulation livraison ${id}`,
              lot_info: ligneLiv.lot ? {
                lot_id: ligneLiv.lot._id,
                nom_lot: ligneCmd.lot?.nom,
                quantite_unitaire: ligneCmd.lot?.quantite_unitaire,
                nombre_lots: quantiteALibererLots,
                reste_unites: quantiteALibererUnites % (ligneCmd.lot?.quantite_unitaire || 1)
              } : null
            });
          } catch (movErr) {
            console.warn(`    ⚠️ Erreur mouvement libération:`, movErr.message);
          }
        }
      }

      // ÉTAPE 3: Recalculer le prix total de la commande
      if (prixTotalARetirer > 0) {
        commande.prix_total = Math.max(0, (commande.prix_total || 0) - prixTotalARetirer);
        console.log(`  💰 Prix commande réduit de ${prixTotalARetirer.toFixed(2)} DT`);
      }

      // 🔄 Vérifier si on doit annuler la commande entière
      const autresLivraisons = await Livraison.find({
        commande: livraison.commande,
        _id: { $ne: id },
        statut: { $ne: "ANNULEE" }
      });

      if (autresLivraisons.length === 0) {
        console.log(`  🚫 Toutes les livraisons annulées. Annulation de la commande ${commande._id}`);
        commande.statut = "ANNULEE";
      } else if (commande.statut === "EN_LIVRAISON") {
        const aLivraisonActive = autresLivraisons.some(l => ["EN_COURS", "LIVREE"].includes(l.statut));
        if (!aLivraisonActive) {
          commande.statut = "PREPAREE";
        }
      }
      
      await commande.save();
    }

    // Marquer comme annulée
    livraison.statut = "ANNULEE";
    livraison.annulation_origine = "MANUELLE";
    livraison.stock_libere = true; // ✅ Marqué comme libéré automatiquement
    await livraison.save();

    // 📢 Créer une notification pour le chauffeur si la livraison était assignée à un voyage
    try {
      const voyage = await require("../models/Voyage").findOne({ 
        livraisons: livraison._id 
      }).populate({
        path: 'chauffeur',
        populate: { path: 'utilisateur' }
      });

      if (voyage && voyage.chauffeur && voyage.chauffeur.utilisateur) {
        await createDeliveryNotification(
          voyage.chauffeur.utilisateur._id,
          await livraison.populate({
            path: 'commande',
            populate: { path: 'pointDeVente' }
          }),
          'DELIVERY_CANCELLED'
        );
      }
    } catch (notifErr) {
      console.error("❌ Erreur création notification annulation:", notifErr);
      // Ne pas faire échouer l'annulation pour une erreur de notification
    }

    console.log(`✅ Livraison ${id} annulée avec succès`);

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('delivery_status_changed', {
        _id: id,
        statut: 'ANNULEE',
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('order_status_changed', {
        timestamp: new Date()
      });
    }

    res.json({ message: "Livraison annulée" });
  } catch (err) {
    console.error("❌ Erreur annulation livraison:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Créer une livraison avec sélection de produits (pour le responsable)
 */
exports.creerLivraisonAvecSelection = async (req, res) => {
  try {
    const { commandeId } = req.params;
    const { lignesLivraison, camion_assigne } = req.body;

    console.log(`🚚 Création livraison avec sélection pour commande ${commandeId}`);
    console.log('📦 Lignes sélectionnées:', JSON.stringify(lignesLivraison, null, 2));

    const commande = await Commande.findById(commandeId)
      .populate({
        path: "lignesCommande",
        populate: [
          { path: "produit" },
          { path: "lot" }
        ]
      });

    if (!commande) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    console.log(`📋 Commande trouvée: ${commande.id_formate || commande._id}`);
    console.log(`   Lignes de commande: ${commande.lignesCommande.length}`);
    for (const ligne of commande.lignesCommande) {
      console.log(`   - ${ligne.produit?.nom} | Lot: ${ligne.lot?.nom || 'sans lot'} | Restant: ${ligne.quantite_restante}`);
    }

    // Vérifier si la commande est préparée ou en livraison (pour livraisons partielles)
    const statutsValides = ['PREPAREE', 'preparee', 'Préparée', 'préparée', 'Preparee', 'PRÉPARÉE', 'EN_LIVRAISON'];
    if (!statutsValides.includes(commande.statut)) {
      return res.status(400).json({
        message: `Seules les commandes préparées ou en livraison peuvent être livrées. Statut actuel: ${commande.statut}`
      });
    }

    // Valider chaque ligne de livraison
    for (const ligneLiv of lignesLivraison) {
      console.log(`\n🔍 Validation ligne livraison:`, {
        produit: ligneLiv.produit,
        quantite: ligneLiv.quantite,
        lot: ligneLiv.lot,
        quantite_lots: ligneLiv.quantite_lots
      });

      // Chercher la ligne de commande correspondante (produit + lot)
      const ligneCmd = commande.lignesCommande.find(l => {
        const produitMatch = l.produit._id.toString() === ligneLiv.produit;
        
        // Si la livraison spécifie un lot, vérifier qu'il correspond
        if (ligneLiv.lot) {
          const lotMatch = l.lot && l.lot._id.toString() === ligneLiv.lot;
          console.log(`  Comparaison avec ligne commande:`, {
            ligneId: l._id,
            produitMatch,
            lotCommande: l.lot?._id?.toString(),
            lotLivraison: ligneLiv.lot,
            lotMatch,
            match: produitMatch && lotMatch
          });
          return produitMatch && lotMatch;
        }
        // Sinon, chercher une ligne sans lot
        console.log(`  Comparaison avec ligne commande (sans lot):`, {
          ligneId: l._id,
          produitMatch,
          hasLot: !!l.lot,
          match: produitMatch && !l.lot
        });
        return produitMatch && !l.lot;
      });

      if (!ligneCmd) {
        // Essayer de trouver le nom du produit pour un meilleur message d'erreur
        const Produit = require('../models/Produit');
        const produit = await Produit.findById(ligneLiv.produit);
        const produitNom = produit?.nom || ligneLiv.produit;
        const lotInfo = ligneLiv.lot ? ` (lot spécifique)` : '';
        
        // Afficher toutes les lignes disponibles pour debug
        console.log(`❌ Ligne non trouvée. Lignes disponibles dans la commande:`);
        for (const l of commande.lignesCommande) {
          console.log(`  - Produit: ${l.produit._id}, Lot: ${l.lot?._id || 'null'}, Qté restante: ${l.quantite_restante}`);
        }
        
        return res.status(400).json({
          message: `Produit "${produitNom}"${lotInfo} non présent dans la commande`
        });
      }

      const quantiteRestante = ligneCmd.quantite_restante !== undefined ?
        ligneCmd.quantite_restante : ligneCmd.quantite;

      console.log(`  ✅ Ligne trouvée:`, {
        ligneId: ligneCmd._id,
        produit: ligneCmd.produit?.nom,
        lot: ligneCmd.lot?._id,
        quantite: ligneCmd.quantite,
        quantiteRestante,
        quantiteDemandee: ligneLiv.quantite
      });

      if (ligneLiv.quantite > quantiteRestante) {
        return res.status(400).json({
          message: `Quantité demandée (${ligneLiv.quantite}) supérieure à la quantité disponible (${quantiteRestante}) pour le produit ${ligneCmd.produit?.nom || ligneLiv.produit}`
        });
      }

      if (ligneLiv.quantite <= 0) {
        return res.status(400).json({
          message: `La quantité doit être supérieure à 0`
        });
      }
    }

    // ⚖️ NOUVEAU: Calculer le poids total de la livraison pour persistance
    let poidsCalculé = 0;
    for (const ligneLiv of lignesLivraison) {
      const ligneCmd = commande.lignesCommande.find(l => {
        const pId = (l.produit._id || l.produit).toString();
        const lpId = (ligneLiv.produit?._id || ligneLiv.produit).toString();
        return pId === lpId;
      });
      if (ligneCmd && ligneCmd.produit) {
        const pU = parseFloat(ligneCmd.produit.poids_unitaire || 0);
        poidsCalculé += (parseFloat(ligneLiv.quantite || 0) * pU);
      }
    }

    // Créer la livraison
    const livraison = new Livraison({
      commande: commandeId,
      poids_total: poidsCalculé, // 🚀 Persister le poids calculé
      lignesLivraison: lignesLivraison.map(ligne => ({
        produit: ligne.produit,
        quantite: ligne.quantite,
        lot: ligne.lot || null, // Inclure le lot pour distinguer les lignes
        quantite_lots: ligne.quantite_lots || null
      })),
      statut: "EN_ATTENTE",
      camion_assigne: camion_assigne || null,
      date_creation: new Date()
    });

    await livraison.save();
    console.log(`✅ Livraison ${livraison._id} créée avec sélection`);

    // Mettre à jour les quantités restantes (par produit ET lot)
    for (const ligneLiv of lignesLivraison) {
      // Chercher la ligne de commande correspondante (produit + lot)
      const ligneCmd = commande.lignesCommande.find(l => {
        const produitMatch = l.produit._id.toString() === ligneLiv.produit;
        if (ligneLiv.lot) {
          const lotMatch = l.lot && l.lot._id.toString() === ligneLiv.lot;
          return produitMatch && lotMatch;
        }
        return produitMatch && !l.lot;
      });

      if (ligneCmd) {
        const ancienneQte = ligneCmd.quantite_restante !== undefined ?
          ligneCmd.quantite_restante : ligneCmd.quantite;

        ligneCmd.quantite_restante = ancienneQte - ligneLiv.quantite;
        await ligneCmd.save();

        const lotInfo = ligneLiv.lot ? ` (lot)` : '';
        console.log(`📝 Mise à jour ${ligneCmd.produit?.nom}${lotInfo}: ${ancienneQte} → ${ligneCmd.quantite_restante}`);
      }
    }

    // La commande reste en statut PREPAREE
    // Elle passera à EN_LIVRAISON quand une livraison passera à EN_COURS
    console.log(`📋 Livraison créée, commande reste en statut ${commande.statut}`);

    // Populer la livraison créée
    const livraisonComplete = await Livraison.findById(livraison._id)
      .populate("commande")
      .populate({
        path: "lignesLivraison",
        populate: [
          { path: "produit" },
          { path: "lot" }
        ]
      });

    // 📄 GÉNÉRATION AUTOMATIQUE DE LA FACTURE PROFORMA
    try {
      // CALCUL CENTRALISÉ VIA FINANCEUTILS
      const resultFinance = calculateLivraisonTotal(livraisonComplete, { excludeEchec: false });
      const montantTotal = resultFinance.total;

      // Mettre à jour le montant total de la livraison (CRITIQUE pour le dashboard)
      await Livraison.findByIdAndUpdate(livraisonComplete._id, { 
        montant_total: montantTotal 
      });
      
      // Mettre à jour l'objet en mémoire pour la suite
      livraisonComplete.montant_total = montantTotal;

      // Créer la facture proforma
      const Facture = require('../models/Facture');
      const nouvelleFacture = new Facture({
        livraison: livraisonComplete._id,
        commande: commandeId,
        montant_total: montantTotal,
        statut: 'PROFORMA', // Statut proforma pour facture avant livraison
        date_echeance: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 jours
      });

      await nouvelleFacture.save();
      
      // Mettre à jour la livraison avec la référence de la facture
      await Livraison.findByIdAndUpdate(livraisonComplete._id, { 
        facture: nouvelleFacture._id 
      });
      
      console.log(`📄 Facture proforma générée: ${await nouvelleFacture.getIdFormate()}`);
      
      // Ajouter la facture à la réponse
      livraisonComplete.facture = nouvelleFacture;
      
    } catch (factureError) {
      console.error('❌ Erreur génération facture proforma:', factureError);
      // Ne pas bloquer la création de livraison si la facture échoue
    }

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('new_delivery', {
        timestamp: new Date()
      });
    }

    res.status(201).json({
      message: "Livraison créée avec succès",
      livraison: livraisonComplete
    });

  } catch (err) {
    console.error("❌ Erreur création livraison avec sélection:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Diviser une livraison existante en deux (split)
 */
exports.splitLivraison = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetWeight, manualLignes } = req.body;

    console.log(`✂️ Tentative de split livraison ${id} avec cible ${targetWeight} kg`);

    const livraisonOrigine = await Livraison.findById(id)
      .populate({
        path: "lignesLivraison",
        populate: { path: "produit" }
      })
      .populate({
        path: "commande",
        populate: {
          path: "lignesCommande",
          populate: { path: "lot" }
        }
      });

    if (!livraisonOrigine) {
      return res.status(404).json({ message: "Livraison introuvable" });
    }

    if (livraisonOrigine.statut !== "EN_ATTENTE") {
      return res.status(400).json({ message: "Seule une livraison EN_ATTENTE peut être divisée" });
    }

    // Calculer les nouvelles lignes
    let currentWeight = 0;
    const lignesGarder = [];
    const lignesBouger = [];

    if (manualLignes && Array.isArray(manualLignes)) {
      // MODE MANUEL: L'utilisateur a choisi précisément ce qu'il veut garder
      for (const ligneOrigine of livraisonOrigine.lignesLivraison) {
        const manualLigne = manualLignes.find(ml => 
          ml.produit.toString() === (ligneOrigine.produit._id || ligneOrigine.produit).toString() &&
          (ml.lot?.toString() === ligneOrigine.lot?.toString())
        );

        const qtyGarder = manualLigne ? parseFloat(manualLigne.quantite || 0) : 0;
        const qtyOrigine = parseFloat(ligneOrigine.quantite || 0);

        if (qtyGarder > 0) {
          const ratioLots = ligneOrigine.quantite_lots ? (ligneOrigine.quantite_lots / qtyOrigine) : null;
          
          lignesGarder.push({
            produit: ligneOrigine.produit._id || ligneOrigine.produit,
            quantite: Math.min(qtyGarder, qtyOrigine),
            lot: ligneOrigine.lot,
            quantite_lots: ratioLots ? Math.min(qtyGarder, qtyOrigine) * ratioLots : null
          });
          
          currentWeight += Math.min(qtyGarder, qtyOrigine) * parseFloat(ligneOrigine.produit?.poids_unitaire || 0);
        }

        if (qtyOrigine > qtyGarder) {
          const qtyBouger = qtyOrigine - qtyGarder;
          const ratioLots = ligneOrigine.quantite_lots ? (ligneOrigine.quantite_lots / qtyOrigine) : null;
          
          lignesBouger.push({
            produit: ligneOrigine.produit._id || ligneOrigine.produit,
            quantite: qtyBouger,
            lot: ligneOrigine.lot,
            quantite_lots: ratioLots ? qtyBouger * ratioLots : null
          });
        }
      }
    } else {
      // MODE AUTOMATIQUE (Logic existante)
      for (const ligne of livraisonOrigine.lignesLivraison) {
        const pU = parseFloat(ligne.produit?.poids_unitaire || 0);
        const qty = parseFloat(ligne.quantite || 0);
        const weightTotalLigne = qty * pU;

        if (currentWeight + weightTotalLigne <= targetWeight) {
          // Garder toute la ligne
          lignesGarder.push(ligne);
          currentWeight += weightTotalLigne;
        } else if (currentWeight < targetWeight) {
          // Diviser la ligne si possible
          const weightRemaining = targetWeight - currentWeight;
          const qtyGarder = Math.floor(weightRemaining / pU);

          if (qtyGarder > 0) {
            const ratioLots = ligne.quantite_lots ? (ligne.quantite_lots / ligne.quantite) : null;
            
            lignesGarder.push({
              produit: ligne.produit._id,
              quantite: qtyGarder,
              lot: ligne.lot,
              quantite_lots: ratioLots ? qtyGarder * ratioLots : null
            });
            
            lignesBouger.push({
              produit: ligne.produit._id,
              quantite: qty - qtyGarder,
              lot: ligne.lot,
              quantite_lots: ratioLots ? (qty - qtyGarder) * ratioLots : null
            });
            
            currentWeight += qtyGarder * pU;
          } else {
            lignesBouger.push(ligne);
          }
        } else {
          lignesBouger.push(ligne);
        }
      }
    }

    if (lignesBouger.length === 0) {
      return res.status(400).json({ message: "La livraison pèse déjà moins que le poids cible ou aucune unité ne peut être gardée." });
    }

    if (lignesGarder.length === 0) {
       return res.status(400).json({ message: "Le poids cible est trop bas pour garder ne serait-ce qu'une unité de produit." });
    }

    // 1. Calculer les montants pour les deux livraisons
    let montantGarder = 0;
    let montantBouger = 0;

    const commandePeuplee = livraisonOrigine.commande;
    
    if (commandePeuplee && commandePeuplee.lignesCommande) {
      const helperCalcul = (lignes) => {
        let total = 0;
        for (const l of lignes) {
          const prodId = (l.produit._id || l.produit).toString();
          const lotId = l.lot?.toString();

          const lc = commandePeuplee.lignesCommande.find(lcmd => {
            const pMatch = lcmd.produit.toString() === prodId;
            if (lotId) {
              return pMatch && lcmd.lot?._id.toString() === lotId;
            }
            return pMatch && !lcmd.lot;
          });

          if (lc) {
            total += l.quantite * (lc.prix_unitaire || 0);
          }
        }
        return total;
      };

      montantGarder = helperCalcul(lignesGarder);
      montantBouger = helperCalcul(lignesBouger);
    }

    // 2. Créer la nouvelle livraison (Reliquat)
    const nouvelleLivraison = new Livraison({
      commande: livraisonOrigine.commande._id || livraisonOrigine.commande,
      poids_total: Math.max(0, (livraisonOrigine.poids_total || 0) - currentWeight),
      montant_total: montantBouger,
      lignesLivraison: lignesBouger.map(l => ({
        produit: l.produit._id || l.produit,
        quantite: l.quantite,
        lot: l.lot,
        quantite_lots: l.quantite_lots
      })),
      statut: "EN_ATTENTE",
      camion_assigne: null,
      date_creation: new Date()
    });

    await nouvelleLivraison.save();

    // 📄 GÉNÉRATION FACTURE PROFORMA POUR LA NOUVELLE LIVRAISON
    try {
      const Facture = require('../models/Facture');
      const nouvelleFacture = new Facture({
        livraison: nouvelleLivraison._id,
        commande: nouvelleLivraison.commande,
        montant_total: montantBouger,
        statut: 'PROFORMA',
        date_echeance: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
      await nouvelleFacture.save();
      nouvelleLivraison.facture = nouvelleFacture._id;
      await nouvelleLivraison.save();
    } catch (fErr) {
      console.error("⚠️ Erreur facture proforma pour split:", fErr);
    }

    // 3. Mettre à jour la livraison d'origine
    livraisonOrigine.lignesLivraison = lignesGarder.map(l => ({
      produit: l.produit._id || l.produit,
      quantite: l.quantite,
      lot: l.lot,
      quantite_lots: l.quantite_lots
    }));
    livraisonOrigine.poids_total = currentWeight;
    livraisonOrigine.montant_total = montantGarder;
    
    // Mettre à jour la facture associée si elle existe (Proforma)
    if (livraisonOrigine.facture) {
       try {
         const Facture = require('../models/Facture');
         const fact = await Facture.findById(livraisonOrigine.facture);
         if (fact && fact.statut === 'PROFORMA') {
            fact.montant_total = montantGarder;
            await fact.save();
         }
       } catch (e) {
         console.error("⚠️ Erreur mise à jour facture proforma lors du split:", e);
       }
    }

    await livraisonOrigine.save();

    console.log(`✅ Livraison splitée: Origine (${livraisonOrigine._id}) -> ${currentWeight}kg, Nouveau (${nouvelleLivraison._id}) -> ${nouvelleLivraison.poids_total}kg`);

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('delivery_status_changed', {
        _id: livraisonOrigine._id,
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('new_delivery', {
        timestamp: new Date()
      });
    }

    res.status(200).json({
      message: "Livraison divisée avec succès",
      originale: livraisonOrigine,
      nouvelle: nouvelleLivraison
    });

  } catch (err) {
    console.error("❌ Erreur split livraison:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Lister les commandes préparées disponibles pour créer des livraisons
 */
exports.getCommandesPreparees = async (req, res) => {
  try {
    console.log('🔍 Recherche des commandes préparées...');

    // D'abord, vérifions tous les statuts disponibles
    const toutesCommandes = await Commande.find({}).select('statut');
    const statutsUniques = [...new Set(toutesCommandes.map(c => c.statut))];
    console.log('📊 Statuts de commandes disponibles:', statutsUniques);

    // Rechercher les commandes préparées ET en livraison (qui peuvent avoir du stock restant)
    const statutsPreparees = ['PREPAREE', 'preparee', 'Préparée', 'préparée', 'Preparee', 'PRÉPARÉE', 'EN_LIVRAISON'];

    const commandesPreparees = await Commande.find({
      statut: { $in: statutsPreparees }
    })
      .populate("pointDeVente")
      .populate({
        path: "lignesCommande",
        populate: [
          {
            path: "produit",
            model: "Produit"
          },
          {
            path: "lot",
            model: "Lot"
          }
        ]
      })
      .sort({ date_creation: -1 });

    console.log(`📋 ${commandesPreparees.length} commandes préparées trouvées avec statuts:`,
      commandesPreparees.map(c => c.statut));

    // Analyser en détail les lignes de commande et corriger les quantite_restante
    const commandesAvecStock = [];

    for (const commande of commandesPreparees) {
      console.log(`\n🔍 Analyse commande ${commande._id}:`);
      console.log(`  - Statut: ${commande.statut}`);
      console.log(`  - Nombre de lignes: ${commande.lignesCommande.length}`);

      let hasStock = false;
      let commandeModifiee = false;

      // Analyser et corriger chaque ligne
      for (const ligne of commande.lignesCommande) {
        console.log(`  - Ligne ${ligne._id}:`);
        console.log(`    * Produit: ${ligne.produit?.nom || 'N/A'}`);
        console.log(`    * Quantité: ${ligne.quantite}`);
        console.log(`    * Quantité restante avant: ${ligne.quantite_restante}`);
        console.log(`    * Type quantite_restante: ${typeof ligne.quantite_restante}`);

        // Corriger quantite_restante si nécessaire
        if (ligne.quantite_restante === undefined || ligne.quantite_restante === null) {
          ligne.quantite_restante = ligne.quantite;
          await ligne.save();
          commandeModifiee = true;
          console.log(`    🔧 Correction: quantite_restante = ${ligne.quantite}`);
        }

        // Vérifier s'il y a du stock disponible
        if (ligne.quantite_restante > 0) {
          hasStock = true;
        }

        console.log(`    * Quantité restante après: ${ligne.quantite_restante}`);
      }

      if (commandeModifiee) {
        console.log(`  🔧 Commande ${commande._id} corrigée`);
      }

      console.log(`  ✅ Commande ${commande._id} a du stock: ${hasStock}`);

      if (hasStock) {
        commandesAvecStock.push(commande);
      }
    }

    console.log(`📦 ${commandesAvecStock.length} commandes avec stock disponible`);

    res.json(commandesAvecStock);
  } catch (err) {
    console.error("❌ Erreur récupération commandes préparées:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Fonction utilitaire pour diagnostiquer les commandes
 */
exports.diagnosticCommandes = async (req, res) => {
  try {
    console.log('🔍 Diagnostic des commandes...');

    // Récupérer toutes les commandes
    const toutesCommandes = await Commande.find({})
      .populate("pointDeVente")
      .populate({
        path: "lignesCommande.produit",
        select: "nom reference image"
      })
      .sort({ date_creation: -1 });

    console.log(`📊 Total commandes: ${toutesCommandes.length}`);

    // Analyser les statuts
    const statutsCount = {};
    toutesCommandes.forEach(commande => {
      const statut = commande.statut || 'undefined';
      statutsCount[statut] = (statutsCount[statut] || 0) + 1;
    });

    console.log('📈 Répartition des statuts:', statutsCount);

    // Analyser les commandes préparées avec tous les statuts possibles
    const statutsPreparees = ['PREPAREE', 'preparee', 'Préparée', 'préparée', 'Preparee', 'PRÉPARÉE'];
    const commandesPreparees = toutesCommandes.filter(c =>
      statutsPreparees.includes(c.statut)
    );

    console.log(`📋 Commandes préparées: ${commandesPreparees.length}`);
    console.log('📋 Statuts préparés trouvés:', [...new Set(commandesPreparees.map(c => c.statut))]);

    // Analyser les quantités restantes
    const commandesAvecStock = commandesPreparees.filter(commande => {
      const hasStock = commande.lignesCommande.some(ligne => ligne.quantite_restante > 0);
      if (!hasStock) {
        console.log(`⚠️ Commande ${commande._id} n'a plus de stock:`,
          commande.lignesCommande.map(l => ({
            produit: l.produit?.nom,
            quantite: l.quantite,
            restante: l.quantite_restante
          }))
        );
      }
      return hasStock;
    });

    console.log(`📦 Commandes avec stock: ${commandesAvecStock.length}`);

    res.json({
      totalCommandes: toutesCommandes.length,
      statutsCount,
      commandesPreparees: commandesPreparees.length,
      commandesAvecStock: commandesAvecStock.length,
      statutsPreparesDetectes: [...new Set(commandesPreparees.map(c => c.statut))],
      details: commandesAvecStock.map(c => ({
        id: c._id,
        statut: c.statut,
        pointDeVente: c.pointDeVente?.nom,
        articlesRestants: c.lignesCommande.filter(l => l.quantite_restante > 0).length,
        totalArticles: c.lignesCommande.length
      }))
    });

  } catch (err) {
    console.error("❌ Erreur diagnostic:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};
/**
 * Créer une livraison automatiquement depuis une commande préparée (tous les produits)
 */
exports.creerDepuisCommandePreparee = async (req, res) => {
  try {
    const { commandeId } = req.params;

    console.log(`🚚 Création livraison automatique pour commande ${commandeId}`);

    const commande = await Commande.findById(commandeId)
      .populate("lignesCommande")
      .populate({
        path: "lignesCommande.produit",
        select: "nom reference image"
      });

    if (!commande) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    // Vérifier si la commande est préparée ou en livraison (pour livraisons partielles)
    const statutsValides = ['PREPAREE', 'preparee', 'Préparée', 'préparée', 'Preparee', 'PRÉPARÉE', 'EN_LIVRAISON'];
    if (!statutsValides.includes(commande.statut)) {
      return res.status(400).json({
        message: `Seules les commandes préparées ou en livraison peuvent être livrées. Statut actuel: ${commande.statut}`
      });
    }

    // Créer les lignes de livraison avec toutes les quantités restantes
    const lignesLivraison = commande.lignesCommande
      .filter(ligne => {
        const qteRestante = ligne.quantite_restante !== undefined ?
          ligne.quantite_restante : ligne.quantite;
        return qteRestante > 0;
      })
      .map(ligne => ({
        produit: ligne.produit._id,
        quantite: ligne.quantite_restante !== undefined ?
          ligne.quantite_restante : ligne.quantite
      }));

    if (lignesLivraison.length === 0) {
      return res.status(400).json({
        message: "Aucun produit disponible pour livraison dans cette commande"
      });
    }

    // Créer la livraison
    const livraison = new Livraison({
      commande: commandeId,
      lignesLivraison,
      statut: "EN_ATTENTE",
      date_creation: new Date()
    });

    await livraison.save();
    console.log(`✅ Livraison automatique ${livraison._id} créée`);

    // Mettre à jour les quantités restantes (toutes à 0)
    for (const ligne of commande.lignesCommande) {
      if (ligne.quantite_restante > 0) {
        ligne.quantite_restante = 0;
        await ligne.save();
        console.log(`📝 Quantité restante mise à 0 pour ${ligne.produit?.nom}`);
      }
    }

    // La commande reste en statut PREPAREE
    // Elle passera à EN_LIVRAISON quand une livraison passera à EN_COURS
    console.log(`📋 Livraison créée, commande reste en statut ${commande.statut}`);

    // Populer la livraison créée
    const livraisonComplete = await Livraison.findById(livraison._id)
      .populate("commande")
      .populate({
        path: "lignesLivraison",
        populate: [
          { path: "produit" },
          { path: "lot" }
        ]
      });

    // 📄 GÉNÉRATION AUTOMATIQUE DE LA FACTURE PROFORMA
    try {
      // Calculer le montant total basé sur les lignes de livraison
      let montantTotal = 0;
      
      for (const ligne of livraisonComplete.lignesLivraison) {
        if (ligne.produit && ligne.produit.prix_unitaire) {
          montantTotal += ligne.quantite * ligne.produit.prix_unitaire;
        }
      }

      // Créer la facture proforma
      const Facture = require('../models/Facture');
      const nouvelleFacture = new Facture({
        livraison: livraisonComplete._id,
        commande: commandeId,
        montant_total: montantTotal,
        statut: 'PROFORMA', // Statut proforma pour facture avant livraison
        date_echeance: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 jours
      });

      await nouvelleFacture.save();
      
      // Mettre à jour la livraison avec la référence de la facture
      await Livraison.findByIdAndUpdate(livraisonComplete._id, { 
        facture: nouvelleFacture._id 
      });
      
      console.log(`📄 Facture proforma générée: ${await nouvelleFacture.getIdFormate()}`);
      
      // Ajouter la facture à la réponse
      livraisonComplete.facture = nouvelleFacture;
      
    } catch (factureError) {
      console.error('❌ Erreur génération facture proforma:', factureError);
      // Ne pas bloquer la création de livraison si la facture échoue
    }

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('new_delivery', {
        timestamp: new Date()
      });
    }

    res.status(201).json({
      message: "Livraison créée automatiquement avec succès",
      livraison: livraisonComplete
    });

  } catch (err) {
    console.error("❌ Erreur création livraison automatique:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Fonction utilitaire pour initialiser les quantite_restante manquantes
 */
exports.initialiserQuantiteRestante = async (req, res) => {
  try {
    console.log('🔧 Initialisation des quantite_restante manquantes...');

    const commandes = await Commande.find({})
      .populate("lignesCommande");

    let commandesModifiees = 0;
    let lignesModifiees = 0;

    for (const commande of commandes) {
      let commandeModifiee = false;

      for (const ligne of commande.lignesCommande) {
        // Vérifier si quantite_restante est undefined, null, ou 0 alors que quantite > 0
        const needsInitialization =
          ligne.quantite_restante === undefined ||
          ligne.quantite_restante === null ||
          (ligne.quantite_restante === 0 && ligne.quantite > 0 && commande.statut === 'PREPAREE');

        if (needsInitialization) {
          console.log(`🔧 Ligne ${ligne._id} avant: quantite=${ligne.quantite}, quantite_restante=${ligne.quantite_restante}`);
          ligne.quantite_restante = ligne.quantite;
          await ligne.save();
          lignesModifiees++;
          commandeModifiee = true;
          console.log(`🔧 Ligne ${ligne._id} après: quantite_restante = ${ligne.quantite}`);
        }
      }

      if (commandeModifiee) {
        commandesModifiees++;
        console.log(`✅ Commande ${commande._id} modifiée`);
      }
    }

    console.log(`✅ Initialisation terminée: ${commandesModifiees} commandes, ${lignesModifiees} lignes modifiées`);

    res.json({
      message: "Initialisation terminée",
      commandesModifiees,
      lignesModifiees
    });

  } catch (err) {
    console.error("❌ Erreur initialisation:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};
/**
 * Libérer le stock d'une livraison annulée
 * LOGIQUE CORRIGÉE: 
 * - Retirer complètement la quantité de la commande (quantite ET quantite_restante)
 * - Recalculer le prix de la commande
 * - Remettre le stock dans le stock consolidé
 * 
 * NOTE: Quand une livraison est annulée, les quantités sont déjà remises dans quantite_restante.
 * Cette fonction retire définitivement ces articles de la commande.
 */
exports.libererStockLivraisonAnnulee = async (req, res) => {
  try {
    const { livraisonId } = req.params;
    
    const livraison = await Livraison.findById(livraisonId)
      .populate({
        path: 'commande',
        populate: {
          path: 'lignesCommande',
          populate: [
            { path: 'produit' },
            { path: 'lot' }
          ]
        }
      })
      .populate({
        path: 'lignesLivraison',
        populate: [
          { path: 'produit' },
          { path: 'lot' }
        ]
      });

    if (!livraison) {
      return res.status(404).json({ message: "Livraison introuvable" });
    }

    if (livraison.statut !== 'ANNULEE') {
      return res.status(400).json({ message: "Seules les livraisons annulées peuvent avoir leur stock libéré" });
    }

    // ✅ NOUVEAU: Vérifier l'origine de l'annulation
    if (livraison.annulation_origine === 'COMMANDE') {
      return res.status(400).json({ 
        message: "Le stock de cette livraison a déjà été libéré lors de l'annulation de la commande",
        origine: "COMMANDE"
      });
    }

    if (livraison.annulation_origine !== 'MANUELLE') {
      return res.status(400).json({ 
        message: "Cette livraison n'a pas été annulée manuellement",
        origine: livraison.annulation_origine || "INCONNUE"
      });
    }

    if (livraison.stock_libere) {
      return res.status(400).json({ message: "Le stock de cette livraison a déjà été libéré" });
    }

    console.log(`🔓 Libération du stock pour livraison annulée ${livraisonId}`);

    const Stock = require('../models/Stock');
    let stockLibere = false;
    let prixTotalARetirer = 0;

    // Pour chaque ligne de livraison, retirer complètement de la commande et libérer le stock
    for (const ligneLiv of livraison.lignesLivraison) {
      // Trouver la ligne de commande correspondante (produit + lot)
      const ligneCmd = livraison.commande?.lignesCommande?.find(lc => {
        const produitMatch = lc.produit?._id?.toString() === ligneLiv.produit?._id?.toString();
        
        if (ligneLiv.lot) {
          const lotMatch = lc.lot?._id?.toString() === ligneLiv.lot?._id?.toString();
          return produitMatch && lotMatch;
        }
        return produitMatch && !lc.lot;
      });

      if (!ligneCmd) {
        console.warn(`⚠️ Ligne de commande non trouvée pour produit ${ligneLiv.produit}`);
        continue;
      }

      console.log(`📦 Libération stock pour ${ligneCmd.produit?.nom} (${ligneCmd.lot?.nom || 'sans lot'}): ${ligneLiv.quantite} unités`);

      // Vérifier s'il y a encore quelque chose à libérer
      const quantiteReelleActuelle = ligneCmd.quantite_reellement_commandee || ligneCmd.quantite;
      const quantiteRestanteActuelle = ligneCmd.quantite_restante || 0;
      
      if (quantiteReelleActuelle <= 0 && quantiteRestanteActuelle <= 0) {
        console.log(`  ⚠️ Cette ligne a déjà été complètement libérée, passage à la suivante`);
        continue;
      }

      // ÉTAPE 1: Retirer complètement la quantité de la commande
      const ancienneQuantiteCmd = ligneCmd.quantite;
      const ancienneQuantiteRestante = ligneCmd.quantite_restante;
      const ancienneQuantiteReelle = quantiteReelleActuelle;
      
      // Calculer le prix à retirer AVANT de modifier les quantités
      const prixUnitaire = ligneCmd.prix_unitaire || ligneCmd.produit?.prix_reference || 0;
      
      // Calculer la quantité à retirer (limitée à ce qui reste)
      let quantiteARetirerUnites = Math.min(ligneLiv.quantite, quantiteReelleActuelle); // Toujours en unités
      let quantiteARetirerLots;
      
      if (ligneCmd.lot && ligneCmd.lot.quantite_unitaire) {
        // Convertir les unités en lots pour quantite_annulee
        quantiteARetirerLots = ligneLiv.quantite_lots || Math.floor(quantiteARetirerUnites / ligneCmd.lot.quantite_unitaire);
      } else {
        // Pas de lot
        quantiteARetirerLots = quantiteARetirerUnites;
      }
      
      const prixLigne = quantiteARetirerLots * prixUnitaire;
      prixTotalARetirer += prixLigne;
      
      // NE PAS MODIFIER ligneCmd.quantite (quantité originale commandée)
      // Modifier seulement quantite_restante et quantite_reellement_commandee
      ligneCmd.quantite_restante = Math.max(0, ligneCmd.quantite_restante - quantiteARetirerUnites);
      ligneCmd.quantite_reellement_commandee = Math.max(0, ancienneQuantiteReelle - quantiteARetirerUnites);
      // quantite_annulee est en LOTS
      ligneCmd.quantite_annulee = (ligneCmd.quantite_annulee || 0) + quantiteARetirerLots;

      await ligneCmd.save();
      console.log(`  📉 Retrait définitif commande: quantite originale ${ancienneQuantiteCmd} (inchangée), réelle ${ancienneQuantiteReelle} → ${ligneCmd.quantite_reellement_commandee} unités, restante ${ancienneQuantiteRestante} → ${ligneCmd.quantite_restante} unités, annulée ${ligneCmd.quantite_annulee} lots`);
      console.log(`  💰 Prix retiré: ${prixLigne.toFixed(2)} DT (${quantiteARetirerLots} lots × ${prixUnitaire.toFixed(2)})`);

      // ÉTAPE 2: Libérer le stock réservé (ne pas ajouter au stock total)
      console.log(`  📦 Libération stock réservé: ${quantiteARetirerUnites} unités`);
      
      try {
        const StockConsolide = require('../models/StockConsolide');
        const stockConsolide = await StockConsolide.findOne({ produit: ligneLiv.produit });
        
        if (stockConsolide) {
          console.log(`  📊 Stock avant libération: total=${stockConsolide.quantite_totale}, réservé=${stockConsolide.quantite_reservee}, disponible=${stockConsolide.quantite_disponible}`);
          
          // Libérer la quantité réservée (diminuer quantite_reservee)
          // Le stock total reste inchangé car le stock physique n'a pas bougé
          await stockConsolide.libererStockReserve(quantiteARetirerUnites);
          
          // Recharger pour voir les nouvelles valeurs
          const stockMisAJour = await StockConsolide.findById(stockConsolide._id);
          console.log(`  📊 Stock après libération: total=${stockMisAJour.quantite_totale}, réservé=${stockMisAJour.quantite_reservee}, disponible=${stockMisAJour.quantite_disponible}`);
          console.log(`  ✅ Stock réservé libéré: -${quantiteARetirerUnites} réservé, +${quantiteARetirerUnites} disponible`);
        } else {
          console.warn(`  ⚠️ Stock consolidé non trouvé pour le produit ${ligneLiv.produit}`);
        }
      } catch (stockError) {
        console.error(`  ❌ Erreur lors de la libération de stock: ${stockError.message}`);
        // Continuer le processus même si la libération échoue
      }

      // Marquer qu'au moins une ligne a été traitée
      stockLibere = true;

      // Enregistrer le mouvement pour traçabilité (optionnel)
      try {
        const livraisonIdFormate = await livraison.getIdFormate();
        // Récupérer le stock pour l'enregistrement du mouvement
        const stocksPourMouvement = await Stock.find({ produit: ligneLiv.produit }).limit(1);
        await enregistrerMouvement({
          stockId: stocksPourMouvement[0]?._id,
          type: "LIBERATION",
          quantite: quantiteARetirerUnites,
          utilisateurId: req.user?.id, // Enregistrer l'utilisateur qui effectue la libération
          reference: livraison._id,
          reference_type: "Livraison",
          commentaire: `Libération stock livraison annulée ${livraisonIdFormate} - Retrait définitif de commande`,
          lot_info: ligneLiv.lot ? {
            lot_id: ligneLiv.lot,
            nom_lot: ligneCmd.lot?.nom,
            quantite_unitaire: ligneCmd.lot?.quantite_unitaire,
            nombre_lots: ligneLiv.quantite_lots || Math.floor(quantiteARetirerUnites / (ligneCmd.lot?.quantite_unitaire || 1)),
            reste_unites: quantiteARetirerUnites % (ligneCmd.lot?.quantite_unitaire || 1)
          } : null
        });
      } catch (movementError) {
        console.warn(`⚠️ Impossible d'enregistrer le mouvement: ${movementError.message}`);
      }
    }

    if (!stockLibere) {
      return res.status(400).json({ message: "Aucun stock à libérer pour cette livraison" });
    }

    // ÉTAPE 3: Recalculer le prix total de la commande
    const commande = livraison.commande;
    const ancienPrixTotal = commande.prix_total || 0;
    const nouveauPrixTotal = Math.max(0, ancienPrixTotal - prixTotalARetirer);
    
    commande.prix_total = nouveauPrixTotal;
    await commande.save();
    
    console.log(`💰 Recalcul prix commande: ${ancienPrixTotal.toFixed(2)} → ${nouveauPrixTotal.toFixed(2)} DT (-${prixTotalARetirer.toFixed(2)})`);

    // Marquer la livraison comme ayant eu son stock libéré
    livraison.stock_libere = true;
    await livraison.save();

    console.log(`✅ Stock libéré pour livraison ${livraisonId}`);

    res.json({
      message: `Stock libéré avec succès - Articles retirés définitivement de la commande et remis en stock consolidé. Prix réduit de ${prixTotalARetirer.toFixed(2)} DT.`,
      livraison,
      prixReduit: prixTotalARetirer,
      nouveauPrixTotal: nouveauPrixTotal
    });

  } catch (err) {
    console.error("❌ Erreur libération stock livraison:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Marquer un produit spécifique en échec dans une livraison (livraison partielle)
 */
exports.marquerProduitEnEchec = async (req, res) => {
  try {
    const { livraisonId } = req.params;
    const { productIndex, productId, raison, productInfo } = req.body;

    console.log(`🔍 Marquage produit en échec - Livraison: ${livraisonId}, Produit: ${productInfo?.nom}`);

    const livraison = await Livraison.findById(livraisonId)
      .populate({
        path: 'lignesLivraison',
        populate: [
          { path: 'produit', select: 'nom reference image' },
          { path: 'lot' }
        ]
      })
      .populate({
        path: 'commande',
        populate: {
          path: 'lignesCommande',
          populate: [
            { path: 'produit' },
            { path: 'lot' }
          ]
        }
      })
      .populate({
        path: 'voyage',
        populate: {
          path: 'chauffeur',
          populate: { path: 'utilisateur', select: 'username' }
        }
      });

    if (!livraison) {
      return res.status(404).json({ message: "Livraison introuvable" });
    }

    if (livraison.statut === 'LIVREE') {
      return res.status(400).json({ message: "Impossible de modifier une livraison déjà livrée" });
    }

    // ✅ NOUVEAU: Vérifier que la commande associée n'est pas annulée
    if (livraison.commande && livraison.commande.statut === "ANNULEE") {
      return res.status(400).json({ 
        message: "Impossible de signaler un produit: la commande associée a été annulée",
        commandeId: livraison.commande._id,
        commandeStatut: livraison.commande.statut
      });
    }

    // Trouver la ligne de livraison correspondante
    let ligneToUpdate = null;
    if (productIndex !== undefined && livraison.lignesLivraison[productIndex]) {
      ligneToUpdate = livraison.lignesLivraison[productIndex];
    } else if (productId) {
      ligneToUpdate = livraison.lignesLivraison.find(ligne => 
        ligne.produit._id.toString() === productId.toString()
      );
    }

    if (!ligneToUpdate) {
      return res.status(404).json({ message: "Produit non trouvé dans cette livraison" });
    }

    // Marquer cette ligne comme en échec
    ligneToUpdate.statut_produit = 'ECHEC';
    ligneToUpdate.raison_echec = raison;
    ligneToUpdate.date_echec = new Date();

    // ✅ NOUVELLE LOGIQUE: Créer automatiquement un retour pour le produit signalé
    try {
      const Retour = require('../models/Retour');
      const StockConsolide = require('../models/StockConsolide');
      const { enregistrerMouvement } = require('./mouvement.controller');
      
      console.log(`🔄 Création automatique du retour pour produit signalé: ${ligneToUpdate.produit.nom}`);
      
      // Trouver la ligne de commande correspondante
      const ligneCmd = livraison.commande?.lignesCommande?.find(lc =>
        lc.produit._id.toString() === ligneToUpdate.produit._id.toString()
      );

      if (!ligneCmd) {
        console.error(`❌ Ligne de commande non trouvée pour le produit ${ligneToUpdate.produit._id}`);
        throw new Error('Ligne de commande non trouvée');
      }

      console.log(`📋 Ligne de commande trouvée: ${ligneCmd._id}`);

      // Créer le retour automatiquement
      const retour = new Retour({
        ligneCommande: ligneCmd._id,
        livraison: livraison._id,
        ligne_livraison_id: ligneToUpdate._id,
        quantite: ligneToUpdate.quantite,
        motif: `Produit signalé en échec: ${raison}`,
        impact_financier: 0, // Pas d'impact financier pour un signalement
        statut: 'TRAITE', // Directement traité
        utilisateur: req.user?.id,
        date_traitement: new Date()
      });
      
      await retour.save();
      console.log(`✅ Retour créé avec succès: ${retour.id_formate} (ID: ${retour._id})`);

      // Transférer la quantité du stock réservé vers retourné
      const stockConsolide = await StockConsolide.findOne({ produit: ligneToUpdate.produit });
      if (stockConsolide) {
        await stockConsolide.transfererReserveVersRetourne(ligneToUpdate.quantite);
        console.log(`✅ Stock consolidé mis à jour: -${ligneToUpdate.quantite} réservé, +${ligneToUpdate.quantite} retourné`);
      } else {
        console.warn(`⚠️ Stock consolidé non trouvé pour le produit ${ligneToUpdate.produit._id}`);
      }

      // Enregistrer le mouvement de retour pour traçabilité
      const Stock = require('../models/Stock');
      const stockIndividuel = await Stock.findOne({ produit: ligneToUpdate.produit });
      if (stockIndividuel) {
        // Préparer les informations de lot si disponible
        let lotInfo = null;
        if (ligneCmd.lot) {
          lotInfo = {
            lot_id: ligneCmd.lot._id,
            nom_lot: ligneCmd.lot.nom,
            quantite_unitaire: ligneCmd.lot.quantite_unitaire,
            nombre_lots: Math.floor(ligneToUpdate.quantite / ligneCmd.lot.quantite_unitaire),
            reste_unites: ligneToUpdate.quantite % ligneCmd.lot.quantite_unitaire
          };
        }

        // Déterminer le nom de l'utilisateur pour le commentaire (chauffeur ou connecté)
        const auteurNom = req.user?.username || livraison.voyage?.chauffeur?.utilisateur?.username || 'Système';
        const auteurId = req.user?.id || livraison.voyage?.chauffeur?.utilisateur?._id || null;

        await enregistrerMouvement({
          stockId: stockIndividuel._id,
          type: "RETOUR",
          quantite: ligneToUpdate.quantite,
          utilisateurId: auteurId,
          reference: retour._id,
          reference_type: "Retour",
          commentaire: `Retour automatique (${auteurNom}) - Produit signalé: ${raison}`,
          lot_info: lotInfo
        });
        
        console.log(`✅ Mouvement RETOUR enregistré: ${ligneToUpdate.quantite} unités`);
      } else {
        console.warn(`⚠️ Stock individuel non trouvé pour le produit ${ligneToUpdate.produit._id}, mouvement non enregistré`);
      }

      // Mettre à jour la quantité retournée dans la ligne de commande
      const dejaRetourne = ligneCmd.quantite_retournee || 0;
      ligneCmd.quantite_retournee = dejaRetourne + ligneToUpdate.quantite;
      await ligneCmd.save();
      
      console.log(`✅ Ligne de commande mise à jour: quantité retournée = ${ligneCmd.quantite_retournee}`);

      console.log(`🎯 Retour automatique créé avec succès pour le produit signalé: ${ligneToUpdate.produit.nom}`);
      
    } catch (retourError) {
      console.error(`❌ Erreur création retour automatique: ${retourError.message}`);
      console.error(`❌ Stack trace:`, retourError.stack);
      
      // Faire échouer le signalement si la création du retour échoue
      return res.status(500).json({ 
        message: "Erreur lors de la création du retour automatique", 
        error: retourError.message 
      });
    }
    
    // ✅ NOUVEAU: Recalculer le montant de la livraison
    try {
      // Trouver la ligne de commande pour le prix et les infos de lot
      const ligneCmd = livraison.commande?.lignesCommande?.find(lc =>
        lc.produit._id.toString() === ligneToUpdate.produit._id.toString()
      );

      if (ligneCmd) {
        // Convention unifiée : quantite × prix_unitaire = total
        const prixLigne = ligneToUpdate.quantite * (ligneCmd.prix_unitaire || 0);
        
        console.log(`💰 Recalcul financier: Retrait de ${prixLigne.toFixed(2)} DT du total (Qte: ${ligneToUpdate.quantite}, PU: ${ligneCmd.prix_unitaire})`);

        livraison.montant_total = Math.max(0, (livraison.montant_total || 0) - prixLigne);
        
        // Mettre à jour la facture associée si elle existe
        if (livraison.facture) {
          const Facture = require('../models/Facture');
          await Facture.findByIdAndUpdate(livraison.facture, {
            $inc: { montant_total: -prixLigne }
          });
          console.log(`📄 Facture mise à jour: -${prixLigne.toFixed(2)} DT`);
        }
      }
    } catch (calcError) {
      console.error('❌ Erreur lors du recalcul financier:', calcError);
      // On continue car le signalement produit est l'essentiel
    }
    
    await livraison.save();

    // ✅ RECALCUL DU MONTANT TOTAL DE LA LIVRAISON (Sécurité Backend)
    const resultFinance = calculateLivraisonTotal(livraison, { excludeEchec: true });
    livraison.montant_total = resultFinance.total;
    
    await livraison.save();
    console.log(`💰 Nouveau montant total de livraison après échec produit: ${livraison.montant_total} DT`);

    // ✅ NOUVELLE LOGIQUE: Vérifier si tous les produits sont maintenant en échec
    const allProductsFailed = livraison.lignesLivraison.every(ligne => ligne.statut_produit === 'ECHEC');

    
    if (allProductsFailed && livraison.statut !== 'ECHEC') {
      console.log(`🚀 [AUTO-ECHEC] Tous les produits de la livraison ${livraisonId} ont échoué. Passage automatique du statut de livraison en ECHEC.`);
      
      livraison.statut = 'ECHEC';
      livraison.raison_echec = "Échec automatique : tous les produits de la livraison ont été signalés en échec par le chauffeur.";
      livraison.date_echec = new Date();
      livraison.montant_total = 0;
      
      // Mettre la facture à 0
      try {
        if (livraison.facture) {
          const Facture = require('../models/Facture');
          await Facture.findByIdAndUpdate(livraison.facture, { montant_total: 0 });
          console.log(`📄 [AUTO-ECHEC] Facture mise à 0 (tous produits en échec)`);
        }
      } catch (factureErr) {
        console.error('❌ Erreur mise à jour facture (auto-echec):', factureErr);
      }
      
      await livraison.save();
      
      // Recalculer le statut de la commande associée
      try {
        const { calculerStatutCommande } = require('./commande.controller');
        const statutInfo = await calculerStatutCommande(livraison.commande);
        
        if (statutInfo) {
          const commande = await Commande.findById(livraison.commande);
          if (commande && commande.statut !== statutInfo.statut) {
            const ancienStatut = commande.statut;
            commande.statut = statutInfo.statut;
            if (statutInfo.pourcentageLivraison !== null) {
              commande.pourcentage_livraison = statutInfo.pourcentageLivraison;
            }
            await commande.save();

            // 📧 Notification Email
            orderEmitter.emit('order_status_changed', { 
              commandeId: commande._id, 
              oldStatus: ancienStatut, 
              newStatus: statutInfo.statut, 
              source: 'SYSTEME',
              commentaire: `Mise à jour automatique suite à échec livraison (${statutInfo.pourcentageLivraison || 0}%)`
            });

            console.log(`✅ [AUTO-ECHEC] Commande mise à jour: ${ancienStatut} → ${statutInfo.statut}${statutInfo.pourcentageLivraison ? ` (${statutInfo.pourcentageLivraison}%)` : ''}`);
          }

        }
      } catch (cmdErr) {
        console.error('❌ Erreur recalcul statut commande (auto-echec):', cmdErr);
      }
    }


    // Optionnel: Mettre à jour la ligne de commande correspondante pour traçabilité
    // Mais sans impacter la quantité restante (cela sera fait lors de la validation finale)
    if (livraison.commande) {
      const ligneCommande = livraison.commande.lignesCommande.find(lc =>
        lc.produit._id.toString() === ligneToUpdate.produit._id.toString()
      );

      if (ligneCommande) {
        // Juste ajouter une note de traçabilité, sans changer les quantités
        console.log(`📝 Produit signalé en échec: ${ligneToUpdate.produit.nom} (quantité: ${ligneToUpdate.quantite})`);
      }
    }

    console.log(`✅ Produit ${productInfo?.nom} signalé en échec. Statut livraison inchangé: ${livraison.statut}`);

    // 📢 Notifier les responsables et admins pour l'échec d'un produit spécifique
    try {
      let chauffeurName = 'Un chauffeur';
      if (livraison.voyage) {
        const Voyage = require('../models/Voyage');
        const voyageComplet = await Voyage.findById(livraison.voyage)
          .populate({ path: 'chauffeur', populate: { path: 'utilisateur', select: 'username' } });
        chauffeurName = voyageComplet?.chauffeur?.utilisateur?.username || 'Un chauffeur';
      }

      const nomProduitNotif = productInfo?.nom || ligneToUpdate.produit?.nom || 'un produit';
      const title = '⚠️ Produit en échec';
      const msg = `${chauffeurName} a signalé un échec partiel pour la livraison: ${nomProduitNotif} (${raison || 'raison non précisée'})`;
      const data = { deliveryId: livraisonId, voyageId: livraison.voyage };
      
      await Promise.all([
        notifyAllResponsables('PRODUIT_ECHEC', title, msg, data),
        notifyAllAdmins('PRODUIT_ECHEC', title, msg, data)
      ]);

      // ⚠️ NOUVEAU: Notification pour remboursement si trop-perçu après échec produit
      if (livraison.montant_paye > livraison.montant_total + 0.001) {
        const diff = (livraison.montant_paye - livraison.montant_total).toFixed(3);
        const refundTitle = '💰 Remboursement requis (Échec produit)';
        
        let readableId = livraisonId;
        try {
          readableId = livraison.id_formate || await livraison.getIdFormate() || livraisonId;
        } catch (e) {}

        const isTotal = (livraison.statut === 'ECHEC' || (livraison.montant_total < 0.001));
        const refundMsg = isTotal 
          ? `Remboursement TOTAL de ${diff} DT requis pour la livraison ${readableId}. Livraison en ÉCHEC mais avance déjà payée.`
          : `Remboursement de ${diff} DT requis pour la livraison ${readableId}. Suite à un échec produit, le montant payé (${livraison.montant_paye.toFixed(3)} DT) dépasse le nouveau total (${livraison.montant_total.toFixed(3)} DT).`;
        
        await Promise.all([
          notifyAllResponsables('LIVRAISON_REMBOURSEMENT', refundTitle, refundMsg, { ...data, amount: diff }),
          notifyAllAdmins('LIVRAISON_REMBOURSEMENT', refundTitle, refundMsg, { ...data, amount: diff }),
          // 🆕 Trace dans les mouvements pour traçabilité financière
          enregistrerMouvement({
            type: 'PAIEMENT',
            quantite: 0,
            utilisateurId: req.user?.id,
            reference: livraison._id,
            reference_type: 'Livraison',
            commentaire: `${isTotal ? '🛑 ÉCHEC' : '⚠️ AJUSTEMENT'} - Remboursement requis: ${diff} DT (Suite échec produit: ${nomProduitNotif})`,
            session: null
          })
        ]);
        console.log(`📢 Notification remboursement envoyée (échec produit) pour ${readableId}: ${diff} DT`);
      }
    } catch (notifErr) {
      console.error('❌ Erreur notification produit en échec:', notifErr);
    }

    res.json({
      message: `Produit "${productInfo?.nom}" marqué en échec`,
      livraison: {
        _id: livraison._id,
        statut: livraison.statut,
        raison_echec: livraison.raison_echec,
        lignesLivraison: livraison.lignesLivraison
      }
    });

  } catch (err) {
    console.error("❌ Erreur marquage produit en échec:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Récupérer la facture associée à une livraison
 */
exports.getFactureLivraison = async (req, res) => {
  try {
    const { livraisonId } = req.params;

    const livraison = await Livraison.findById(livraisonId)
      .populate('facture')
      .populate('commande');

    if (!livraison) {
      return res.status(404).json({ 
        success: false, 
        message: "Livraison non trouvée" 
      });
    }

    if (!livraison.facture) {
      return res.status(404).json({ 
        success: false, 
        message: "Aucune facture associée à cette livraison" 
      });
    }

    // Enrichir la facture avec son ID formaté
    const factureObj = livraison.facture.toObject();
    try {
      factureObj.id_formate = await livraison.facture.getIdFormate();
    } catch (error) {
      console.error('Erreur formatage ID facture:', error);
      factureObj.id_formate = 'FAC-ERROR';
    }

    res.json({ 
      success: true, 
      facture: factureObj,
      livraison: {
        _id: livraison._id,
        numero_livraison: livraison.numero_livraison,
        statut: livraison.statut,
        date_livraison: livraison.date_livraison
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération facture livraison:', error);
    res.status(500).json({ 
      success: false, 
      message: "Erreur lors de la récupération de la facture",
      error: error.message 
    });
  }
};
