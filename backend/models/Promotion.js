const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema({
  produit: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Produit',
    required: true 
  },
  type: { 
    type: String, 
    enum: ['PRIX', 'QUANTITE'], 
    required: true 
  },
  
  // Champs pour promo PRIX
  reductionValeur: { type: Number }, // ex: 20 ou 5.000
  isPercentage: { type: Boolean, default: true },
  
  // Champs pour promo QUANTITE
  quantiteMin: { type: Number },     // Seuil (ex: 3)
  quantiteGratuite: { type: Number }, // Offert (ex: 1)
  actionQuantite: { 
    type: String, 
    enum: ['GRATUIT', 'REDUCTION_LOT'], 
    default: 'GRATUIT' 
  },
  reductionLotValeur: { type: Number }, // ex: 10 pour -10% sur le lot
  
  // Dates de validité
  dateDebut: { type: Date, required: true },
  dateFin: { type: Date, required: true },
  
  actif: { type: Boolean, default: true },
  
  // Description pour affichage badge
  description: { type: String } 
}, { timestamps: true });

// Index pour recherche rapide
promotionSchema.index({ produit: 1, actif: 1, dateDebut: 1, dateFin: 1 });

module.exports = mongoose.model('Promotion', promotionSchema);
