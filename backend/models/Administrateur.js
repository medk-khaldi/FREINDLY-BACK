const mongoose = require('mongoose');

const administrateurSchema = new mongoose.Schema({
  utilisateur: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilisateur', required: true },
  permissions: {
    gerer_utilisateurs: { type: Boolean, default: true },
    surveiller_commandes: { type: Boolean, default: true },
    surveiller_livraisons: { type: Boolean, default: true },
    consulter_factures: { type: Boolean, default: true },
    consulter_retours: { type: Boolean, default: true },
    ajuster_stock: { type: Boolean, default: true },
    gerer_referentiels: { type: Boolean, default: true }
  }
});

module.exports = mongoose.model('Administrateur', administrateurSchema);
