const mongoose = require("mongoose");
const softDeletePlugin = require('../utils/softDeletePlugin');

const CategorieProduitSchema = new mongoose.Schema({
  nom: {
    type: String,
    required: true,
    unique: true
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CategorieProduit",
    default: null,
  },
  lots: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lot"
  }]
}, { timestamps: true });

module.exports = mongoose.model("CategorieProduit", CategorieProduitSchema);
