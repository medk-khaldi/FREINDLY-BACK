const mongoose = require("mongoose");
const softDeletePlugin = require('../utils/softDeletePlugin');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  nom: { type: String },
  prenom: { type: String },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ["admin", "responsableEntrepot", "chauffeur", "client", "en_attente"], 
    default: "en_attente",
    required: true 
  },
  isEmailVerified: { type: Boolean, default: false },
  verificationCode: { type: String },
  verificationCodeExpires: { type: Date },
  resetPasswordCode: { type: String },
  resetPasswordCodeExpires: { type: Date },
  profileImage: { type: String, default: null },
  pendingEmail: { type: String, default: null },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date },
  favoris: [{ type: mongoose.Schema.Types.ObjectId, ref: "Produit" }],
  createdAt: { type: Date, default: Date.now },
});

// Applique le plugin de soft delete
userSchema.plugin(softDeletePlugin);

module.exports = mongoose.model("Utilisateur", userSchema);
