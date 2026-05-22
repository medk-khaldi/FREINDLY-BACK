const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Utilisateur",
    required: true,
    index: true
  },
  
  type: {
    type: String,
    enum: [
      // Chauffeur notifications (existing)
      "NEW_DELIVERY", "ADDRESS_CHANGE", "DELIVERY_CANCELLED", "VOYAGE_ASSIGNED", "VOYAGE_CANCELLED",
      // Responsable & Admin notifications: chauffeur movements
      "VOYAGE_STARTED", "VOYAGE_FINISHED", "LIVRAISON_LIVREE", "LIVRAISON_ECHEC", "PRODUIT_ECHEC", "LIVRAISON_REMBOURSEMENT",
      // Admin notifications: responsable actions
      "RETOUR_CREE", "STOCK_AJOUTE", "LIVRAISON_CREEE", "REMISE_STOCK", "STOCK_DEPASSE_SEUIL",
      // Marketplace client orders
      "NEW_COMMANDE_CLIENT",
      // User registrations
      "NEW_USER_REGISTRATION",
      // Messaging
      "NEW_MESSAGE"
    ],
    required: true
  },
  
  title: {
    type: String,
    required: true
  },
  
  message: {
    type: String,
    required: true
  },
  
  data: {
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Livraison"
    },
    commandeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Commande"
    },
    voyageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voyage"
    },
    conversationId: {
      type: String
    },
    pointDeVente: String,
    oldAddress: String,
    newAddress: String,
    produitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Produit"
    },
    responsableName: String,
    amount: String
  },
  
  read: {
    type: Boolean,
    default: false
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Index composé pour optimiser les requêtes
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, read: 1 });

module.exports = mongoose.model("Notification", NotificationSchema);