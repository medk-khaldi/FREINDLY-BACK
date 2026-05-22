const mongoose = require('mongoose');

const pointDeVenteStatsSchema = new mongoose.Schema({
  pointDeVente: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'PointDeVente', 
    required: true,
    unique: true 
  },
  
  // Financial Metrics
  totalRevenue: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  totalOutstanding: { type: Number, default: 0 },
  
  // Volume Metrics
  orderCount: { type: Number, default: 0 },
  cancelledCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  
  // Performance Metrics
  averageOrderValue: { type: Number, default: 0 },
  successRate: { type: Number, default: 0 }, // percentage
  ranking: { type: String, default: 'Nouveau' },
  lastOrderDate: { type: Date },
  
  // Payment Method Breakdown
  paymentMethods: {
    especes: { count: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
    cheque: { count: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
    virement: { count: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
    autre: { count: { type: Number, default: 0 }, total: { type: Number, default: 0 } }
  },
  
  // Monthly Trends (Snapshots)
  monthlyHistory: [{
    month: { type: String }, // e.g., "2024-03"
    revenue: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 }
  }],

  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PointDeVenteStats', pointDeVenteStatsSchema);
