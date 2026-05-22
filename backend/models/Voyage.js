const mongoose = require('mongoose');
const Counter = require('./Counter');
const { formatSequentialId } = require('../utils/formatSequentialId');

const voyageSchema = new mongoose.Schema({
  numero_voyage: { 
    type: Number, 
    unique: true 
  },
  commandes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Commande' }],
  livraisons: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Livraison' }],
  camion: { type: mongoose.Schema.Types.ObjectId, ref: 'Camion', required: true },
  chauffeur: { type: mongoose.Schema.Types.ObjectId, ref: 'Chauffeur', required: true, index: true },
  responsable: { type: mongoose.Schema.Types.ObjectId, ref: 'ResponsableEntrepot' },
  cree_par: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilisateur' },
  annule_par: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilisateur' },
  date_depart: { type: Date },
  date_depart_reelle: { type: Date },
  date_arrivee_prevue: { type: Date },
  date_arrivee_reelle: { type: Date },
  statut: { type: String, enum: ['EN_ATTENTE','PLANIFIE','EN_COURS','TERMINE','ANNULE'], default: 'EN_ATTENTE' },
  stops: [{
    livraison: { type: mongoose.Schema.Types.ObjectId, ref: 'Livraison' },
    nom: { type: String },
    adresse: { type: String },
    latitude: { type: Number },
    longitude: { type: Number },
    ordre: { type: Number },
    plannedArrival: { type: Date },
    actualArrival: { type: Date },
    statut: { type: String, enum: ['EN_ATTENTE', 'ARRIVE', 'LIVRE', 'ECHEC'], default: 'EN_ATTENTE' }
  }],
  optimizedRoute: {
    polyline: { type: String },
    distance: { type: Number },
    duration: { type: Number }
  },
  delay: { type: Number, default: 0 },
  eventLog: [{
    type: { type: String },
    timestamp: { type: Date, default: Date.now },
    description: { type: String }
  }]
}, { timestamps: true });

// Hook pre-save pour générer le numéro automatiquement (async sans next)
voyageSchema.pre('save', async function() {
  if (this.isNew && !this.numero_voyage) {
    this.numero_voyage = await Counter.getNextSequence('voyage');
  }
});

// Méthode virtuelle pour obtenir l'ID formaté (gère automatiquement les nombres > 9999)
voyageSchema.virtual('id_formate').get(function() {
  if (!this.numero_voyage) return 'N/A';
  return formatSequentialId('VOY', this.numero_voyage);
});

// S'assurer que les virtuels sont inclus dans JSON
voyageSchema.set('toJSON', { virtuals: true });
voyageSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Voyage', voyageSchema);
