const mongoose = require('mongoose');
const Counter = require('./Counter');
const { formatSequentialId } = require('../utils/formatSequentialId');

const commandeSchema = new mongoose.Schema({
  numero_commande: { 
    type: Number, 
    unique: true 
  },
  pointDeVente: { type: mongoose.Schema.Types.ObjectId, ref: 'PointDeVente', required: false },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: false },
  lignesCommande: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LigneCommande' }],
  responsable: { type: mongoose.Schema.Types.ObjectId, ref: 'ResponsableEntrepot' },
  statut: { type: String, enum: ['EN_ATTENTE','PREPAREE','EN_LIVRAISON','LIVREE','CONFIRMEE','ANNULEE','ECHEC'], default: 'EN_ATTENTE' },
  adresse_livraison: {
    gouvernorat: String,
    delegation: String,
    localite: String,
    rue: String,
    codePostal: String,
    telephone: String,
    nom: String,
    prenom: String,
    latitude: Number,
    longitude: Number
  },
  total: { type: Number, default: 0 },
  sousTotal: { type: Number, default: 0 },
  fraisLivraison: { type: Number, default: 0 },
  codePromo: {
    code: String,
    type: { type: String, enum: ['PERCENTAGE', 'FIXED'] },
    valeur: Number,
    reduction: Number
  },
  fidelite: {
    pointsUtilises: { type: Number, default: 0 },
    reduction: { type: Number, default: 0 }
  },
  date_commande: { type: Date, default: Date.now },
  date_creation: { type: Date, default: Date.now },  // Conservé pour compatibilité
  note_client: { type: String },
  mode_paiement: { type: String, enum: ['COD', 'CARTE'], default: 'COD' },
  stripePaymentIntentId: { type: String, default: null },
  planification: {
    date: { type: String },
    creneau: { type: String }
  }
});


// Hook pre-save pour générer le numéro automatiquement (async sans next)
commandeSchema.pre('save', async function() {
  if (this.isNew && !this.numero_commande) {
    this.numero_commande = await Counter.getNextSequence('commande');
  }
});

// Méthode virtuelle pour obtenir l'ID formaté (gère automatiquement les nombres > 9999)
commandeSchema.virtual('id_formate').get(function() {
  if (!this.numero_commande) return 'N/A';
  return formatSequentialId('CMD', this.numero_commande);
});

// Méthode virtuelle pour obtenir le statut avec pourcentage
commandeSchema.virtual('statut_affiche').get(function() {
  const statut = this.statut_calcule || this.statut;
  
  if (this.pourcentage_livraison && this.pourcentage_livraison > 0 && this.pourcentage_livraison < 100) {
    if (statut === 'LIVREE') {
      return `LIVREE (${this.pourcentage_livraison}%)`;
    } else if (statut === 'EN_LIVRAISON') {
      return `EN_LIVRAISON (${this.pourcentage_livraison}%)`;
    }
  }
  
  return statut;
});

// Méthode virtuelle pour obtenir le poids total de la commande
commandeSchema.virtual('poids_total').get(function() {
  if (!this.lignesCommande || this.lignesCommande.length === 0) return 0;
  return this.lignesCommande.reduce((total, ligne) => {
    // Note: nécessite que les lignes soient populées avec le produit
    const poids = (ligne.produit && ligne.produit.poids_unitaire) ? ligne.produit.poids_unitaire : 0;
    return total + (poids * ligne.quantite);
  }, 0);
});

// Méthode virtuelle pour obtenir le poids restant à livrer
commandeSchema.virtual('poids_restant').get(function() {
  if (!this.lignesCommande || this.lignesCommande.length === 0) return 0;
  return this.lignesCommande.reduce((total, ligne) => {
    const poids = (ligne.produit && ligne.produit.poids_unitaire) ? ligne.produit.poids_unitaire : 0;
    return total + (poids * (ligne.quantite_restante || 0));
  }, 0);
});

// Virtuel pour déterminer le type de commande (client vs pdv)
commandeSchema.virtual('type_commande').get(function() {
  if (this.pointDeVente) return 'pdv';
  if (this.client) return 'client';
  return 'inconnu';
});

// S'assurer que les virtuels sont inclus dans JSON
commandeSchema.set('toJSON', { virtuals: true });
commandeSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Commande', commandeSchema);
