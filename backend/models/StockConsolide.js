const mongoose = require('mongoose');

/**
 * Modèle StockConsolide
 * 
 * Représente le stock consolidé par produit avec toutes les informations nécessaires :
 * - quantite_totale : Stock total physique
 * - quantite_reservee : Stock réservé pour les commandes
 * - quantite_retournee : Stock retourné (défectueux, etc.)
 * - quantite_disponible : Stock réellement disponible (calculé automatiquement)
 */
const stockConsolideSchema = new mongoose.Schema({
  produit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Produit',
    required: true,
    unique: true // Un seul enregistrement par produit
  },
  quantite_totale: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  quantite_reservee: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  quantite_retournee: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  quantite_disponible: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  quantite_entree_totale: {
    type: Number,
    required: true,
    default: 0,
    min: 0
    // Jamais décrémenté — représente toute la quantité jamais ajoutée au stock.
    // Si = 0, le produit n'a jamais été mis en stock (Nouveau).
    // Si > 0 et tout le reste = 0, le produit a été entièrement épuisé (Rupture).
  },
  entrepot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Entrepot',
    required: true
  }
}, {
  timestamps: true
});

// Middleware pour calculer automatiquement quantite_totale avant sauvegarde
// Total = Available + Reserved + Returned (tous les champs sont indépendants)
stockConsolideSchema.pre('save', function() {
  // Calculer le total basé sur les composants
  this.quantite_totale = (this.quantite_disponible || 0) + (this.quantite_reservee || 0) + (this.quantite_retournee || 0);
});

// Méthode pour ajouter du stock total (augmente le disponible)
stockConsolideSchema.methods.ajouterStock = function(quantite) {
  this.quantite_disponible += quantite;
  this.quantite_entree_totale = (this.quantite_entree_totale || 0) + quantite; // jamais décrémenté
  // quantite_totale sera recalculée automatiquement dans pre('save')
  return this.save();
};

// Méthode pour retirer du stock total (diminue le disponible)
stockConsolideSchema.methods.retirerStock = function(quantite) {
  if (this.quantite_disponible < quantite) {
    throw new Error(`Stock disponible insuffisant: disponible ${this.quantite_disponible}, demandé ${quantite}`);
  }
  this.quantite_disponible -= quantite;
  // quantite_totale sera recalculée automatiquement dans pre('save')
  return this.save();
};

// Méthode pour réserver du stock (transfère du disponible vers réservé)
stockConsolideSchema.methods.reserverStock = function(quantite) {
  if (this.quantite_disponible < quantite) {
    throw new Error(`Stock disponible insuffisant: disponible ${this.quantite_disponible}, demandé ${quantite}`);
  }
  this.quantite_disponible -= quantite;
  this.quantite_reservee += quantite;
  // quantite_totale reste la même car on transfère juste entre catégories
  return this.save();
};

// Méthode pour libérer du stock réservé (transfère du réservé vers disponible)
stockConsolideSchema.methods.libererStockReserve = function(quantite) {
  if (this.quantite_reservee < quantite) {
    throw new Error(`Stock réservé insuffisant: réservé ${this.quantite_reservee}, demandé ${quantite}`);
  }
  this.quantite_reservee -= quantite;
  this.quantite_disponible += quantite;
  // quantite_totale reste la même car on transfère juste entre catégories
  return this.save();
};

// Méthode pour marquer du stock comme retourné
stockConsolideSchema.methods.marquerRetourne = function(quantite) {
  this.quantite_retournee += quantite;
  return this.save();
};

// Méthode pour transférer du stock réservé vers retourné (pour les signalements)
stockConsolideSchema.methods.transfererReserveVersRetourne = function(quantite) {
  if (this.quantite_reservee < quantite) {
    throw new Error(`Stock réservé insuffisant: réservé ${this.quantite_reservee}, demandé ${quantite}`);
  }
  this.quantite_reservee -= quantite;
  this.quantite_retournee += quantite;
  // quantite_totale reste la même car on transfère juste entre catégories
  return this.save();
};

// Méthode statique pour obtenir ou créer un stock consolidé
stockConsolideSchema.statics.obtenirOuCreer = async function(produitId, entrepotId) {
  let stock = await this.findOne({ produit: produitId });
  
  if (!stock) {
    // Si aucun entrepôt spécifié, utiliser le premier disponible
    if (!entrepotId) {
      const Entrepot = require('./Entrepot');
      const entrepotDefaut = await Entrepot.findOne();
      if (!entrepotDefaut) {
        throw new Error('Aucun entrepôt trouvé dans le système');
      }
      entrepotId = entrepotDefaut._id;
    }
    
    stock = new this({
      produit: produitId,
      quantite_totale: 0,
      quantite_reservee: 0,
      quantite_retournee: 0,
      quantite_disponible: 0,
      quantite_entree_totale: 0,
      entrepot: entrepotId
    });
    await stock.save();
  }
  
  return stock;
};

module.exports = mongoose.model('StockConsolide', stockConsolideSchema);
