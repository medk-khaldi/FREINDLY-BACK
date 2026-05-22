const mongoose = require('mongoose');

const slideSchema = new mongoose.Schema({
  titre: {
    type: String,
    required: [true, "Le titre est requis"]
  },
  sousTitre: {
    type: String
  },
  badge: {
    type: String
  },
  image: {
    type: String,
    required: [true, "L'image de fond est requise"]
  },
  lienBouton: {
    type: String,
    default: '/search'
  },
  texteBouton: {
    type: String,
    default: "Découvrir l'offre"
  },
  ordre: {
    type: Number,
    default: 0
  },
  actif: {
    type: Boolean,
    default: true
  },
  imagePosition: {
    type: Number,
    default: 50 // 50% = centered by default
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Slide', slideSchema);
