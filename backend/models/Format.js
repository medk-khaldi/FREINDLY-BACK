const mongoose = require('mongoose');
const softDeletePlugin = require('../utils/softDeletePlugin');

const formatSchema = new mongoose.Schema({
  nom: { 
    type: String, 
    required: true,
    trim: true
  },
  volume: { 
    type: String, 
    default: null 
  },
  lots: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lot"
  }]
}, { timestamps: true });

// Applique le plugin de soft delete
formatSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Format', formatSchema);
