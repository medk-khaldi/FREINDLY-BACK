// models/Livraison.js
const mongoose = require("mongoose");
const { formatLivraisonId } = require('../utils/formatSequentialId');

const LivraisonSchema = new mongoose.Schema({
  numero_livraison: { 
    type: Number,
    required: false  // Rendu optionnel car généré automatiquement
  },
  commande: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Commande",
    required: true
  },
  poids_total: {
    type: Number,
    default: 0
  },

  // Chaque ligne de livraison est liée à un produit (format_id optionnel pour compatibilité)
  lignesLivraison: [
    {
      produit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Produit",
        required: true
      },
      format_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: false  // Rendu optionnel pour compatibilité avec les lots
      },
      quantite: {
        type: Number,
        required: true,
        min: 1
      },
      lot: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Lot",
        required: false  // Optionnel pour les produits sans lot
      },
      quantite_lots: {
        type: Number,
        required: false  // Quantité en lots (si applicable)
      },
      // 🚀 NOUVEAU: Quantité retournée pour cette ligne de livraison
      quantite_retournee: {
        type: Number,
        default: 0  // Quantité déjà retournée pour cette ligne spécifique
      },
      // 🚀 NOUVEAU: Statut spécifique du produit dans cette livraison
      statut_produit: {
        type: String,
        enum: ["EN_ATTENTE", "LIVRE", "ECHEC"],
        default: "EN_ATTENTE"
      },
      // 🚀 NOUVEAU: Raison d'échec spécifique au produit
      raison_echec: {
        type: String,
        required: false
      },
      // 🚀 NOUVEAU: Date d'échec du produit
      date_echec: {
        type: Date,
        required: false
      }
    }
  ],

  statut: {
    type: String,
    enum: ["EN_ATTENTE", "EN_COURS", "LIVREE", "PARTIELLE", "ANNULEE", "ECHEC"],
    default: "EN_ATTENTE"
  },

  // Champs de paiement
  montant_total: { type: Number, default: 0 },
  montant_paye: { type: Number, default: 0 },
  statut_paiement: { 
    type: String, 
    enum: ["NON_PAYEE", "PARTIELLEMENT_PAYEE", "PAYEE"], 
    default: "NON_PAYEE" 
  },
  paiements: [
    {
      methode: { 
        type: String, 
        enum: ["ESPECES", "CHEQUE", "VIREMENT", "AUTRE", "CARTE", "CARTE_STRIPE"],
        required: true
      },
      montant: { type: Number, required: true },
      date: { type: Date, default: Date.now }
    }
  ],

  // Raison en cas d'échec de livraison
  raison_echec: {
    type: String,
    required: function() {
      return this.statut === "ECHEC";
    }
  },

  date_creation: {
    type: Date,
    default: Date.now
  },

  date_livraison: Date,

  voyage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Voyage",
    index: true  // index pour accélérer les requêtes par voyage
  },

  stock_libere: {
    type: Boolean,
    default: false  // Indique si le stock de cette livraison annulée a été libéré
  },

  // ✅ NOUVEAU: Origine de l'annulation
  annulation_origine: {
    type: String,
    enum: ["COMMANDE", "MANUELLE"],
    required: false  // Seulement pour les livraisons annulées
  },

  destockage_effectue: {
    type: Boolean,
    default: false  // Indique si le déstockage a été effectué pour cette livraison LIVREE
  },

  facture: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Facture",
    required: false  // Optionnel car la facture peut être générée après la livraison
  },

  // 🚚 Camion suggéré/réservé lors de la création
  camion_assigne: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Camion",
    required: false
  }
});

// Hook pre-save pour générer le numéro automatiquement (async sans next)
LivraisonSchema.pre('save', async function() {
  if (this.isNew && !this.numero_livraison) {
    try {
      // Compter les livraisons existantes pour cette commande
      const count = await this.constructor.countDocuments({ 
        commande: this.commande 
      });
      this.numero_livraison = count + 1;
      console.log(`📦 Numéro de livraison généré: ${this.numero_livraison} pour commande ${this.commande}`);
    } catch (error) {
      console.error('❌ Erreur génération numero_livraison:', error);
      // Fallback: utiliser un numéro par défaut
      this.numero_livraison = 1;
    }
  }
});

// Méthode pour obtenir l'ID formaté lié à la commande (gère automatiquement les nombres > 9999)
LivraisonSchema.methods.getIdFormate = async function() {
  const Commande = mongoose.model('Commande');
  const commande = await Commande.findById(this.commande);
  if (!commande || !commande.numero_commande) return `LIV-${this.numero_livraison}`;
  
  return formatLivraisonId(commande.numero_commande, this.numero_livraison);
};

// S'assurer que les virtuels sont inclus dans JSON
LivraisonSchema.set('toJSON', { virtuals: true });
LivraisonSchema.set('toObject', { virtuals: true });

// 🚀 NOUVEAU: Hooks pour mettre à jour les statistiques du Point de Vente
LivraisonSchema.post('save', async function(doc) {
  try {
    const Commande = mongoose.model('Commande');
    const cmd = await Commande.findById(doc.commande);
    if (cmd && cmd.pointDeVente) {
      const { updatePDVStats } = require('../utils/statsHelper');
      updatePDVStats(cmd.pointDeVente); // On ne bloque pas la réponse
    }
  } catch (error) {
    console.error('❌ Hook save Livraison error:', error);
  }
});

LivraisonSchema.post('findOneAndUpdate', async function(doc) {
  if (doc) {
    try {
      const Commande = mongoose.model('Commande');
      const cmd = await Commande.findById(doc.commande);
      if (cmd && cmd.pointDeVente) {
        const { updatePDVStats } = require('../utils/statsHelper');
        updatePDVStats(cmd.pointDeVente);
      }
    } catch (error) {
      console.error('❌ Hook update Livraison error:', error);
    }
  }
});

module.exports = mongoose.model("Livraison", LivraisonSchema);
