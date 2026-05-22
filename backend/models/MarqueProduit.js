const mongoose = require("mongoose");
const softDeletePlugin = require('../utils/softDeletePlugin');

const marqueProduitSchema = new mongoose.Schema({
  nom: { type: String, required: true, unique: true }, // nom de la marque
  description: { type: String }                         // optionnel
}, { timestamps: true }); // createdAt, updatedAt automatiques

module.exports = mongoose.model("MarqueProduit", marqueProduitSchema);
