const mongoose = require('mongoose');

const codePromoSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true, 
    uppercase: true, 
    trim: true 
  },
  description: { type: String },
  type: { 
    type: String, 
    enum: ['PERCENTAGE', 'FIXED'], 
    required: true 
  },
  valeur: { type: Number, required: true },        // 20 = 20% ou 20 DT
  montantMinimum: { type: Number, default: 0 },    // Minimum d'achat requis
  montantMaxReduction: { type: Number },            // Plafond de réduction (pour %)
  maxUtilisations: { type: Number, default: null }, // null = illimité
  utilisationsActuelles: { type: Number, default: 0 },
  utilisationParClient: { type: Number, default: 1 }, // Nombre d'utilisations par client
  clientsUtilises: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
  actif: { type: Boolean, default: true },
  dateDebut: { type: Date, required: true },
  dateFin: { type: Date, required: true }
}, { timestamps: true });

// Index pour recherche rapide
codePromoSchema.index({ code: 1, actif: 1 });

module.exports = mongoose.model('CodePromo', codePromoSchema);
