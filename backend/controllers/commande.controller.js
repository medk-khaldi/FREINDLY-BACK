const Commande = require("../models/Commande");
const LigneCommande = require("../models/LigneCommande");
const Produit = require("../models/Produit");
const PointDeVente = require("../models/PointDeVente");
const Client = require("../models/Client");
const Stock = require("../models/Stock");
const StockConsolide = require("../models/StockConsolide");
const fs = require("fs");
const path = require("path");
const { enregistrerMouvement } = require("./mouvement.controller");
const { formatIdBadge } = require("../utils/idFormatter");
const { notifyAllAdmins, notifyAllResponsables, notifyNewCommandeClient } = require("./notification.controller");
const Utilisateur = require("../models/Utilisateur");
const { calculateItemsWeight } = require("../utils/weightUtils");
const Livraison = require("../models/Livraison");
const Facture = require("../models/Facture");
const { calculateOrderTotal, calculateProductPrice } = require("../utils/financeUtils");
const orderEmitter = require("../services/orderEvents");




/**
 * Commande Marketplace - Client Final
 */
exports.passerCommandeClient = async (req, res) => {
  let reservations = [];
  try {
    const { items, adresse_livraison, total, sousTotal, fraisLivraison, codePromo, pointsUtilises, note_client } = req.body;

    const clientId = req.user?.id;
    const userType = req.user?.userType;

    // 🔹 1. Calculer le sous-total et le poids réel côté serveur (sécurité)
    let serverSousTotal = 0;
    let serverPoidsTotal = 0;
    const lignesTemp = [];
    
    const Lot = require("../models/Lot");
    for (const item of items) {
      // Resolution du produit ID (robustesse)
      const productId = item.produit || item.produitId || item._id;
      const produit = await Produit.findById(productId).populate('promotionActive');
      
      if (!produit) {
        console.error(`❌ [ERROR] Produit non trouvé pour ID: ${productId}`);
        return res.status(404).json({ message: `Produit introuvable (ID: ${productId}).` });
      }
      
      // Resolution du lot (Plus stricte)
      let lotId = null;
      let lotDetermined = false;

      if (item.selectedLot !== undefined) {
        lotDetermined = true;
        if (item.selectedLot && typeof item.selectedLot === 'object' && item.selectedLot._id) {
          lotId = item.selectedLot._id;
        } else if (typeof item.selectedLot === 'string' && item.selectedLot !== 'null' && item.selectedLot !== 'undefined' && item.selectedLot !== '') {
          lotId = item.selectedLot;
        }
      } 
      
      // Fallback sur item.lot seulement si selectedLot n'était pas du tout défini
      if (!lotDetermined && item.lot && typeof item.lot === 'string' && item.lot !== 'null' && item.lot !== 'undefined' && item.lot !== '') {
        lotId = item.lot;
      }
      
      const selectedLot = lotId ? await Lot.findById(lotId) : null;
      
      const quantiteLots = item.quantite || item.quantity || 1;
      const lotMultiplier = selectedLot?.quantite_unitaire || 1;
      const totalUnits = quantiteLots * lotMultiplier;
      
      const lineTotal = calculateOrderTotal && require("../utils/financeUtils").calculateLineTotal 
        ? require("../utils/financeUtils").calculateLineTotal(produit, quantiteLots, selectedLot)
        : (quantiteLots * calculateProductPrice(produit, quantiteLots, selectedLot));

      const prixUnitaire = Number((lineTotal / totalUnits).toFixed(6));
      
      serverSousTotal += lineTotal;
      
      const pU = parseFloat(produit.poids_unitaire || 0);
      serverPoidsTotal += (totalUnits * pU);
      
      lignesTemp.push({ produit, totalUnits, prixUnitaire, item, lot: selectedLot, quantiteLots });
    }

    // 🔹 2. Validation du code promo (utilisant le sous-total serveur)
    let appliedPromo = null;
    if (codePromo && codePromo.code) {
      const CodePromo = require("../models/CodePromo");
      const promo = await CodePromo.findOne({ code: codePromo.code.toUpperCase(), actif: true });
      if (promo) {
        const now = new Date();
        const canUse = now >= promo.dateDebut && now <= promo.dateFin && 
                       (promo.maxUtilisations === null || promo.utilisationsActuelles < promo.maxUtilisations);
        
        const uses = clientId ? promo.clientsUtilises.filter(id => id.toString() === clientId.toString()).length : 0;
        const alreadyReachedLimit = uses >= (promo.utilisationParClient || 1);
        
        if (canUse && !alreadyReachedLimit && serverSousTotal >= promo.montantMinimum) {
          let reduction = 0;
          if (promo.type === 'PERCENTAGE') {
            reduction = serverSousTotal * (promo.valeur / 100);
            if (promo.montantMaxReduction) reduction = Math.min(reduction, promo.montantMaxReduction);
          } else {
            reduction = Math.min(promo.valeur, serverSousTotal);
          }

          appliedPromo = {
            code: promo.code,
            type: promo.type,
            valeur: promo.valeur,
            reduction: reduction
          };

          console.log(`🏷️ [DEBUG] Code promo appliqué: ${appliedPromo.code} (-${reduction.toFixed(3)} DT)`);

          // Mettre à jour le code promo
          promo.utilisationsActuelles += 1;
          if (clientId) promo.clientsUtilises.push(clientId);
          await promo.save();
        } else {
          console.log(`🏷️ [DEBUG] Code promo rejeté:`, { 
            code: promo.code, 
            canUse, 
            alreadyReachedLimit, 
            serverSousTotal, 
            montantMin: promo.montantMinimum 
          });
        }
      }
    }


    // 🔹 Validation du montant minimum (Dynamique)
    const GlobalConfig = require("../models/GlobalConfig");
    const minOrderConfig = await GlobalConfig.findOne({ key: 'MIN_ORDER_AMOUNT' });
    const MIN_AMOUNT = minOrderConfig ? Number(minOrderConfig.value) : 100;

    if (total < MIN_AMOUNT) {
      return res.status(400).json({ 
        message: `Le montant minimum pour passer une commande est de ${MIN_AMOUNT.toFixed(3).replace('.', ',')} DT.`,
        details: [`Votre total actuel est de ${total.toFixed(3).replace('.', ',')} DT.`]
      });
    }

    // 🎯 3. Validation des Limites d'Achat (Marketplace)
    const purchaseLimitsConfig = await GlobalConfig.findOne({ key: 'MARKETPLACE_PURCHASE_LIMITS' });
    const defaultLimits = { particular: 100, pdv: 100 };
    const limits = purchaseLimitsConfig ? { ...defaultLimits, ...purchaseLimitsConfig.value } : defaultLimits;
    
    // Déterminer le pourcentage applicable
    let limitPercentage = 100;
    if (req.user?.role === 'pdv') {
      limitPercentage = limits.pdv;
    } else {
      limitPercentage = limits.particular;
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Le panier est vide." });
    }

    const lignesCommandeIds = [];

    // 3. Réserver le stock et créer les lignes finales
    for (const l of lignesTemp) {
      const { produit, totalUnits, prixUnitaire, item } = l;

      const stockConsolide = await StockConsolide.findOne({ produit: produit._id });
      
      console.log(`📦 [STOCK CHECK] Produit: "${produit.nom}" | Qté lots: ${l.quantiteLots} × multiplicateur: ${l.lot?.quantite_unitaire || 1} = ${totalUnits} unités demandées | Stock dispo: ${stockConsolide?.quantite_disponible ?? 'N/A'} | Réservé: ${stockConsolide?.quantite_reservee ?? 'N/A'} | Total: ${stockConsolide?.quantite_totale ?? 'N/A'}`);
      
      if (!stockConsolide || stockConsolide.quantite_disponible < totalUnits) {
        console.error(`❌ [STOCK INSUFFISANT] "${produit.nom}": demandé ${totalUnits}, disponible: ${stockConsolide?.quantite_disponible ?? 0}`);
        return res.status(400).json({ 
          message: `La quantité demandée pour "${produit.nom}" n'est pas disponible actuellement.`
        });
      }

      // Vérifier la limite d'achat (pourcentage du stock disponible)
      const purchaseLimit = Math.floor(stockConsolide.quantite_disponible * (limitPercentage / 100));
      if (totalUnits > purchaseLimit) {
        console.error(`❌ [LIMITE D'ACHAT DÉPASSÉE] "${produit.nom}": demandé ${totalUnits}, limite: ${purchaseLimit} (${limitPercentage}% de ${stockConsolide.quantite_disponible})`);
        return res.status(400).json({
          message: `Vous avez dépassé la limite d'achat pour "${produit.nom}". Vous pouvez commander au maximum ${purchaseLimit} unités.`,
          details: [`Quantité demandée : ${totalUnits} unités.`]
        });
      }

      const stockRestantApresCommande = stockConsolide.quantite_disponible - totalUnits;
      
      // 🚨 Respect du seuil minimum du produit - Notification au lieu de blocage
      if (stockRestantApresCommande < (produit.seuil_minimum || 0)) {
        // Déterminer le nom/type de l'utilisateur pour la notification
        let userName = req.user?.username;
        if (!userName && clientId) {
          const Model = userType === 'pdv' ? PointDeVente : Client;
          const userDoc = await Model.findById(clientId);
          if (userDoc) {
            userName = userType === 'pdv' ? userDoc.nom : `${userDoc.prenom} ${userDoc.nom}`;
          }
        }
        userName = userName || (userType === 'pdv' ? 'Un point de vente' : 'Un client');

        const typeUserLabel = userType === 'pdv' ? 'Le point de vente' : 'Le client';
        const notifTitle = `⚠️ Seuil minimum dépassé : ${produit.nom}`;
        const notifMsg = `${typeUserLabel} ${userName} a passé une commande qui fait passer le stock de "${produit.nom}" sous son seuil minimum (${produit.seuil_minimum} unités). Nouveau stock restant après commande : ${stockRestantApresCommande} unités.`;
        
        await notifyAllAdmins("STOCK_DEPASSE_SEUIL", notifTitle, notifMsg, { produitId: produit._id, userName, userType });
        await notifyAllResponsables("STOCK_DEPASSE_SEUIL", notifTitle, notifMsg, { produitId: produit._id, userName, userType });
        
        console.log(`📢 Notification de dépassement de seuil marketplace envoyée pour ${produit.nom} par ${userName} (${userType})`);
      }

      await stockConsolide.reserverStock(totalUnits);
      reservations.push({ stockConsolideId: stockConsolide._id, quantite: totalUnits });

      const ligneCommande = new LigneCommande({
        produit: produit._id,
        quantite: totalUnits,
        quantite_restante: totalUnits, // ✅ Now waits for preparation to be marked as 0
        prix_unitaire: prixUnitaire,
        unite: produit.unite,
        marque: produit.marque,
        categorie: produit.categorie,
        lot: l.lot?._id || null,
        quantite_lots: l.lot ? l.quantiteLots : null
      });
      await ligneCommande.save();
      lignesCommandeIds.push(ligneCommande._id);
    }


    // 🎯 FIDÉLITÉ: Utilisation des points au checkout
    let fideliteReduction = 0;
    let pointsToSpend = 0;
    if (req.body.pointsUtilises && req.body.pointsUtilises > 0 && clientId && userType === 'client') {
      const { spendPoints } = require('../services/pointsService');
      const result = await spendPoints(
        clientId,
        req.body.pointsUtilises,
        `Réduction sur commande - En attente`
      );
      
      if (result.success) {
        fideliteReduction = result.reduction;
        pointsToSpend = req.body.pointsUtilises;
        console.log(`⭐ Points fidélité utilisés: ${pointsToSpend} pts (-${fideliteReduction.toFixed(3)} DT)`);
      } else {
        console.warn(`⚠️ Échec utilisation points: ${result.message}`);
        // On continue sans la réduction si les points ne sont pas dispos
      }
    }

    // 🎯 CALCUL FINAL DU TOTAL (Sécurité Serveur)
    // ✅ On utilise serverSousTotal (calculé depuis les lineTotals exacts) pour éviter
    //    la perte de précision flottante: ex. 3000 * 1.833333 = 5499.999 au lieu de 5500
    const fraisServer = (fraisLivraison !== undefined ? fraisLivraison : (serverSousTotal >= 100 ? 0 : 8));
    const fraisFinal = serverSousTotal >= 100 ? 0 : fraisServer;
    const remisePromoAmt = appliedPromo?.reduction || 0;
    const remiseFideliteAmt = fideliteReduction || 0;
    const totalFinal = Math.max(0, serverSousTotal + fraisFinal - remisePromoAmt - remiseFideliteAmt);

    const resultFinance = {
      sousTotal: Number(serverSousTotal.toFixed(3)),
      fraisLivraison: Number(fraisFinal.toFixed(3)),
      remisePromo: Number(remisePromoAmt.toFixed(3)),
      remiseFidelite: Number(remiseFideliteAmt.toFixed(3)),
      total: Number(totalFinal.toFixed(3))
    };

    // Logger un écart si le client a essayé de manipuler le total
    if (Math.abs(resultFinance.total - total) > 0.01) {
      console.warn(`🚨 [SECURITE] Écart de total détecté sur commande client ! Client: ${total} DT, Serveur: ${resultFinance.total} DT`);
    }

    console.log(`💰 [DEBUG] Calcul final commande:`, {
      serverSousTotal,
      appliedPromo: appliedPromo ? { code: appliedPromo.code, reduction: appliedPromo.reduction } : null,
      fideliteReduction,
      resultFinance,
      clientTotal: total
    });

    // 2. Create Order
    const commande = new Commande({
      client: userType === 'client' ? clientId : null,
      pointDeVente: userType === 'pdv' ? clientId : null,
      lignesCommande: lignesCommandeIds,
      statut: "EN_ATTENTE",
      total: resultFinance.total,
      sousTotal: resultFinance.sousTotal,
      fraisLivraison: resultFinance.fraisLivraison,
      codePromo: appliedPromo,
      note_client,
      planification: req.body.planification,


      fidelite: {
        pointsUtilises: pointsToSpend,
        reduction: fideliteReduction
      },
      adresse_livraison: {
        gouvernorat: adresse_livraison.governorate,
        delegation: adresse_livraison.delegation,
        localite: adresse_livraison.locality,
        rue: adresse_livraison.street,
        codePostal: adresse_livraison.zip,
        telephone: adresse_livraison.phone,
        nom: adresse_livraison.lastName,
        prenom: adresse_livraison.firstName,
        latitude: adresse_livraison.latitude ? Number(adresse_livraison.latitude) : undefined,
        longitude: adresse_livraison.longitude ? Number(adresse_livraison.longitude) : undefined
      }
    });
    await commande.save();

    // ✅ FIX: Marketplace orders no longer create an automatic delivery upon creation.
    // They will now follow the same logic as direct orders: 
    // a delivery is created ONLY when the responsible agent clicks "Préparer".
    // This standardizes the workflow and allows for modifications while "EN_ATTENTE".


    // 3. Update User Info (Save name and phone for next time)
    if (clientId) {
      let userModel;
      if (userType === 'client') {
        userModel = await Client.findById(clientId);
      } else {
        userModel = await Utilisateur.findById(clientId);
      }

      if (userModel) {
        // Update basic info - ensure we use the provided info from the order if available
        if (adresse_livraison.phone) userModel.telephone = adresse_livraison.phone;
        if (adresse_livraison.lastName) userModel.nom = adresse_livraison.lastName;
        if (adresse_livraison.firstName) userModel.prenom = adresse_livraison.firstName;
        
        // Specifically for clients, save the address
        if (userType === 'client') {
          // Keep only one single address in B2C client's profile to avoid legacy duplicate listings
          userModel.adresses = [{
            label: 'Adresse enregistrée',
            gouvernorat: adresse_livraison.governorate || 'Tunisie',
            delegation: '',
            localite: '',
            rue: adresse_livraison.street,
            codePostal: '',
            isDefault: true,
            latitude: adresse_livraison.latitude ? Number(adresse_livraison.latitude) : undefined,
            longitude: adresse_livraison.longitude ? Number(adresse_livraison.longitude) : undefined
          }];
          userModel.markModified('adresses');

          // ✅ CLEAR CART AFTER ORDER
          userModel.panier = [];

          // ✅ UPDATE CLIENT STATS (nombreCommandes, derniereCommande)
          await userModel.incrementOrders();
        } else {
          await userModel.save();
        }
      }
    }

    // 🔔 Notifier les responsables de la nouvelle commande marketplace
    let clientForNotif = null;
    if (userType === 'client') {
      clientForNotif = await Client.findById(clientId).select('nom prenom email').lean();
    } else if (userType === 'pdv') {
      const pdv = await PointDeVente.findById(clientId).select('nom responsable_nom email').lean();
      if (pdv) {
        clientForNotif = {
          nom: pdv.responsable_nom || pdv.nom,
          prenom: '',
          email: pdv.email
        };
      }
    }
    notifyNewCommandeClient(commande, clientForNotif, total); // fire-and-forget, ne bloque pas

    // 📧 Notification Email - Event Driven
    orderEmitter.emit('order_placed', { 
      commande: await Commande.findById(commande._id).populate({
        path: 'lignesCommande',
        populate: { path: 'produit' }
      }), 
      client: clientForNotif
    });

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('new_order', {
        _id: commande._id,
        type: 'marketplace',
        total: total,
        statut: 'EN_ATTENTE',
        timestamp: new Date()
      });
    }

    res.status(201).json({ 
      message: "Commande confirmée !", 
      commande,
      commandeId: commande._id,
      user: clientId ? (userType === 'client' ? await Client.findById(clientId).select("-password") : await Utilisateur.findById(clientId).select("-password")) : null
    });

  } catch (error) {
    console.error("❌ Erreur passerCommandeClient:", error);
    
    // Rollback reservations
    try {
      for (const r of reservations) {
        const sc = await StockConsolide.findById(r.stockConsolideId);
        if (sc) await sc.libererStockReserve(r.quantite);
      }
    } catch (rollbackErr) {
      console.error("❌ Erreur rollback:", rollbackErr);
    }

    // Handle validation errors specifically
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: "Erreur de validation", details: messages });
    }

    res.status(500).json({ message: "Erreur interne du serveur lors de la commande", error: error.message });
  }
};

/**
 * UC1 – Créer une commande (avec réservation)
 */
exports.creerCommande = async (req, res) => {
  // Garder la trace des réservations effectuées pour pouvoir rollback en cas d'erreur
  let reservations = [];
  

  try {
    const { point_vente, lignes } = req.body;

    const pointDeVente = await PointDeVente.findById(point_vente);
    if (!pointDeVente) {
      return res.status(404).json({ message: "Point de vente introuvable" });
    }


    const lignesCommandeIds = [];

    // 🔎 Vérification stock (avec seuil minimum) et réservation
    for (const ligne of lignes) {
      
      const produit = await Produit.findById(ligne.produit);
      if (!produit) {
        return res.status(404).json({ message: "Produit introuvable" });
      }

      // Utiliser le stock consolidé au lieu des stocks individuels
      const stockConsolide = await StockConsolide.findOne({ produit: ligne.produit });
      if (!stockConsolide) {
        return res.status(404).json({ 
          message: `Stock consolidé introuvable pour le produit "${produit.nom}"` 
        });
      }

      const stockDisponible = stockConsolide.quantite_disponible;
      const stockRestantApresCommande = stockDisponible - ligne.quantite;

      if (stockDisponible < ligne.quantite) {
        return res.status(400).json({
          message: `❌ Stock insuffisant pour "${produit.nom}".`
        });
      }

      // 🚨 Respect du seuil minimum du produit - Notification au lieu de blocage
      if (stockRestantApresCommande < (produit.seuil_minimum || 0)) {
        // Obtenir le nom du responsable pour la notification
        let responsableName = req.user?.username;
        if (!responsableName && req.user?.id) {
          const user = await Utilisateur.findById(req.user.id);
          if (user) responsableName = user.username;
        }
        responsableName = responsableName || 'Un responsable';

        const notifTitle = `⚠️ Seuil minimum dépassé : ${produit.nom}`;
        const notifMsg = `Le responsable ${responsableName} a passé une commande qui fait passer le stock de "${produit.nom}" sous son seuil minimum (${produit.seuil_minimum} unités). Nouveau stock restant après commande : ${stockRestantApresCommande} unités.`;
        
        await notifyAllAdmins("STOCK_DEPASSE_SEUIL", notifTitle, notifMsg, { produitId: produit._id, responsableName });
        await notifyAllResponsables("STOCK_DEPASSE_SEUIL", notifTitle, notifMsg, { produitId: produit._id, responsableName });
        
        console.log(`📢 Notification de dépassement de seuil envoyée pour ${produit.nom} par ${responsableName}`);
      }

      // 🔒 Réservation dans le stock consolidé
      try {
        await stockConsolide.reserverStock(ligne.quantite);
        
        // mémoriser la réservation pour éventuel rollback
        reservations.push({
          stockConsolideId: stockConsolide._id,
          quantite: ligne.quantite
        });
      } catch (error) {
        return res.status(400).json({
          message: `❌ Erreur lors de la réservation pour "${produit.nom}": ${error.message}`
        });
      }

      const ligneCommande = new LigneCommande({
        produit: ligne.produit,
        quantite: ligne.quantite,
        quantite_restante: ligne.quantite,
        prix_unitaire: ligne.prix_unitaire,
        quantite_retournee: 0,
        unite: produit.unite,
        marque: produit.marque,
        categorie: produit.categorie,   // ajouté
        lot: ligne.lot || null,          // ajouté pour les lots
        quantite_lots: ligne.quantite_lots || null // quantité originale en lots
      });

      await ligneCommande.save();
      lignesCommandeIds.push(ligneCommande._id);
    }

    // 🎯 CALCUL FINANCIER B2B (Mêmes règles que B2C)
    const sousTotal = lignes.reduce((sum, l) => sum + (l.quantite * l.prix_unitaire), 0);
    const fraisLivraison = sousTotal >= 100 ? 0 : 8;
    const totalCommande = sousTotal + fraisLivraison;

    const commande = new Commande({
      pointDeVente: point_vente,
      lignesCommande: lignesCommandeIds,
      statut: "EN_ATTENTE",
      date_creation: new Date(),
      sousTotal: Number(sousTotal.toFixed(3)),
      fraisLivraison: Number(fraisLivraison.toFixed(3)),
      total: Number(totalCommande.toFixed(3))
    });

    await commande.save();

    // 📧 Notification
    orderEmitter.emit('order_placed', { commande });

    // 📝 Enregistrer un SEUL mouvement de stock (RESERVATION) pour toute la commande
    try {
      const totalQuantite = lignes.reduce((sum, ligne) => sum + ligne.quantite, 0);
      const nbProduitsDiff = lignes.length;
      
      await enregistrerMouvement({
        stockId: null,      // Pas de stock spécifique lié à l'ordre global
        type: 'RESERVATION',
        quantite: totalQuantite,
        utilisateurId: req.user?.id,
        reference: commande._id,
        reference_type: 'Commande',
        commentaire: `Création commande (${nbProduitsDiff} produit${nbProduitsDiff > 1 ? 's' : ''})`
      });
    } catch (mouvErr) {
      console.error("Erreur lors de l'enregistrement du mouvement de réservation:", mouvErr);
      // Ne pas bloquer la création de la commande pour une erreur de traçabilité
    }

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('new_order', {
        _id: commande._id,
        type: 'b2b',
        total: totalCommande,
        statut: 'EN_ATTENTE',
        timestamp: new Date()
      });
    }

    res.status(201).json({
      message: "Commande créée et stock réservé",
      commande
    });

  } catch (err) {
    console.error(err);

    // 🔁 Rollback des réservations si une erreur survient en cours de traitement
    try {
      if (Array.isArray(reservations) && reservations.length > 0) {
        for (const r of reservations) {
          const stockConsolide = await StockConsolide.findById(r.stockConsolideId);
          if (stockConsolide) {
            await stockConsolide.libererStockReserve(r.quantite);
          }
        }
      }
    } catch (rollbackErr) {
      console.error("Erreur pendant le rollback des réservations :", rollbackErr);
    }

    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * UC1.5 – Modifier une commande (EN_ATTENTE ou PREPAREE uniquement)
 */
exports.modifierCommande = async (req, res) => {
  let reservations = [];
  let liberations = [];
  

  try {
    const { commandeId } = req.params;
    const { lignes } = req.body; // Nouvelles lignes de commande

    const commande = await Commande.findById(commandeId).populate("lignesCommande");
    if (!commande) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    // ⚠️ Vérifier que la commande peut être modifiée
    // ⚠️ Vérifier que la commande peut être modifiée (Uniquement si EN_ATTENTE)
    if (commande.statut !== "EN_ATTENTE") {
      return res.status(400).json({
        message: `Impossible de modifier une commande avec le statut ${commande.statut}. Annulez la préparation ou la livraison d'abord.`
      });
    }

    // Vérifier qu'il n'y a pas de livraisons actives
    const Livraison = require("../models/Livraison");
    const livraisonsActives = await Livraison.find({
      commande: commandeId,
      statut: { $nin: ["ANNULEE"] }
    });

    if (livraisonsActives.length > 0) {
      return res.status(400).json({
        message: "Impossible de modifier une commande avec des livraisons actives. Annulez d'abord les livraisons."
      });
    }

    // ÉTAPE 1: Libérer tout le stock réservé des anciennes lignes (SANS les supprimer encore)
    const anciensIds = [];
    for (const ancienneLigne of commande.lignesCommande) {
      anciensIds.push(ancienneLigne._id);
      
      // Utiliser le stock consolidé pour libérer la réservation
      const stockConsolide = await StockConsolide.findOne({ produit: ancienneLigne.produit });
      if (stockConsolide) {
        try {
          await stockConsolide.libererStockReserve(ancienneLigne.quantite);
          
          liberations.push({
            stockConsolideId: stockConsolide._id,
            quantite: ancienneLigne.quantite
          });
        } catch (error) {
          console.error(`Erreur lors de la libération du stock pour ${ancienneLigne.produit}:`, error.message);
        }
      }
    }

    // ÉTAPE 2: Créer les nouvelles lignes et réserver le stock
    const nouvellesLignesIds = [];

    for (const ligne of lignes) {
      const produit = await Produit.findById(ligne.produit);
      if (!produit) {
        throw new Error(`Produit ${ligne.produit} introuvable`);
      }

      // Vérifier stock disponible avec le système consolidé
      const stockConsolide = await StockConsolide.findOne({ produit: ligne.produit });
      if (!stockConsolide) {
        throw new Error(`Stock consolidé introuvable pour le produit "${produit.nom}"`);
      }

      const stockDisponible = stockConsolide.quantite_disponible;
      const stockRestantApresModification = stockDisponible - ligne.quantite;

      if (stockDisponible < ligne.quantite) {
        throw new Error(
          `❌ Stock insuffisant pour "${produit.nom}".`
        );
      }

      if (stockRestantApresModification < (produit.seuil_minimum || 0)) {
        // En cas de modification de commande, on notifie aussi si le seuil est dépassé
        let responsableName = req.user?.username;
        if (!responsableName && req.user?.id) {
          const user = await Utilisateur.findById(req.user.id);
          if (user) responsableName = user.username;
        }
        responsableName = responsableName || 'Un responsable';

        const notifTitle = `⚠️ Seuil minimum dépassé (Modification) : ${produit.nom}`;
        const notifMsg = `Le responsable ${responsableName} a modifié une commande qui fait passer le stock de "${produit.nom}" sous son seuil minimum (${produit.seuil_minimum} unités). Nouveau stock restant après modification : ${stockRestantApresModification} unités.`;
        
        await notifyAllAdmins("STOCK_DEPASSE_SEUIL", notifTitle, notifMsg, { produitId: produit._id, responsableName });
        await notifyAllResponsables("STOCK_DEPASSE_SEUIL", notifTitle, notifMsg, { produitId: produit._id, responsableName });
        
        console.log(`📢 Notification de dépassement de seuil envoyée (Modification) pour ${produit.nom} par ${responsableName}`);
      }

      // Réserver le stock dans le système consolidé
      try {
        await stockConsolide.reserverStock(ligne.quantite);
        
        reservations.push({
          stockConsolideId: stockConsolide._id,
          quantite: ligne.quantite
        });
      } catch (error) {
        throw new Error(`❌ Erreur lors de la réservation pour "${produit.nom}": ${error.message}`);
      }

      // Créer la nouvelle ligne
      const nouvelleLigne = new LigneCommande({
        produit: ligne.produit,
        quantite: ligne.quantite,
        quantite_restante: ligne.quantite,
        prix_unitaire: ligne.prix_unitaire,
        quantite_retournee: 0,
        unite: produit.unite,
        marque: produit.marque,
        categorie: produit.categorie,
        lot: ligne.lot || null,          // ajouté pour les lots
        quantite_lots: ligne.quantite_lots || null // quantité originale en lots
      });

      await nouvelleLigne.save();
      nouvellesLignesIds.push(nouvelleLigne._id);
    }

    // ÉTAPE 3: Mettre à jour la commande
    // Recalculer les totaux pour le B2B (ou B2C manuel si applicable)
    const newSousTotal = lignes.reduce((sum, l) => sum + (l.quantite * l.prix_unitaire), 0);
    const newFrais = newSousTotal >= 100 ? 0 : 8;

    commande.lignesCommande = nouvellesLignesIds;
    commande.sousTotal = Number(newSousTotal.toFixed(3));
    commande.fraisLivraison = Number(newFrais.toFixed(3));
    commande.total = Number((newSousTotal + newFrais).toFixed(3));
    commande.statut = "EN_ATTENTE"; // Réinitialiser le statut pour permettre une nouvelle préparation
    await commande.save();

    orderEmitter.emit('order_status_changed', { 
      commandeId: commande._id, 
      oldStatus: 'EN_ATTENTE', 
      newStatus: 'MODIFIEE' 
    });

    // ÉTAPE 4: Maintenant que tout est réussi, supprimer les anciennes lignes
    for (const ancienId of anciensIds) {
      await LigneCommande.findByIdAndDelete(ancienId);
    }

    // Recharger la commande avec toutes les données peuplées
    const commandeComplete = await Commande.findById(commandeId)
      .populate("pointDeVente")
      .populate({
        path: "lignesCommande",
        populate: [
          { path: "produit", options: { withDeleted: true } },
          { path: "lot" }
        ]
      });

    res.json({
      message: "Commande modifiée avec succès",
      commande: commandeComplete
    });

  } catch (err) {
    console.error("❌ Erreur modification commande:", err);

    // Rollback: annuler les réservations et restaurer les libérations
    try {
      // Annuler les nouvelles réservations
      for (const r of reservations) {
        const stockConsolide = await StockConsolide.findById(r.stockConsolideId);
        if (stockConsolide) {
          await stockConsolide.libererStockReserve(r.quantite);
        }
      }

      // Remettre les libérations (re-réserver ce qui avait été libéré)
      for (const l of liberations) {
        const stockConsolide = await StockConsolide.findById(l.stockConsolideId);
        if (stockConsolide) {
          await stockConsolide.reserverStock(l.quantite);
        }
      }
    } catch (rollbackErr) {
      console.error("❌ Erreur pendant le rollback:", rollbackErr);
    }

    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * UC2 – Préparer commande (PAS DE DÉSTOCKAGE)
 */
exports.preparerCommande = async (req, res) => {
  
  try {
    const { commandeId } = req.params;

    const commande = await Commande.findById(commandeId).populate('lignesCommande');
    if (!commande) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (commande.statut !== "EN_ATTENTE") {
      return res.status(400).json({ message: "Commande non préparable" });
    }

    // 🛡️ Vérification de la cohérence du stock avant préparation
    for (const ligne of commande.lignesCommande) {
      const stockConsolide = await StockConsolide.findOne({ produit: ligne.produit });
      if (!stockConsolide) {
        return res.status(400).json({
          message: `Stock consolidé introuvable pour le produit ${ligne.produit}`
        });
      }

      // Vérifier que le stock total couvre au moins le stock réservé
      if (stockConsolide.quantite_totale < stockConsolide.quantite_reservee) {
        return res.status(400).json({
          message: `Problème de stock sur le produit ${ligne.produit}. Stock total (${stockConsolide.quantite_totale}) inférieur au stock réservé (${stockConsolide.quantite_reservee}).`
        });
      }
    }

    commande.statut = "PREPAREE";
    await commande.save();

    // 📧 Notification Email
    orderEmitter.emit('order_status_changed', { 
      commandeId: commande._id, 
      oldStatus: 'EN_ATTENTE', 
      newStatus: 'PREPAREE', 
      source: 'ADMIN' 
    });

    let livraisonCreee = false;

    // 🚚 NOUVEAU: Création automatique d'une livraison lors du passage en statut PREPAREE
    // Cela permet de modifier la commande librement tant qu'elle est EN_ATTENTE
    try {
      console.log(`📦 Création livraison automatique pour commande préparée ${commande._id}`);
      
      const lignesLivraison = [];
      let poidsTotal = 0;
      let montantTotal = 0;

      // On peuple les lignes pour avoir les infos de poids et de prix (produit et lot)
      const lignesPeuplees = await LigneCommande.find({ _id: { $in: commande.lignesCommande } }).populate('produit').populate('lot');

      for (const ligne of lignesPeuplees) {
        const pU = parseFloat(ligne.produit?.poids_unitaire || 0);
        poidsTotal += (ligne.quantite * pU);
        
        // Calcul du montant : quantite × prix_unitaire = total (convention unifiée)
        montantTotal += (ligne.quantite * (ligne.prix_unitaire || 0));

        lignesLivraison.push({
          produit: ligne.produit?._id || ligne.produit,
          quantite: ligne.quantite,
          lot: ligne.lot || null,
          quantite_lots: ligne.quantite_lots || null
        });

        // ✅ IMPORTANT: Marquer la ligne de commande comme étant entièrement assignée à une livraison
        if (ligne.quantite_restante > 0) {
            ligne.quantite_restante = 0;
            await ligne.save();
        }
      }

      if (lignesLivraison.length > 0) {
        // ✅ FIX: Vérifier si une livraison non-annulée existe déjà (pour éviter doublon B2C)
        const livraisonsExistantes = await Livraison.find({ 
          commande: commande._id, 
          statut: { $ne: 'ANNULEE' } 
        });

        if (livraisonsExistantes.length > 0) {
          console.log(`⏭️ Livraison(s) déjà existante(s) pour commande ${commande._id}, skip auto-création.`);
        } else {
          const livraison = new Livraison({
            commande: commande._id,
            poids_total: poidsTotal,
            lignesLivraison,
            montant_total: montantTotal + (commande.fraisLivraison || 0), // Inclure les frais de livraison
            statut: "EN_ATTENTE",
            date_creation: new Date()
          });

          await livraison.save();
          console.log(`✅ Livraison automatique ${livraison._id} créée après préparation.`);
          livraisonCreee = true;

          const nouvelleFacture = new Facture({
            livraison: livraison._id,
            commande: commande._id,
            montant_total: montantTotal + (commande.fraisLivraison || 0),
            statut: 'PROFORMA',
            date_echeance: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          });

          await nouvelleFacture.save();
          
          // Lier la facture à la livraison
          await Livraison.updateOne({ _id: livraison._id }, { $set: { facture: nouvelleFacture._id } });
          
          console.log(`📄 Facture proforma générée pour livraison ${livraison._id}`);
        }
      }
    } catch (livErr) {
      console.error("❌ Erreur lors de la création de la livraison automatique après préparation:", livErr);
      // On ne bloque pas le processus si la création de livraison échoue
    }

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('order_status_changed', {
        _id: commande._id,
        oldStatus: 'EN_ATTENTE',
        newStatus: 'PREPAREE',
        timestamp: new Date()
      });
      if (livraisonCreee) {
        dashboardIo.to('staff').emit('new_delivery', {
          timestamp: new Date()
        });
      }
    }

    res.json({
      message: "Commande préparée avec succès",
      commande
    });

  } catch (err) {
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * UC3 – Livrer commande (DESTOCKAGE SÉCURISÉ + CONTRÔLE PAR PRODUIT)
 */
exports.livrerCommande = async (req, res) => {
  try {
    const { commandeId } = req.params;
    const { lignes } = req.body; // tableau { produit: id, quantite: number }

    const commande = await Commande.findById(commandeId)
      .populate({
        path: "lignesCommande",
        populate: [
          { path: "lot" },
          { path: "produit", options: { withDeleted: true } }
        ]
      });

    if (!commande || commande.statut !== "PREPAREE") {
      return res.status(400).json({ message: "Commande non livrable" });
    }

    // 🔎 Vérification par ligne si on dépasse la commande
    for (const ligneLivraison of lignes) {
      const ligneCommande = commande.lignesCommande.find(
        (l) => l.produit.toString() === ligneLivraison.produit
      );

      if (!ligneCommande) {
        return res.status(400).json({
          message: `Produit ${ligneLivraison.produit} non présent dans la commande`
        });
      }

      if (ligneLivraison.quantite > ligneCommande.quantite_restante) {
        const produitNom = ligneCommande.produit?.nom || ligneCommande.produit;
        return res.status(400).json({
          message: `Quantité demandée (${ligneLivraison.quantite}) supérieure à la quantité disponible (${ligneCommande.quantite_restante}) pour le produit "${produitNom}"`
        });
      }
    }

    // 🔄 Effectuer la livraison
    for (const ligneLivraison of lignes) {
      const ligneCommande = commande.lignesCommande.find(
        (l) => l.produit.toString() === ligneLivraison.produit
      );

      // Utiliser uniquement le stock consolidé pour toutes les opérations
      const stockConsolide = await StockConsolide.findOne({ produit: ligneLivraison.produit });
      if (!stockConsolide) {
        return res.status(400).json({
          message: `Stock consolidé introuvable pour le produit ${ligneLivraison.produit}`
        });
      }

      // Récupérer les informations de lot si disponibles
      const lot = ligneCommande.lot;
      
      // Utiliser l'ID formaté de la commande (nouveau système)
      const commandeIdFormate = commande.id_formate || `CMD-${commande.numero_commande?.toString().padStart(4, '0') || '????'}`;
      let commentaire = `Livraison commande ${commandeIdFormate}`;
      
      // Préparer les informations de lot
      let lotInfo = null;
      if (lot) {
        const nbLots = Math.floor(ligneLivraison.quantite / lot.quantite_unitaire);
        const resteLots = ligneLivraison.quantite % lot.quantite_unitaire;
        
        lotInfo = {
          lot_id: lot._id,
          nom_lot: lot.nom,
          quantite_unitaire: lot.quantite_unitaire,
          nombre_lots: nbLots,
          reste_unites: resteLots
        };
      }

      // DÉSTOCKAGE DIRECT dans le stock consolidé
      try {
        // 1. Libérer la réservation
        await stockConsolide.libererStockReserve(ligneLivraison.quantite);
        
        // 2. Retirer du stock total (déstockage physique)
        await stockConsolide.retirerStock(ligneLivraison.quantite);
        
        console.log(`📦 Livraison ${ligneLivraison.quantite} unités de ${ligneLivraison.produit} - Stock consolidé mis à jour`);
        
        // 3. Enregistrer un mouvement pour traçabilité (optionnel, si vous voulez garder l'historique)
        // Note: Vous pouvez créer un système de mouvements pour StockConsolide si nécessaire
        
      } catch (error) {
        return res.status(400).json({
          message: `❌ Erreur lors du déstockage pour le produit ${ligneLivraison.produit}: ${error.message}`
        });
      }

      // ✅ Mettre à jour quantite_restante de la ligne
      ligneCommande.quantite_restante -= ligneLivraison.quantite;
      await ligneCommande.save();
    }

    // Vérifier si la commande est entièrement livrée
    const totaleRestante = commande.lignesCommande.reduce(
      (sum, l) => sum + l.quantite_restante,
      0
    );

    // ⚠️ NOTE: Cette fonction livre directement sans créer de livraison
    // Elle ne devrait être utilisée que dans des cas exceptionnels
    // La logique normale passe par le système de livraisons
    
    // Mettre à jour le statut selon la logique métier
    if (totaleRestante === 0) {
      // Toutes les quantités ont été livrées
      commande.statut = "LIVREE";
      await commande.save();
      console.log(`✅ Commande ${commande._id} passée en statut LIVREE (livraison directe)`);
    } else {
      // Il reste des quantités à livrer
      commande.statut = "EN_LIVRAISON";
      await commande.save();
      console.log(`📦 Commande ${commande._id} passée en statut EN_LIVRAISON (livraison partielle)`);
    }

    res.json({
      message: "Livraison effectuée avec succès",
      commande
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * UC4 – Annuler commande (LIBÉRATION STOCK RÉSERVÉ)
 */
exports.annulerCommande = async (req, res) => {
  try {
    const { commandeId } = req.params;
    const commande = await Commande.findById(commandeId).populate("lignesCommande");

    if (!commande) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    if (commande.statut === "LIVREE") {
      return res.status(400).json({ message: "Commande déjà livrée, impossible d'annuler" });
    }

    if (commande.statut === "ANNULEE") {
      return res.status(400).json({ message: "Commande déjà annulée" });
    }

    // 🔍 ÉTAPE 1: Annuler toutes les livraisons non livrées ET non annulées associées à cette commande
    const Livraison = require("../models/Livraison");
    const livraisons = await Livraison.find({
      commande: commandeId,
      statut: { $nin: ["LIVREE", "ANNULEE"] } // Exclure LIVREE et ANNULEE
    });

    for (const livraison of livraisons) {
      // Remettre les quantités dans quantite_restante
      for (const ligneLiv of livraison.lignesLivraison) {
        const ligneCmd = commande.lignesCommande.find(
          l => l.produit.toString() === ligneLiv.produit.toString()
        );

        if (ligneCmd) {
          const ancienneQte = ligneCmd.quantite_restante;
          ligneCmd.quantite_restante += ligneLiv.quantite;

          // ⚠️ SÉCURITÉ: Plafonner quantite_restante à la quantité commandée
          if (ligneCmd.quantite_restante > ligneCmd.quantite) {
            console.warn(`⚠️  ATTENTION: quantite_restante (${ligneCmd.quantite_restante}) > quantite (${ligneCmd.quantite})`);
            console.warn(`   Plafonnement à ${ligneCmd.quantite} pour éviter les incohérences`);
            ligneCmd.quantite_restante = ligneCmd.quantite;
          }

          await ligneCmd.save();
        }
      }

      // Marquer la livraison comme annulée avec l'origine
      livraison.statut = "ANNULEE";
      livraison.annulation_origine = "COMMANDE"; // ✅ NOUVEAU: Marquer l'origine
      livraison.stock_libere = true; // ✅ NOUVEAU: Stock déjà libéré par l'annulation de commande
      await livraison.save();
    }

    // 🚢 ÉTAPE 1.5: Vérifier si les voyages associés doivent aussi être annulés
    const voyageIds = [...new Set(livraisons.map(l => l.voyage?.toString()).filter(Boolean))];
    if (voyageIds.length > 0) {
      const Voyage = require("../models/Voyage");
      const Camion = require("../models/Camion");
      
      for (const vId of voyageIds) {
        const voyage = await Voyage.findById(vId).populate("livraisons");
        if (voyage && voyage.statut !== "ANNULE" && voyage.statut !== "TERMINE") {
          // Vérifier si toutes les livraisons de ce voyage sont ANNULEE
          const toutesAnnulees = voyage.livraisons.every(l => l.statut === "ANNULEE");
          
          if (toutesAnnulees) {
            console.log(`🚢 Voyage ${vId} : Toutes les livraisons sont annulées. Annulation du voyage.`);
            
            // Si le voyage était EN_COURS, libérer le camion
            if (voyage.statut === "EN_COURS" && voyage.camion) {
              await Camion.findByIdAndUpdate(voyage.camion, { statut: "DISPONIBLE" });
              console.log(`🚛 Camion ${voyage.camion} remis à DISPONIBLE`);
            }
            
            voyage.statut = "ANNULE";
            await voyage.save();
          }
        }
      }
    }

    // 🔓 ÉTAPE 2: Libérer le stock réservé pour chaque ligne
    for (const ligne of commande.lignesCommande) {
      // Calculer la quantité réellement commandée (non annulée/libérée)
      const qteReelle = ligne.quantite_reellement_commandee || ligne.quantite;
      
      // Utiliser quantite_restante mais limitée à qteReelle
      let reste = Math.min(ligne.quantite_restante, qteReelle);

      if (reste <= 0) {
        continue;
      }

      // Libérer le stock dans le système consolidé
      const stockConsolide = await StockConsolide.findOne({ produit: ligne.produit });
      if (stockConsolide) {
        try {
          await stockConsolide.libererStockReserve(reste);
        } catch (error) {
          console.warn(`⚠️ Erreur lors de la libération du stock consolidé pour ${ligne.produit}:`, error.message);
        }
      } else {
        console.warn(`⚠️ Stock consolidé introuvable pour le produit ${ligne.produit}`);
      }
      
      // ✅ SIMPLIFICATION: Remettre simplement à 0 pour éviter les problèmes de calcul
      ligne.quantite_reellement_commandee = 0; // Commande annulée = plus rien de commandé
      ligne.quantite_restante = 0; // Plus rien à livrer
      ligne.quantite_annulee = ligne.quantite; // Tout est annulé
      
      console.log(`📊 Ligne ${ligne.produit}: Remise à 0 (commande annulée)`);
      
      await ligne.save();
    }

    // 🔄 REMBOURSEMENT STRIPE AUTOMATIQUE
    if (commande.mode_paiement === 'CARTE' && commande.stripePaymentIntentId) {
      try {
        const stripeInstance = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const refund = await stripeInstance.refunds.create({
          payment_intent: commande.stripePaymentIntentId,
        });
        console.log(`💰 [STRIPE] Remboursement automatique créé avec succès: ${refund.id} pour la commande ${commande._id}`);
      } catch (stripeErr) {
        console.error("❌ [STRIPE] Échec du remboursement automatique:", stripeErr.message);
      }
    }

    const ancienStatut = commande.statut;
    commande.statut = "ANNULEE";
    await commande.save();

    // 📧 Notification Email
    orderEmitter.emit('order_status_changed', { 
      commandeId: commande._id, 
      oldStatus: ancienStatut, 
      newStatus: 'ANNULEE', 
      source: 'ADMIN' 
    });

    // 📝 Enregistrer un SEUL mouvement de stock (LIBERATION) pour toute la commande

    try {
      const totalQuantite = commande.lignesCommande.reduce((sum, ligne) => sum + (ligne.quantite_annulee || ligne.quantite), 0);
      const nbProduitsDiff = commande.lignesCommande.length;
      
      await enregistrerMouvement({
        stockId: null,      // Pas de stock spécifique
        type: 'LIBERATION',
        quantite: totalQuantite,
        utilisateurId: req.user?.id,
        reference: commande._id,
        reference_type: 'Commande',
        commentaire: `Annulation commande (${nbProduitsDiff} produit${nbProduitsDiff > 1 ? 's' : ''})`
      });
    } catch (mouvErr) {
      console.error("Erreur lors de l'enregistrement du mouvement d'annulation:", mouvErr);
    }

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('order_status_changed', {
        _id: commande._id,
        oldStatus: ancienStatut,
        newStatus: 'ANNULEE',
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('delivery_status_changed', { timestamp: new Date() });
      dashboardIo.to('staff').emit('voyage_finished', { timestamp: new Date() });
    }

    res.json({
      message: "Commande annulée et stock libéré",
      commande
    });

  } catch (err) {
    console.error("❌ Erreur lors de l'annulation:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * UC5 – Lister commandes
 */
exports.listerCommandes = async (req, res) => {
  try {
    const { origin } = req.query;
    let filter = {};

    if (origin === 'marketplace') {
      filter.pointDeVente = { $exists: false };
    } else if (origin === 'point_vente') {
      filter.pointDeVente = { $exists: true };
    }

    const commandes = await Commande.find(filter)
      .populate("pointDeVente")
      .populate("client")
      .populate({
        path: "lignesCommande",
        populate: [
          { path: "produit", options: { withDeleted: true } },
          { path: "lot" }
        ]
      })
      .lean(); // Fetch plain JS objects

    // Bulk fetch all relevant Livraisons and Voyages
    const commandeIds = commandes.map(c => c._id);
    const Livraison = require("../models/Livraison");
    const Voyage = require("../models/Voyage");

    const livraisons = await Livraison.find({ commande: { $in: commandeIds } }).lean();
    
    // Extract unique Voyage IDs
    const voyageIds = [...new Set(livraisons.map(l => l.voyage?.toString()).filter(Boolean))];
    const voyages = await Voyage.find({ _id: { $in: voyageIds } }).select("statut").lean();
    
    const voyageMap = new Map(voyages.map(v => [v._id.toString(), v]));
    
    // Group livraisons by Commande ID for fast local access
    const livraisonsByCommande = {};
    livraisons.forEach(l => {
      const cid = l.commande.toString();
      if (!livraisonsByCommande[cid]) livraisonsByCommande[cid] = [];
      livraisonsByCommande[cid].push(l);
    });

    const commandesAEnregistrer = [];

    // Calculate smart status for each commande locally without DB calls
    const commandesAvecStatut = commandes.map((commande) => {
      const commandeIdStr = commande._id.toString();
      const commandeLivraisons = livraisonsByCommande[commandeIdStr] || [];

      // Bulk calculation logic based on `calculerStatutCommande`
      const quantiteTotaleCommandee = (commande.lignesCommande || []).reduce(
        (sum, ligne) => sum + (ligne.quantite || 0), 0
      );
      const quantiteRestante = (commande.lignesCommande || []).reduce(
        (sum, ligne) => sum + (ligne.quantite_restante || 0), 0
      );
      const quantiteLivree = quantiteTotaleCommandee - quantiteRestante;

      const livraisonsLivrees = commandeLivraisons.filter(l => l.statut === "LIVREE").length;
      const livraisonsEchec = commandeLivraisons.filter(l => l.statut === "ECHEC").length;
      const livraisonsEnCours = commandeLivraisons.filter(l => l.statut === "EN_COURS").length;
      const livraisonsEnAttente = commandeLivraisons.filter(l => l.statut === "EN_ATTENTE").length;
      const livraisonsAnnulees = commandeLivraisons.filter(l => l.statut === "ANNULEE").length;

      const livraisonsActives = commandeLivraisons.filter(l => l.statut !== "ANNULEE");
      const totalActives = livraisonsActives.length;

      let voyageEnCours = false;
      let voyageTermine = false;

      for (const livraison of livraisonsActives) {
        if (livraison.voyage) {
          const voyage = voyageMap.get(livraison.voyage.toString());
          if (voyage) {
            if (voyage.statut === "EN_COURS") voyageEnCours = true;
            else if (voyage.statut === "TERMINE") voyageTermine = true;
          }
        }
      }

      // 🔄 NOUVELLE LOGIQUE: Basée sur le statut des livraisons actives
      const pourcentage = totalActives > 0
        ? Math.round((livraisonsLivrees / totalActives) * 100)
        : 0;

      let nouveauStatut = commande.statut;
      let pourcentageLivraison = null;

      // 🛡️ SÉCURITÉ: Statuts 'finaux' ou 'avancés' ne peuvent pas régresser
      // Règle: le statut ne peut qu'avancer (EN_ATTENTE → PREPAREE → EN_LIVRAISON → LIVREE/ECHEC)
      const STATUTS_PRIORITE = {
        'EN_ATTENTE': 1,
        'PREPAREE': 2,
        'EN_LIVRAISON': 3,
        'LIVREE': 4,
        'ECHEC': 4,
        'CONFIRMEE': 5,
        'ANNULEE': 6
      };
      const prioriteActuelle = STATUTS_PRIORITE[commande.statut] || 0;

      if (commande.statut === 'CONFIRMEE' || commande.statut === 'ANNULEE') {
        commande.statut_calcule = commande.statut;
        commande.quantite_livree = quantiteLivree;
        commande.quantite_totale_commandee = quantiteTotaleCommandee;
        return commande;
      }

      if (totalActives === 0) {
        // Pas de livraisons actives : on conserve le statut actuel
        nouveauStatut = commande.statut;
        pourcentageLivraison = null;
      } else if (voyageEnCours || livraisonsEnCours > 0) {
        // Voyage en cours = livraison en transit
        nouveauStatut = "EN_LIVRAISON";
        if (pourcentage > 0) pourcentageLivraison = pourcentage;
      } else if (livraisonsEnAttente > 0 && livraisonsLivrees === 0 && livraisonsEchec === 0) {
        // Uniquement des livraisons en attente, rien de livré encore
        // On ne rétrograde PAS : si la commande est déjà PREPAREE ou plus, on garde
        if (STATUTS_PRIORITE[commande.statut] <= STATUTS_PRIORITE['EN_ATTENTE']) {
          nouveauStatut = "EN_ATTENTE";
        } else {
          // Garder le statut actuel (PREPAREE, EN_LIVRAISON...)
          nouveauStatut = commande.statut;
        }
        if (pourcentage > 0) pourcentageLivraison = pourcentage;
      } else if (livraisonsEnAttente > 0 && livraisonsLivrees > 0) {
        // Livraisons mixtes (en attente + déjà livrées)
        // Si rien n'est en cours (voyage/chargement), on considère cela comme "Livrée (partiellement)"
        nouveauStatut = "LIVREE";
        pourcentageLivraison = pourcentage;
      } else {
        // Toutes les livraisons actives sont terminées (LIVREE ou ECHEC)
        if (livraisonsLivrees > 0 && livraisonsEchec === 0) {
          nouveauStatut = "LIVREE";
          pourcentageLivraison = 100;
        } else if (livraisonsEchec > 0 && livraisonsLivrees === 0) {
          nouveauStatut = "ECHEC";
          pourcentageLivraison = null;
        } else if (livraisonsLivrees > 0 && livraisonsEchec > 0) {
          nouveauStatut = "LIVREE";
          pourcentageLivraison = pourcentage;
        } else {
          nouveauStatut = commande.statut;
        }
      }

      // ⚠️ GARDE-FOU FINAL: Jamais rétrograder un statut avancé
      if ((STATUTS_PRIORITE[nouveauStatut] || 0) < prioriteActuelle) {
        console.log(`⚠️ Rétrogradation bloquée CMD-${commande.numero_commande}: ${commande.statut} → ${nouveauStatut} (conservé: ${commande.statut})`);
        nouveauStatut = commande.statut;
      }

      // Populate commande object with calculated fields
      commande.statut_calcule = nouveauStatut;
      commande.quantite_livree = quantiteLivree;
      commande.quantite_totale_commandee = quantiteTotaleCommandee;
      if (pourcentageLivraison !== null) {
        commande.pourcentage_livraison = pourcentageLivraison;
      }

      // ⚖️ AJOUT DU POIDS (Puisque .lean() n'inclut pas les virtuals)
      commande.poids_total = (commande.lignesCommande || []).reduce((sum, ligne) => {
        const p = ligne.produit;
        const poids = (p && p.poids_unitaire) ? p.poids_unitaire : 0;
        return sum + (poids * (ligne.quantite || 0));
      }, 0);

      commande.poids_restant = (commande.lignesCommande || []).reduce((sum, ligne) => {
        const p = ligne.produit;
        const poids = (p && p.poids_unitaire) ? p.poids_unitaire : 0;
        return sum + (poids * (ligne.quantite_restante || 0));
      }, 0);

      // Check if status changed and needs DB update
      if (nouveauStatut !== commande.statut || (pourcentageLivraison !== null && pourcentageLivraison !== commande.pourcentage_livraison)) {
        console.log(`🔄 Mise à jour automatique (Bulk) CMD-${commande.numero_commande}: ${commande.statut} (${commande.pourcentage_livraison || 0}%) → ${nouveauStatut} (${pourcentageLivraison || 0}%)`);
        
        const updateFields = { statut: nouveauStatut };
        if (pourcentageLivraison !== null) {
          updateFields.pourcentage_livraison = pourcentageLivraison;
        }
        
        commandesAEnregistrer.push({
          updateOne: {
            filter: { _id: commande._id },
            update: { $set: updateFields }
          }
        });
        
        // Update the JS object so frontend sees it immediately
        commande.statut = nouveauStatut;
      }

      return commande;
    });

    // Execute bulk updates in background if needed
    if (commandesAEnregistrer.length > 0) {
      Commande.bulkWrite(commandesAEnregistrer).catch(e => 
        console.error("Erreur bulkWrite statuts commandes:", e)
      );
    }

    res.json(commandesAvecStatut);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Calculer le statut intelligent d'une commande basé sur les livraisons
 */
const calculerStatutCommande = async (commandeId) => {
  try {
    const Livraison = require("../models/Livraison");
    const Voyage = require("../models/Voyage");
    
    // Récupérer la commande avec ses lignes
    const commande = await Commande.findById(commandeId).populate("lignesCommande");
    if (!commande) return null;

    // Récupérer TOUTES les livraisons de cette commande (y compris annulées pour le calcul du pourcentage)
    const livraisons = await Livraison.find({ 
      commande: commandeId
    });

    // Calculer les quantités totales
    const quantiteTotaleCommandee = commande.lignesCommande.reduce(
      (sum, ligne) => sum + ligne.quantite, 0
    );
    
    const quantiteRestante = commande.lignesCommande.reduce(
      (sum, ligne) => sum + (ligne.quantite_restante || 0), 0
    );

    const quantiteLivree = quantiteTotaleCommandee - quantiteRestante;

    // Analyser les statuts des livraisons
    const livraisonsLivrees = livraisons.filter(l => l.statut === "LIVREE").length;
    const livraisonsEchec = livraisons.filter(l => l.statut === "ECHEC").length;
    const livraisonsEnCours = livraisons.filter(l => l.statut === "EN_COURS").length;
    const livraisonsEnAttente = livraisons.filter(l => l.statut === "EN_ATTENTE").length;
    const livraisonsAnnulees = livraisons.filter(l => l.statut === "ANNULEE").length;

    const livraisonsActives = livraisons.filter(l => l.statut !== "ANNULEE");
    const totalActives = livraisonsActives.length;

    // 🚀 NOUVELLE LOGIQUE BASÉE SUR LES VOYAGES (OPTIMISÉE)
    let voyageEnCours = false;
    let voyageTermine = false;
    
    const voyageIds = [...new Set(livraisonsActives.map(l => l.voyage?.toString()).filter(Boolean))];
    if (voyageIds.length > 0) {
      const voyages = await Voyage.find({ _id: { $in: voyageIds } });
      const voyageMap = new Map(voyages.map(v => [v._id.toString(), v]));
      
      for (const livraison of livraisonsActives) {
        if (livraison.voyage) {
          const voyage = voyageMap.get(livraison.voyage.toString());
          if (voyage) {
            if (voyage.statut === "EN_COURS") {
              voyageEnCours = true;
            } else if (voyage.statut === "TERMINE") {
              voyageTermine = true;
            }
          }
        }
      }
    }

    // 🔄 NOUVELLE LOGIQUE: Basée sur le statut des livraisons actives
    const pourcentage = totalActives > 0
      ? Math.round((livraisonsLivrees / totalActives) * 100)
      : 0;

    let nouveauStatut = commande.statut;
    let pourcentageLivraison = null;

    // 🛡️ SÉCURITÉ: Statuts finaux/avancés ne peuvent jamais régresser
    const STATUTS_PRIORITE = {
      'EN_ATTENTE': 1, 'PREPAREE': 2, 'EN_LIVRAISON': 3,
      'LIVREE': 4, 'ECHEC': 4, 'CONFIRMEE': 5, 'ANNULEE': 6
    };
    const prioriteActuelle = STATUTS_PRIORITE[commande.statut] || 0;

    if (commande.statut === 'CONFIRMEE' || commande.statut === 'ANNULEE') {
      return {
        statut: commande.statut,
        pourcentageLivraison: (commande.statut === 'CONFIRMEE' ? 100 : null),
        quantiteLivree,
        quantiteTotaleCommandee,
        quantiteRestante
      };
    }

    if (totalActives === 0) {
      nouveauStatut = commande.statut; 
      pourcentageLivraison = null;
    } else if (voyageEnCours || livraisonsEnCours > 0) {
      nouveauStatut = "EN_LIVRAISON";
      if (pourcentage > 0) pourcentageLivraison = pourcentage;
    } else if (livraisonsEnAttente > 0 && livraisonsLivrees === 0 && livraisonsEchec === 0) {
      // Uniquement des livraisons en attente, rien de livré encore
      // On ne rétrograde PAS si la commande est déjà PREPAREE ou plus
      if (STATUTS_PRIORITE[commande.statut] <= STATUTS_PRIORITE['EN_ATTENTE']) {
        nouveauStatut = "EN_ATTENTE";
      } else {
        nouveauStatut = commande.statut; // Garder PREPAREE, etc.
      }
      if (pourcentage > 0) pourcentageLivraison = pourcentage;
    } else if (livraisonsEnAttente > 0 && livraisonsLivrees > 0) {
      // Livraisons mixtes = déjà une partie livrée, le reste attend
      nouveauStatut = "LIVREE";
      pourcentageLivraison = pourcentage;
    } else {
      // Toutes les livraisons actives sont terminées (LIVREE ou ECHEC)
      if (livraisonsLivrees > 0 && livraisonsEchec === 0) {
        nouveauStatut = "LIVREE";
        pourcentageLivraison = 100;
      } else if (livraisonsEchec > 0 && livraisonsLivrees === 0) {
        nouveauStatut = "ECHEC";
        pourcentageLivraison = null;
      } else if (livraisonsLivrees > 0 && livraisonsEchec > 0) {
        nouveauStatut = "LIVREE";
        pourcentageLivraison = pourcentage;
      } else {
        nouveauStatut = commande.statut;
      }
    }

    // ⚠️ GARDE-FOU FINAL: Jamais rétrograder un statut avancé
    if ((STATUTS_PRIORITE[nouveauStatut] || 0) < prioriteActuelle) {
      nouveauStatut = commande.statut;
    }

    return {
      statut: nouveauStatut,
      pourcentageLivraison,
      quantiteLivree,
      quantiteTotaleCommandee,
      quantiteRestante
    };

  } catch (error) {
    console.error("❌ Erreur calcul statut commande:", error);
    return null;
  }
};

/**
 * UC6 – Récupérer commande par ID
 */
exports.getById = async (req, res) => {
  try {
    const { commandeId } = req.params;
    const commande = await Commande.findById(commandeId)
      .populate("pointDeVente")
      .populate({
        path: "lignesCommande",
        populate: [
          { path: "produit", options: { withDeleted: true } },
          { path: "lot" }
        ]
      });

    if (!commande) return res.status(404).json({ message: "Commande non trouvée" });

    // Calculer le statut intelligent et le pourcentage
    const statutInfo = await calculerStatutCommande(commandeId);
    if (statutInfo) {
      commande.statut_calcule = statutInfo.statut;
      commande.pourcentage_livraison = statutInfo.pourcentageLivraison;
      commande.quantite_livree = statutInfo.quantiteLivree;
      commande.quantite_totale_commandee = statutInfo.quantiteTotaleCommandee;
      
      // 🔄 MISE À JOUR AUTOMATIQUE: Si le statut calculé est différent du statut actuel, mettre à jour la base de données
      if (statutInfo.statut !== commande.statut) {
        commande.statut = statutInfo.statut;
        if (statutInfo.pourcentageLivraison) {
          commande.pourcentage_livraison = statutInfo.pourcentageLivraison;
        }
        await commande.save();
      }
    }

    res.status(200).json(commande);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Recalculer les statuts de toutes les commandes
 */
exports.recalculerStatuts = async (req, res) => {
  try {
    const commandes = await Commande.find();
    let commandesMisesAJour = 0;
    const resultats = [];

    for (const commande of commandes) {
      const statutInfo = await calculerStatutCommande(commande._id);
      
      if (statutInfo) {
        const ancienStatut = commande.statut;
        const changementNecessaire = commande.statut !== statutInfo.statut;
        
        if (changementNecessaire) {
          commande.statut = statutInfo.statut;
          
          if (statutInfo.pourcentageLivraison !== null) {
            commande.pourcentage_livraison = statutInfo.pourcentageLivraison;
          }
          
          await commande.save();
          commandesMisesAJour++;
        }
        
        resultats.push({
          id: commande.id_formate || commande._id,
          ancienStatut,
          nouveauStatut: statutInfo.statut,
          pourcentage: statutInfo.pourcentageLivraison,
          modifie: changementNecessaire
        });
      }
    }

    res.json({
      message: `Recalcul terminé avec succès`,
      totalCommandes: commandes.length,
      commandesMisesAJour,
      resultats
    });

  } catch (err) {
    console.error('❌ Erreur recalcul statuts:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// Exporter la fonction utilitaire
exports.calculerStatutCommande = calculerStatutCommande;

/**
 * Récupérer les commandes de l'utilisateur connecté
 */
exports.getMesCommandes = async (req, res) => {
  try {
    const clientId = req.user.id;
    const userType = req.user.userType || req.user.role;
    
    let filter = {};
    if (userType === 'client') {
      filter = { client: clientId };
    } else if (userType === 'pdv') {
      filter = { pointDeVente: clientId };
    } else {
      filter = { $or: [{ client: clientId }, { pointDeVente: clientId }] };
    }

    const commandes = await Commande.find(filter)
      .populate({
        path: "lignesCommande",
        populate: [
          { path: "produit" },
          { path: "lot" }
        ]
      })
      .sort({ date_commande: -1 })
      .limit(10);

    const enriched = commandes.map(c => {
      const obj = c.toJSON();
      if (!obj.total || obj.total === 0) {
        obj.total = obj.lignesCommande.reduce(
          (sum, l) => sum + ((l.prix_unitaire || 0) * (l.quantite || 0)), 0
        );
      }
      return obj;
    });

    res.json(enriched);
  } catch (err) {
    console.error("❌ Erreur getMesCommandes:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Confirmer la réception d'une commande (par le client)
 */
exports.confirmerReception = async (req, res) => {
  try {
    const { id } = req.params;
    const commande = await Commande.findById(id);

    if (!commande) {
      return res.status(404).json({ message: "Commande introuvable" });
    }

    // Sécurité: vérifier que c'est bien le client ou le PDV de la commande
    const isOwner = (commande.client && commande.client.toString() === req.user.id.toString()) ||
                    (commande.pointDeVente && commande.pointDeVente.toString() === req.user.id.toString());
    if (!isOwner) {
      return res.status(403).json({ message: "Action non autorisée" });
    }

    if (commande.statut !== 'LIVREE') {
      return res.status(400).json({ message: "Vous ne pouvez confirmer que les commandes déjà livrées" });
    }

    commande.statut = 'CONFIRMEE';
    commande.date_confirmation = new Date();
    await commande.save();

    // 📧 Log History (pas d'email pour CONFIRMEE en général, mais on garde la trace)
    orderEmitter.emit('order_status_changed', { 
      commandeId: commande._id, 
      oldStatus: 'LIVREE', 
      newStatus: 'CONFIRMEE', 
      source: 'CLIENT' 
    });

    res.json({ 
      message: "Réception confirmée avec succès. Vous pouvez maintenant laisser un avis !", 
      status: 'CONFIRMEE' 
    });

  } catch (err) {
    console.error("Erreur confirmation réception:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
