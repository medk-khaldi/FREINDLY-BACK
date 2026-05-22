const mongoose = require('mongoose');
const { formatIdBadge } = require('../utils/idFormatter');

const mouvementStockSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['ENTREE', 'SORTIE', 'RETOUR', 'AJUSTEMENT', 'TRANSFERT', 'RESERVATION', 'LIBERATION', 'PAIEMENT'],
    required: true
  },
  stock: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock',
    required: function() { 
      return this.type !== 'RESERVATION' && 
             this.type !== 'LIBERATION' && 
             this.type !== 'PAIEMENT'; 
    }
  },
  quantite: {
    type: Number,
    required: true
  },
  // Information sur le lot (si applicable)
  lot_info: {
    lot_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lot'
    },
    nom_lot: String,
    quantite_unitaire: Number,
    nombre_lots: Number,
    reste_unites: Number
  },
  // Optionnel: recommandé pour les ENTREE mais pas bloquant
  prix_unitaire: {
    type: Number
  },
  date_mouvement: {
    type: Date,
    default: Date.now
  },
  commentaire: {
    type: String
  },
  // Optionnel: certaines opérations sont système (pas d'utilisateur connecté)
  utilisateur: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Utilisateur'
  },
  // Référence dynamique vers l'entité qui a causé le mouvement
  reference: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'reference_type'
  },
  reference_type: {
    type: String,
    enum: ['Commande', 'Livraison', 'Retour', 'Voyage', 'Stock']
  },
  // Identifiant de groupe pour les opérations en masse
  batch_id: {
    type: String,
    index: true
  }
}, {
  timestamps: true
});

// Index pour améliorer les performances des requêtes
mouvementStockSchema.index({ stock: 1, date_mouvement: -1 });
mouvementStockSchema.index({ type: 1 });
mouvementStockSchema.index({ utilisateur: 1 });
mouvementStockSchema.index({ reference: 1 });

// Méthode virtuelle pour obtenir la référence formatée
mouvementStockSchema.virtual('reference_formatee').get(function() {
  if (!this.reference || !this.reference_type) return null;
  
  // Mapper les types vers les préfixes
  const typeMap = {
    'Commande': 'commande',
    'Livraison': 'livraison',
    'Retour': 'retour',
    'Voyage': 'voyage',
    'Stock': 'stock'
  };
  
  const type = typeMap[this.reference_type];
  if (!type) return this.reference.toString();
  
  return formatIdBadge(this.reference, type);
});

// Méthode pour obtenir la référence formatée avec le numéro séquentiel
mouvementStockSchema.methods.getReferenceFormatee = async function() {
  if (!this.reference || !this.reference_type) return null;
  
  try {
    // Populer la référence si ce n'est pas déjà fait
    if (!this.populated('reference')) {
      await this.populate('reference');
    }
    
    const ref = this.reference;
    if (!ref) return null;
    
    // Utiliser id_formate si disponible (pour les entités avec numéros séquentiels)
    if (ref.id_formate) {
      return `#${ref.id_formate}`;
    }
    
    // Pour les livraisons, utiliser getIdFormate
    if (this.reference_type === 'Livraison' && ref.getIdFormate) {
      const idFormate = await ref.getIdFormate();
      return `#${idFormate}`;
    }
    
    // Fallback: utiliser formatIdBadge avec l'ID MongoDB
    const typeMap = {
      'Commande': 'commande',
      'Livraison': 'livraison',
      'Retour': 'retour',
      'Voyage': 'voyage',
      'Stock': 'stock'
    };
    
    const type = typeMap[this.reference_type];
    return formatIdBadge(ref._id, type);
    
  } catch (error) {
    console.error('Erreur formatage référence:', error);
    return null;
  }
};

// S'assurer que les virtuels sont inclus dans JSON
mouvementStockSchema.set('toJSON', { virtuals: true });
mouvementStockSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('MouvementStock', mouvementStockSchema);
