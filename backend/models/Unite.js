const mongoose = require("mongoose");
const softDeletePlugin = require('../utils/softDeletePlugin');

const uniteSchema = new mongoose.Schema({
  nom: { type: String, required: true, unique: true }, // ex: "kg", "L", "pièce"
  description: { type: String }                         // optionnel
}, { timestamps: true });

// Applique le plugin de soft delete
uniteSchema.plugin(softDeletePlugin);

module.exports = mongoose.model("Unite", uniteSchema);
