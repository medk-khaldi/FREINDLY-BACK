const mongoose = require('mongoose');

const factureSchema = new mongoose.Schema({
  livraison: { type: mongoose.Schema.Types.ObjectId, ref: 'Livraison', required: true },
  commande: { type: mongoose.Schema.Types.ObjectId, ref: 'Commande', required: true },
  montant_total: { type: Number, required: true },
  statut: { type: String, enum: ['PROFORMA','EN_ATTENTE','PARTIELLEMENT_PAYEE','PAYEE','ANNULEE'], default: 'PROFORMA' },
  date_creation: { type: Date, default: Date.now },
  date_echeance: { type: Date }
});

// Méthode pour obtenir l'ID formaté de la facture (basé sur l'ID de la livraison)
factureSchema.methods.getIdFormate = async function() {
  try {
    // Récupérer la livraison associée
    const Livraison = require('./Livraison');
    const livraison = await Livraison.findById(this.livraison);
    
    if (!livraison) {
      return 'FAC-N/A';
    }
    
    // Obtenir l'ID formaté de la livraison
    const livraisonId = await livraison.getIdFormate();
    
    // Remplacer "LIV" par "FAC"
    return livraisonId.replace('LIV', 'FAC');
  } catch (error) {
    console.error('Erreur formatage ID facture:', error);
    return 'FAC-ERROR';
  }
};

// S'assurer que les virtuels sont inclus dans JSON
factureSchema.set('toJSON', { virtuals: true });
factureSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Facture', factureSchema);