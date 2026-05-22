// models/Stock.js
const mongoose = require("mongoose");
const Counter = require('./Counter');
const { formatSequentialId } = require('../utils/formatSequentialId');

const stockSchema = new mongoose.Schema(
  {
    numero_stock: { 
      type: Number, 
      unique: true 
    },
    produit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Produit",
      required: true
    },
    entrepot: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entrepot",
      required: true
    },
    quantite: {
      type: Number,
      required: true,
      min: 0
    },
    quantite_reservee: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

// Hook pre-save pour générer le numéro automatiquement (async sans next)
stockSchema.pre('save', async function() {
  if (this.isNew && !this.numero_stock) {
    this.numero_stock = await Counter.getNextSequence('stock');
  }
});

// Méthode virtuelle pour obtenir l'ID formaté (gère automatiquement les nombres > 9999)
stockSchema.virtual('id_formate').get(function() {
  if (!this.numero_stock) return 'N/A';
  return formatSequentialId('STK', this.numero_stock);
});

// S'assurer que les virtuels sont inclus dans JSON
stockSchema.set('toJSON', { virtuals: true });
stockSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("Stock", stockSchema);
