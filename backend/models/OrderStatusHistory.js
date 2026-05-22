const mongoose = require('mongoose');

const orderStatusHistorySchema = new mongoose.Schema({
  commande: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Commande', 
    required: true, 
    index: true 
  },
  ancienStatut: { 
    type: String 
  },
  nouveauStatut: { 
    type: String, 
    required: true 
  },
  dateChangement: { 
    type: Date, 
    default: Date.now 
  },
  customerNotified: { 
    type: Boolean, 
    default: false 
  },
  commentaire: { 
    type: String 
  },
  source: { 
    type: String, 
    enum: ['SYSTEME', 'ADMIN', 'CLIENT', 'CHAUFFEUR'],
    default: 'SYSTEME'
  }
});

module.exports = mongoose.model('OrderStatusHistory', orderStatusHistorySchema);
