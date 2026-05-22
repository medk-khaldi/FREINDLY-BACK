const mongoose = require('mongoose');
const Counter = require('./Counter');
const { formatSequentialId } = require('../utils/formatSequentialId');
const softDeletePlugin = require('../utils/softDeletePlugin');

const produitSchema = new mongoose.Schema({
  numero_produit: { 
    type: Number, 
    unique: true 
  },
  nom: { type: String, required: true },
  code: { 
    type: String
    // unique: true et sparse supprimés pour utiliser un index partiel
  },
  code_barre: {
    type: String,
    // unique: true et sparse supprimés pour utiliser un index partiel
    trim: true
  },
  prix_reference: { type: Number, required: true },
  seuil_minimum: { type: Number, default: 0 },
  categorie: { type: mongoose.Schema.Types.ObjectId, ref: 'CategorieProduit' },
  unite: { type: mongoose.Schema.Types.ObjectId, ref: 'Unite' },
  marque: { type: mongoose.Schema.Types.ObjectId, ref: 'MarqueProduit' },
  format: { type: mongoose.Schema.Types.ObjectId, ref: 'Format' }, // Format d'emballage (ex: 0.3L, 1.5L, 2L, etc.)
  poids_unitaire: { type: Number, required: true, default: 0 }, // Poids en kg
  poids_estime: { type: Boolean, default: true }, // Indique si le poids a été calculé automatiquement
  lots: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lot' }], // Changé pour supporter plusieurs lots
  promotionActive: { type: mongoose.Schema.Types.ObjectId, ref: 'Promotion', default: null }, // 🆕 Promo liée
  visibleMarketplace: { type: Boolean, default: true }, // 🆕 Visibilité sur le marketplace client
  image: { type: String, default: null } // Chemin de l'image du produit
}, { timestamps: true });

// --- Index Personnalisés (Partial Indexes) ---
// Ces index permettent de réutiliser un code ou code-barres si le produit précédent a été supprimé (isDeleted: true)
// Note: On ne peut pas mixer 'sparse' et 'partialFilterExpression', donc on utilise le filtre pour simuler le sparse
produitSchema.index({ code: 1 }, { 
  unique: true, 
  partialFilterExpression: { isDeleted: false, code: { $type: "string" } } 
});

produitSchema.index({ code_barre: 1 }, { 
  unique: true, 
  partialFilterExpression: { isDeleted: false, code_barre: { $type: "string" } } 
});

// Applique le plugin de soft delete
produitSchema.plugin(softDeletePlugin);

// Hook pre-save pour générer le numéro automatiquement (async sans next)
produitSchema.pre('save', async function() {
  if (this.isNew && !this.numero_produit) {
    this.numero_produit = await Counter.getNextSequence('produit');
  }
});

// Méthode virtuelle pour obtenir l'ID formaté (gère automatiquement les nombres > 9999)
produitSchema.virtual('id_formate').get(function() {
  if (!this.numero_produit) return 'N/A';
  return formatSequentialId('PRD', this.numero_produit);
});

// S'assurer que les virtuels sont inclus dans JSON
produitSchema.set('toJSON', { virtuals: true });
produitSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Produit', produitSchema);
