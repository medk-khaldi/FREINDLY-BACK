const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  // 'support' for client-responsable, 'direct' for staff-staff
  type: {
    type: String,
    enum: ['support', 'direct', 'group'],
    default: 'direct'
  },
  
  participants: [{
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userModel: { type: String, enum: ['Utilisateur', 'Client'], required: true },
    role: { type: String }, // redundant but helpful for filtering
    lastSeen: { type: Date, default: Date.now }
  }],

  lastMessage: {
    content: String,
    type: { type: String, enum: ['text', 'image', 'file', 'voice'] },
    senderId: mongoose.Schema.Types.ObjectId,
    createdAt: Date
  },

  unreadCount: {
    type: Map,
    of: Number,
    default: {}
  },

  isActive: { type: Boolean, default: true },
  
    // For support conversations, we might want to track metadata
    metadata: {
      clientEmail: String,
      clientName: String,
      clientUsername: String,  // PDV nom boutique or Client prenom+nom
      clientPhone: String,     // Telephone number
      status: { type: String, enum: ['open', 'closed'], default: 'open' },
      aiEnabled: { type: Boolean, default: true },
      conversationMode: { type: String, enum: ['bot', 'human'], default: 'bot' },
      humanJoinedAt: { type: Date },
      topic: { type: String }, // NEW: Topic selected by client
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilisateur' }, // NEW: Assigned staff member
      escalatedAt: { type: Date },
      escalatedReason: { type: String },
      // NEW: Post-chat rating
      rating: {
        firstTime: { type: Boolean },
        issueResolved: { type: Boolean },
        satisfiedDelivery: { type: Boolean },
        thumbsUp: { type: Boolean },
        comment: { type: String }
      },
      closedAt: { type: Date }
    }
}, {
  timestamps: true
});

// Compound index to quickly find direct conversations between two specific users
// Note: Logic in controller should sort participant IDs to ensure uniqueness
conversationSchema.index({ 'participants.userId': 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
