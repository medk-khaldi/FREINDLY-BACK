const mongoose = require('mongoose');
const Counter = require('./Counter');

const retourSchema = new mongoose.Schema({
  numero_retour: { 
    type: Number, 
    unique: true 
  },
  ligneCommande: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'LigneCommande', 
    required: true 
  },
  // 🚀 NOUVEAU: Référence à la livraison spécifique pour traçabilité
  livraison: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Livraison'
  },
  ligne_livraison_id: {
    type: mongoose.Schema.Types.ObjectId  // ID de la ligne de livraison (sous-document)
  },
  quantite: { 
    type: Number, 
    required: true 
  },
  quantite_lots: {
    type: Number,
    default: null  // Si renseigné, indique que la saisie était en lots
  },
  motif: { 
    type: String, 
    required: true 
  },
  impact_financier: { 
    type: Number, 
    default: 0 
  },
  statut: { 
    type: String, 
    enum: ['EN_ATTENTE', 'TRAITE', 'REMBOURSE'], 
    default: 'TRAITE' 
  },
  // 🚀 NOUVEAUX CHAMPS pour la remise en stock
  quantite_remise_stock: {
    type: Number,
    default: 0  // Quantité déjà remise en stock
  },
  remises_stock: [{
    quantite: { type: Number, required: true },
    date_remise: { type: Date, default: Date.now },
    utilisateur: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilisateur' },
    commentaire: { type: String }
  }],
  utilisateur: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Utilisateur' 
  },
  date_traitement: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true
});

// Hook pre-save pour générer le numéro automatiquement
retourSchema.pre('save', async function() {
  if (this.isNew && !this.numero_retour) {
    this.numero_retour = await Counter.getNextSequence('retour');
  }
});

// Virtuel pour ID formaté
retourSchema.virtual('id_formate').get(function() {
  if (!this.numero_retour) return 'N/A';
  return `RET-${this.numero_retour.toString().padStart(4, '0')}`;
});

// Virtuel pour quantité restante à remettre en stock
retourSchema.virtual('quantite_restante_stock').get(function() {
  return this.quantite - (this.quantite_remise_stock || 0);
});

// Méthode pour vérifier si tout a été remis en stock
retourSchema.methods.estEntierementRemisEnStock = function() {
  return (this.quantite_remise_stock || 0) >= this.quantite;
};

// Méthode pour calculer le pourcentage remis en stock
retourSchema.methods.getPourcentageRemisEnStock = function() {
  if (this.quantite === 0) return 0;
  return Math.round(((this.quantite_remise_stock || 0) / this.quantite) * 100);
};

retourSchema.set('toJSON', { virtuals: true });
retourSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Retour', retourSchema);
