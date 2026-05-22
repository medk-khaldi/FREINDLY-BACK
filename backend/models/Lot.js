const mongoose = require('mongoose');

const lotSchema = new mongoose.Schema({
  nom: { 
    type: String, 
    required: true,
    unique: true 
  },
  quantite_unitaire: { 
    type: Number, 
    required: true,
    min: 1 
  },
  description: { 
    type: String 
  }
}, { timestamps: true });

module.exports = mongoose.model('Lot', lotSchema);
