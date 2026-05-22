const mongoose = require('mongoose');
const Counter = require('./Counter');
const { formatSequentialId } = require('../utils/formatSequentialId');
const softDeletePlugin = require('../utils/softDeletePlugin');

const camionSchema = new mongoose.Schema({
  numero_camion: { 
    type: Number, 
    unique: true 
  },
  immatriculation: { type: String, required: true },
  marque: { type: String, required: true },
  modele: { type: String, required: true },
  capacite: { type: Number },
  statut: { type: String, enum: ['DISPONIBLE','EN_COURS','EN_MAINTENANCE'], default: 'DISPONIBLE' },
  chauffeur_assigne: { type: mongoose.Schema.Types.ObjectId, ref: 'Chauffeur' }
});

// Applique le plugin de soft delete
camionSchema.plugin(softDeletePlugin);

// Hook pre-save pour générer le numéro automatiquement (async sans next)
camionSchema.pre('save', async function() {
  if (this.isNew && !this.numero_camion) {
    this.numero_camion = await Counter.getNextSequence('camion');
  }
});

// Méthode virtuelle pour obtenir l'ID formaté (gère automatiquement les nombres > 9999)
camionSchema.virtual('id_formate').get(function() {
  if (!this.numero_camion) return 'N/A';
  return formatSequentialId('CAM', this.numero_camion);
});

// S'assurer que les virtuels sont inclus dans JSON
camionSchema.set('toJSON', { virtuals: true });
camionSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Camion', camionSchema);
