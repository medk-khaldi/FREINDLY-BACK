const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  // Identity
  nom: { type: String, required: true },
  prenom: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  telephone: { type: String },
  genre: { type: String, enum: ['M', 'Mme'], default: 'M' },
  dateNaissance: { type: Date },

  // Status
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  derniereCommande: { type: Date },

  // E-commerce
  adresses: [{
    label: { type: String, default: 'Maison' },
    gouvernorat: { type: String },
    delegation: { type: String },
    localite: { type: String },
    rue: { type: String },
    codePostal: { type: String },
    isDefault: { type: Boolean, default: false },
    latitude: { type: Number },
    longitude: { type: Number }
  }],
  favoris: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Produit'
  }],

  // Loyalty
  pointsFidelite: { type: Number, default: 0 },
  niveau: { type: String, enum: ['BRONZE', 'SILVER', 'GOLD'], default: 'BRONZE' },
  historiquePoints: [{
    type: { type: String, enum: ['GAIN', 'UTILISATION'] },
    points: { type: Number },
    date: { type: Date, default: Date.now },
    description: { type: String }
  }],

  // Stats
  totalDepense: { type: Number, default: 0 },
  nombreCommandes: { type: Number, default: 0 },

  // Security
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  
  // Email verification
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationCode: { type: String },
  emailVerificationExpires: { type: Date },

  // Preferences
  preferences: {
    newsletter: { type: Boolean, default: false },
    notificationsSms: { type: Boolean, default: true },
    langue: { type: String, default: 'fr' }
  },
  
  // Cart persistence
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
  }]
});

// Middleware to update stats
clientSchema.methods.incrementOrders = async function() {
  this.nombreCommandes += 1;
  this.derniereCommande = Date.now();
  return await this.save();
};

clientSchema.methods.updateSpend = async function(orderAmount) {
  this.totalDepense += orderAmount;
  return await this.save();
};

module.exports = mongoose.model('Client', clientSchema);
