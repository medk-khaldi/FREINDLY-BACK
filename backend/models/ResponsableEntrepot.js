const mongoose = require('mongoose');
const softDeletePlugin = require('../utils/softDeletePlugin');

const responsableSchema = new mongoose.Schema({
  utilisateur: { type: mongoose.Schema.Types.ObjectId, ref: 'Utilisateur', required: true },
  role: { type: String, default: 'RESPONSABLE' }
});

// Applique le plugin de soft delete
responsableSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('ResponsableEntrepot', responsableSchema);
