const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  // 'Utilisateur' for staff (admin/responsable/chauffeur), 'Client' for marketplace clients
  senderModel: {
    type: String,
    enum: ['Utilisateur', 'Client', 'AI'],
    required: true
  },
  // Snapshot of sender info at time of sending (denormalized for performance)
  senderName: { type: String },
  senderRole: { type: String },

  // Message content
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'voice'],
    default: 'text'
  },
  content: { type: String, default: '' }, // text content or caption

  // Media (for image/file/voice types)
  mediaUrl: { type: String },         // server path to the uploaded file
  mediaName: { type: String },        // original filename
  mediaMimeType: { type: String },    // e.g. 'image/jpeg', 'application/pdf'
  mediaSize: { type: Number },        // size in bytes
  mediaDuration: { type: Number },    // voice duration in seconds

  // Read receipts: array of { userId, readAt }
  readBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId },
    userModel: { type: String, enum: ['Utilisateur', 'Client'] },
    readAt: { type: Date, default: Date.now }
  }],

  isDeleted: { type: Boolean, default: false }
}, {
  timestamps: true
});

// Index for efficient conversation history queries
messageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
