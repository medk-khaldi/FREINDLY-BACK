const EventEmitter = require('events');
const emailService = require('./emailService');
const OrderStatusHistory = require('../models/OrderStatusHistory');
const Commande = require('../models/Commande');
const Client = require('../models/Client');

class OrderEmitter extends EventEmitter {}
const orderEmitter = new OrderEmitter();

/**
 * Event: order_placed
 * Triggered when a new order is successfully created
 */
orderEmitter.on('order_placed', async ({ commande, client }) => {
  console.log(`🔔 Event received: order_placed for CMD-${commande._id}`);
  
  try {
    // 1. Record in history
    await OrderStatusHistory.create({
      commande: commande._id,
      nouveauStatut: 'EN_ATTENTE',
      source: 'CLIENT',
      commentaire: 'Commande passée par le client'
    });

    // 2. Send email
    const emailSent = await emailService.sendOrderConfirmation(commande, client);
    
    // 3. Update history if email sent
    if (emailSent) {
      await OrderStatusHistory.findOneAndUpdate(
        { commande: commande._id, nouveauStatut: 'EN_ATTENTE' },
        { customerNotified: true }
      );
    }
  } catch (error) {
    console.error('❌ Error in order_placed event handler:', error);
  }
});

/**
 * Event: order_status_changed
 * Triggered when an order status is updated
 */
orderEmitter.on('order_status_changed', async ({ commandeId, oldStatus, newStatus, source, commentaire }) => {
  console.log(`🔔 Event received: order_status_changed for CMD-${commandeId} (${oldStatus} -> ${newStatus})`);
  
  try {
    // 1. Fetch full data
    const commande = await Commande.findById(commandeId).populate({
      path: 'lignesCommande',
      populate: { path: 'produit' }
    });
    
    if (!commande) return;

    // Try Client first, then PointDeVente for PDV orders
    let client = await Client.findById(commande.client);
    if (!client && commande.pointDeVente) {
      const PointDeVente = require('../models/PointDeVente');
      const pdv = await PointDeVente.findById(commande.pointDeVente);
      if (pdv) {
        client = {
          _id: pdv._id,
          nom: pdv.responsable_nom || pdv.nom,
          prenom: '',
          email: pdv.email
        };
      }
    }
    if (!client) return;

    // 2. Record in history
    const history = await OrderStatusHistory.create({
      commande: commandeId,
      ancienStatut: oldStatus,
      nouveauStatut: newStatus,
      source: source || 'SYSTEME',
      commentaire: commentaire || `Passage de ${oldStatus} à ${newStatus}`
    });

    // 3. Send email for important transitions
    const importantStatuses = ['PREPAREE', 'EN_LIVRAISON', 'LIVREE', 'ANNULEE'];
    if (importantStatuses.includes(newStatus)) {
      const emailSent = await emailService.sendStatusUpdate(commande, client, oldStatus, newStatus);
      
      if (emailSent) {
        history.customerNotified = true;
        await history.save();
      }
    }
  } catch (error) {
    console.error('❌ Error in order_status_changed event handler:', error);
  }
});

module.exports = orderEmitter;
