const mongoose = require('mongoose');

const systemActivityLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Utilisateur',
        required: true
    },
    action: {
        type: String,
        required: true,
        enum: [
            'LOGIN',
            'LOGOUT', 
            'CREATE',
            'UPDATE',
            'DELETE',
            'VIEW',
            'EXPORT',
            'IMPORT',
            'SYSTEM_ERROR',
            'PERMISSION_DENIED',
            'TEST'
        ]
    },
    resource: {
        type: String,
        required: true // e.g., 'commande', 'stock', 'livraison', 'voyage', 'user'
    },
    resourceId: {
        type: String // ID of the affected resource
    },
    details: {
        type: String // Additional details about the action
    },
    ipAddress: {
        type: String
    },
    userAgent: {
        type: String
    },
    success: {
        type: Boolean,
        default: true
    },
    errorMessage: {
        type: String
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for performance
systemActivityLogSchema.index({ user: 1, timestamp: -1 });
systemActivityLogSchema.index({ action: 1, timestamp: -1 });
systemActivityLogSchema.index({ resource: 1, timestamp: -1 });
systemActivityLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('SystemActivityLog', systemActivityLogSchema);