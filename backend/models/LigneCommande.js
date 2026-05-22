const mongoose = require('mongoose');

const ligneCommandeSchema = new mongoose.Schema({
  produit: { type: mongoose.Schema.Types.ObjectId, ref: 'Produit', required: true },
  quantite: { type: Number, required: true },          // quantité totale en unités individuelles (ORIGINALE, ne change jamais)
  quantite_reellement_commandee: { type: Number },     // quantité réellement commandée après annulations (en unités)
  prix_unitaire: { type: Number, required: true },
  quantite_retournee: { type: Number, default: 0 },
  quantite_livree: { type: Number, default: 0 },      // quantité déjà livrée
  quantite_restante: { type: Number, required: true }, // initialisée à la quantité commandée
  quantite_annulee: { type: Number, default: 0 },     // quantité annulée/libérée (en lots)
  unite: { type: mongoose.Schema.Types.ObjectId, ref: "Unite" },       // ajouté
  marque: { type: mongoose.Schema.Types.ObjectId, ref: "MarqueProduit" }, // ajouté
  categorie: { type: mongoose.Schema.Types.ObjectId, ref: "CategorieProduit" }, // ajouté
  lot: { type: mongoose.Schema.Types.ObjectId, ref: "Lot", default: null }, // ajouté pour les lots
  quantite_lots: { type: Number, default: null } // quantité originale en lots si applicable
});

// Avant de sauvegarder, on initialise quantite_restante = quantite et quantite_reellement_commandee = quantite si non défini
// Middleware synchrone sans callback `next` pour éviter l'erreur "next is not a function"
ligneCommandeSchema.pre('save', function () {
  if (this.isNew && this.quantite_restante === undefined) {
    this.quantite_restante = this.quantite;
  }
  if (this.isNew && this.quantite_reellement_commandee === undefined) {
    this.quantite_reellement_commandee = this.quantite;
  }
});

// Méthode virtuelle pour obtenir le poids de la ligne
ligneCommandeSchema.virtual('poids_ligne').get(function() {
  if (!this.produit || !this.produit.poids_unitaire) return 0;
  return this.produit.poids_unitaire * this.quantite;
});

// Méthode virtuelle pour obtenir le poids restant à livrer
ligneCommandeSchema.virtual('poids_restant').get(function() {
  if (!this.produit || !this.produit.poids_unitaire) return 0;
  return this.produit.poids_unitaire * (this.quantite_restante || 0);
});

// S'assurer que les virtuels sont inclus dans JSON
ligneCommandeSchema.set('toJSON', { virtuals: true });
ligneCommandeSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('LigneCommande', ligneCommandeSchema);
