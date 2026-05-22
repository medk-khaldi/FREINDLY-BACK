const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Commande = require("../models/Commande");
const LigneCommande = require("../models/LigneCommande");
const Produit = require("../models/Produit");
const PointDeVente = require("../models/PointDeVente");
const Client = require("../models/Client");
const StockConsolide = require("../models/StockConsolide");
const Lot = require("../models/Lot");
const CodePromo = require("../models/CodePromo");
const GlobalConfig = require("../models/GlobalConfig");
const Utilisateur = require("../models/Utilisateur");
const { calculateOrderTotal, calculateProductPrice } = require("../utils/financeUtils");
const { notifyNewCommandeClient } = require("./notification.controller");
const orderEmitter = require("../services/orderEvents");

// Implicit TND to EUR conversion rate (1 TND = 0.30 EUR)
const TND_TO_EUR_RATE = 0.30;

/**
 * Calculer le total de la commande côté serveur de manière sécurisée
 */
async function calculateSecureTotal(items, codePromo, pointsUtilises, fraisLivraison, clientId, userType) {
  let serverSousTotal = 0;
  const lignesTemp = [];

  for (const item of items) {
    const productId = item.produit || item._id;
    const produit = await Produit.findById(productId).populate('promotionActive');
    if (!produit) throw new Error(`Produit introuvable.`);

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

    lignesTemp.push({ produit, totalUnits, prixUnitaire, lot: selectedLot, quantiteLots });
  }

  // Validation du code promo
  let appliedPromo = null;
  if (codePromo && codePromo.code) {
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
      }
    }
  }

  // Fidélité reduction calculation (without consuming points)
  let fideliteReduction = 0;
  if (pointsUtilises && pointsUtilises > 0 && clientId && userType === 'client') {
    const client = await Client.findById(clientId);
    if (client) {
      const availablePoints = client.pointsFidelite || 0;
      const pointsToUse = Math.min(pointsUtilises, availablePoints);
      // conversion rate e.g. 10 points = 1 TND
      fideliteReduction = pointsToUse * 0.1; 
    }
  }

  // ✅ Utiliser serverSousTotal directement pour éviter la perte de précision flottante
  //    (ex. 3000 * 1.833333 = 5499.999 au lieu de 5500)
  const fraisServer = fraisLivraison !== undefined ? fraisLivraison : (serverSousTotal >= 100 ? 0 : 8);
  const fraisFinal = serverSousTotal >= 100 ? 0 : fraisServer;
  const remisePromoAmt = appliedPromo?.reduction || 0;
  const totalFinal = Math.max(0, serverSousTotal + fraisFinal - remisePromoAmt - fideliteReduction);

  const resultFinance = {
    sousTotal: Number(serverSousTotal.toFixed(3)),
    fraisLivraison: Number(fraisFinal.toFixed(3)),
    remisePromo: Number(remisePromoAmt.toFixed(3)),
    total: Number(totalFinal.toFixed(3))
  };

  return {
    totalTnd: resultFinance.total,
    sousTotalTnd: resultFinance.sousTotal,
    fraisLivraisonTnd: resultFinance.fraisLivraison,
    appliedPromo,
    fideliteReduction,
    lignesTemp
  };
}

/**
 * Créer un PaymentIntent Stripe
 */
exports.createPaymentIntent = async (req, res) => {
  try {
    const { items, codePromo, pointsUtilises, fraisLivraison } = req.body;
    const clientId = req.user?.id;
    const userType = req.user?.userType;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Le panier est vide." });
    }

    // 🔹 1. Vérifier la disponibilité des stocks
    for (const item of items) {
      const productId = item.produit || item._id;
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
      
      if (!lotDetermined && item.lot && typeof item.lot === 'string' && item.lot !== 'null' && item.lot !== 'undefined' && item.lot !== '') {
        lotId = item.lot;
      }

      const selectedLot = lotId ? await Lot.findById(lotId) : null;
      const quantiteLots = item.quantite || item.quantity || 1;
      const lotMultiplier = selectedLot?.quantite_unitaire || 1;
      const totalUnits = quantiteLots * lotMultiplier;

      const stockConsolide = await StockConsolide.findOne({ produit: productId });
      if (!stockConsolide || stockConsolide.quantite_disponible < totalUnits) {
        return res.status(400).json({ message: `Stock insuffisant pour ${item.nom || 'certains produits'}` });
      }
    }

    // 🔹 2. Calculer le montant final en TND
    const secureCalculations = await calculateSecureTotal(
      items,
      codePromo,
      pointsUtilises,
      fraisLivraison,
      clientId,
      userType
    );

    // 🔹 3. Minimum order validation
    const minOrderConfig = await GlobalConfig.findOne({ key: 'MIN_ORDER_AMOUNT' });
    const MIN_AMOUNT = minOrderConfig ? Number(minOrderConfig.value) : 100;
    if (secureCalculations.totalTnd < MIN_AMOUNT) {
      return res.status(400).json({
        message: `Le montant minimum pour passer une commande est de ${MIN_AMOUNT.toFixed(3).replace('.', ',')} DT.`
      });
    }

    // 🔹 4. Convertir en EUR
    const totalEur = secureCalculations.totalTnd * TND_TO_EUR_RATE;
    const amountInCents = Math.round(totalEur * 100);

    // 🔹 5. Créer le PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {
        clientId: clientId || 'guest',
        userType: userType || 'guest',
        totalTnd: secureCalculations.totalTnd.toString(),
        totalEur: totalEur.toFixed(2)
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      totalTnd: secureCalculations.totalTnd,
      totalEur: totalEur
    });
  } catch (err) {
    console.error("❌ Erreur createPaymentIntent:", err);
    res.status(500).json({ message: "Erreur serveur lors de l'initiation du paiement", error: err.message });
  }
};

/**
 * Confirmer le paiement et créer la commande finale
 */
exports.confirmPayment = async (req, res) => {
  let reservations = [];
  try {
    const { paymentIntentId, items, adresse_livraison, codePromo, pointsUtilises, note_client, fraisLivraison } = req.body;
    const clientId = req.user?.id;
    const userType = req.user?.userType;

    if (!paymentIntentId) {
      return res.status(400).json({ message: "ID de transaction Stripe manquant." });
    }

    // 🔹 1. Vérifier le PaymentIntent auprès de Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ message: `Le paiement n'a pas été validé. Statut actuel: ${paymentIntent.status}` });
    }

    // 🔹 2. Calculer le total côté serveur de manière sécurisée
    const secureCalculations = await calculateSecureTotal(
      items,
      codePromo,
      pointsUtilises,
      fraisLivraison,
      clientId,
      userType
    );

    // 🔹 3. Réserver le stock et créer les lignes finales
    const lignesCommandeIds = [];
    for (const l of secureCalculations.lignesTemp) {
      const { produit, totalUnits, prixUnitaire } = l;

      const stockConsolide = await StockConsolide.findOne({ produit: produit._id });
      if (!stockConsolide || stockConsolide.quantite_disponible < totalUnits) {
        // Rollback reservations
        for (const resv of reservations) {
          const sc = await StockConsolide.findById(resv.stockConsolideId);
          if (sc) await sc.libererStockReserve(resv.quantite);
        }
        return res.status(400).json({ message: `Stock insuffisant pour ${produit.nom}` });
      }

      await stockConsolide.reserverStock(totalUnits);
      reservations.push({ stockConsolideId: stockConsolide._id, quantite: totalUnits });

      const ligneCommande = new LigneCommande({
        produit: produit._id,
        quantite: totalUnits,
        quantite_restante: totalUnits,
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

    // 🔹 4. Consommer le code promo en base de données
    let appliedPromo = null;
    if (codePromo && codePromo.code) {
      const promo = await CodePromo.findOne({ code: codePromo.code.toUpperCase(), actif: true });
      if (promo && secureCalculations.appliedPromo) {
        promo.utilisationsActuelles += 1;
        if (clientId) promo.clientsUtilises.push(clientId);
        await promo.save();
        appliedPromo = secureCalculations.appliedPromo;
      }
    }

    // 🔹 5. Déduire les points de fidélité
    let fideliteReduction = 0;
    let pointsToSpend = 0;
    if (pointsUtilises && pointsUtilises > 0 && clientId && userType === 'client') {
      const { spendPoints } = require('../services/pointsService');
      const result = await spendPoints(
        clientId,
        pointsUtilises,
        `Paiement par carte - Commande`
      );
      if (result.success) {
        fideliteReduction = result.reduction;
        pointsToSpend = pointsUtilises;
      }
    }

    // 🔹 6. Créer la commande finale
    const commande = new Commande({
      client: userType === 'client' ? clientId : null,
      pointDeVente: userType === 'pdv' ? clientId : null,
      lignesCommande: lignesCommandeIds,
      statut: "EN_ATTENTE",
      total: secureCalculations.totalTnd,
      sousTotal: secureCalculations.sousTotalTnd,
      fraisLivraison: secureCalculations.fraisLivraisonTnd,
      codePromo: appliedPromo,
      note_client,
      planification: req.body.planification,
      mode_paiement: 'CARTE',
      stripePaymentIntentId: paymentIntentId,
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
        prenom: adresse_livraison.firstName
      }
    });
    await commande.save();

    // 🔹 7. Mettre à jour les informations du client (nom, tél, adresses)
    if (clientId) {
      let userModel;
      if (userType === 'client') {
        userModel = await Client.findById(clientId);
      } else {
        userModel = await Utilisateur.findById(clientId);
      }

      if (userModel) {
        if (adresse_livraison.phone) userModel.telephone = adresse_livraison.phone;
        if (adresse_livraison.lastName) userModel.nom = adresse_livraison.lastName;
        if (adresse_livraison.firstName) userModel.prenom = adresse_livraison.firstName;

        if (userType === 'client') {
          const addressExists = userModel.adresses.some(a =>
            a.gouvernorat === adresse_livraison.governorate &&
            a.delegation === adresse_livraison.delegation &&
            a.localite === adresse_livraison.locality &&
            a.rue === adresse_livraison.street
          );

          if (!addressExists) {
            userModel.adresses.push({
              label: userModel.adresses.length === 0 ? 'Maison' : `Adresse ${userModel.adresses.length + 1}`,
              gouvernorat: adresse_livraison.governorate,
              delegation: adresse_livraison.delegation,
              localite: adresse_livraison.locality,
              rue: adresse_livraison.street,
              codePostal: adresse_livraison.zip,
              isDefault: userModel.adresses.length === 0
            });
          }

          userModel.panier = [];
          await userModel.incrementOrders();
        } else {
          await userModel.save();
        }
      }
    }

    // 🔹 8. Déclencher les événements/notifications
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

    try {
      await notifyNewCommandeClient(commande, clientForNotif);
    } catch (notifErr) {
      console.error("⚠️ Erreur lors de l'envoi des notifications:", notifErr);
    }

    res.json({
      success: true,
      message: "Commande créée avec succès après validation du paiement.",
      commandeId: commande._id
    });

  } catch (err) {
    console.error("❌ Erreur confirmPayment:", err);
    // Rollback stock reservations
    for (const resv of reservations) {
      try {
        const sc = await StockConsolide.findById(resv.stockConsolideId);
        if (sc) await sc.libererStockReserve(resv.quantite);
      } catch (rollErr) {
        console.error("❌ Erreur rollback reservation:", rollErr);
      }
    }
    res.status(500).json({ message: "Erreur lors de la confirmation du paiement", error: err.message });
  }
};
