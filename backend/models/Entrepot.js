const mongoose = require("mongoose");

const EntrepotSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  adresse: { type: String, required: true },
  capacite: { type: Number, required: true },
});

module.exports = mongoose.model("Entrepot", EntrepotSchema);
