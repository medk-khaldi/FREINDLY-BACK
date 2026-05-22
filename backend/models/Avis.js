const mongoose = require('mongoose');
require('./Client');
require('./PointDeVente');

const avisSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'userModel',
    required: true
  },
  userModel: {
    type: String,
    required: true,
    enum: ['Client', 'PointDeVente'],
    default: 'Client'
  },
  produit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Produit',
    required: true
  },
  note: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  commentaire: {
    type: String,
    trim: true,
    maxlength: 1000
  }
}, { timestamps: true });

// Empêcher un utilisateur de laisser plusieurs avis sur le même produit
avisSchema.index({ client: 1, produit: 1, userModel: 1 }, { unique: true });

module.exports = mongoose.model('Avis', avisSchema);
