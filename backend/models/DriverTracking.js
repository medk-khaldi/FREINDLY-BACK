const mongoose = require("mongoose");

const DriverTrackingSchema = new mongoose.Schema({
  chauffeurId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Chauffeur",
    required: true,
    index: true
  },
  utilisateurId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Utilisateur",
    required: true
  },
  currentLocation: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  lastUpdate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ["online", "offline", "delivering"],
    default: "offline"
  },
  voyageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Voyage"
  },
  speed: {
    type: Number,
    default: 0
  },
  heading: {
    type: Number,
    default: 0
  },
  trail: [{
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  socketId: {
    type: String
  }
}, { timestamps: true });



module.exports = mongoose.model("DriverTracking", DriverTrackingSchema);
