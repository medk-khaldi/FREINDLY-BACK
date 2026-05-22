const mongoose = require('mongoose');

const pointDeVenteSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  adresse: { type: String },
  telephone: { type: String },
  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  matricule_fiscale: { type: String },
  
  // Inscription marketplace & Validation
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationCode: { type: String },
  emailVerificationExpires: { type: Date },
  
  inscription_source: { type: String, enum: ['ADMIN', 'MARKETPLACE'], default: 'ADMIN' },
  statut_validation: { 
    type: String, 
    enum: ['EN_ATTENTE', 'APPROUVE', 'REJETE'], 
    default: 'APPROUVE' // Les PDV créés par l'admin sont approuvés par défaut
  },
  date_inscription: { type: Date, default: Date.now },

  latitude: { type: Number },
  longitude: { type: Number },
  localisation_gps: { type: String },
  actif: { type: Boolean, default: true },

  // Panier persistant
  panier: [{
    cartItemId: String,
    produitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Produit' },
    nom: String,
    prix: Number,
    prix_reference: Number,
    image: String,
    quantite: { type: Number, default: 1 },
    selectedLot: { type: Object },
    promotionActive: { type: Object },
    categorie: { type: Object },
    format: { type: Object },
    addedAt: { type: Date, default: Date.now }
  }],

  // Favoris
  favoris: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Produit' }],

  // Fidélité
  pointsFidelite: { type: Number, default: 0 },
  niveau: { type: String, enum: ['BRONZE', 'SILVER', 'GOLD'], default: 'BRONZE' },
  historiquePoints: [{
    type: { type: String, enum: ['GAIN', 'UTILISATION'] },
    points: { type: Number },
    date: { type: Date, default: Date.now },
    description: { type: String }
  }],

  // Nouveaux champs pour statistiques et profil
  classification: { type: String, default: 'N/A' }, 
  segment: { 
    type: String, 
    enum: ['GROSSISTE', 'RETAIL', 'PREMIUM', 'AUTRE'], 
    default: 'RETAIL' 
  },
  categorie_client: {
    type: String,
    enum: ['VIP', 'STANDARD', 'NOUVEAU', 'A_RISQUE'],
    default: 'NOUVEAU'
  },
  limite_credit: { type: Number, default: 0 },
  responsable_nom: { type: String },
  notes_interne: { type: String },
  
  // Security
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  lastLogin: { type: Date },

  // Document d'approbation
  document_approbation: {
    type_document: { 
      type: String, 
      enum: ['registre_commerce', 'patente', 'facture_officielle'] 
    },
    filename: { type: String },
    path: { type: String },
    uploaded_at: { type: Date, default: Date.now }
  }
}, { timestamps: true });

module.exports = mongoose.model('PointDeVente', pointDeVenteSchema);
