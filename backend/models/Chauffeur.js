const mongoose = require('mongoose');
const Counter = require('./Counter');
const { formatSequentialId } = require('../utils/formatSequentialId');
const softDeletePlugin = require('../utils/softDeletePlugin');

const chauffeurSchema = new mongoose.Schema({
  numero_chauffeur: { 
    type: Number, 
    unique: true 
  },
  utilisateur: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilisateur', required: true },
  camion_assigne: { type: mongoose.Schema.Types.ObjectId, ref: 'Camion' },
  voyages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Voyage' }],
  statut: { 
    type: String, 
    enum: ['hors service', 'en service'], 
    default: 'hors service' 
  }
}, {
  timestamps: true // Ajoute automatiquement createdAt et updatedAt
});

// Applique le plugin de soft delete
chauffeurSchema.plugin(softDeletePlugin);

// Hook pre-save pour générer le numéro automatiquement (async sans next)
chauffeurSchema.pre('save', async function() {
  if (this.isNew && !this.numero_chauffeur) {
    this.numero_chauffeur = await Counter.getNextSequence('chauffeur');
  }
});

// Méthode virtuelle pour obtenir l'ID formaté (gère automatiquement les nombres > 9999)
chauffeurSchema.virtual('id_formate').get(function() {
  if (!this.numero_chauffeur) return 'N/A';
  return formatSequentialId('CHF', this.numero_chauffeur);
});

// S'assurer que les virtuels sont inclus dans JSON
chauffeurSchema.set('toJSON', { virtuals: true });
chauffeurSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Chauffeur', chauffeurSchema);
