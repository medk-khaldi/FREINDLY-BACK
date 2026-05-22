const mongoose = require('mongoose');

/**
 * Recalculates all statistics for a given Point de Vente.
 * @param {string} pdvId - The ID of the Point de Vente.
 */
async function updatePDVStats(pdvId) {
  const PointDeVenteStats = mongoose.model('PointDeVenteStats');
  const Livraison = mongoose.model('Livraison');
  const Commande = mongoose.model('Commande');
  const PointDeVente = mongoose.model('PointDeVente');
  
  try {
    if (!pdvId) return;

    // 1. Find all commands for this PDV
    const commands = await Commande.find({ pointDeVente: pdvId }).select('_id');
    const commandIds = commands.map(c => c._id);

    if (commandIds.length === 0) {
      // No commands yet, but ensure we have a stats document with zeros
      await PointDeVenteStats.findOneAndUpdate(
        { pointDeVente: pdvId },
        { updatedAt: new Date() },
        { upsert: true, new: true }
      );
      return;
    }

    // 2. Perform a single robust aggregation using facets
    const results = await Livraison.aggregate([
      { $match: { commande: { $in: commandIds } } },
      {
        $facet: {
          global: [
            {
              $group: {
                _id: null,
                totalRevenue: { 
                  $sum: { 
                    $cond: [
                      { 
                        $or: [
                          { $eq: ["$statut", "LIVREE"] },
                          { $eq: ["$statut", "PARTIELLE"] },
                          { $in: ["$statut_paiement", ["PAYEE", "PARTIELLEMENT_PAYEE"]] }
                        ]
                      }, 
                      "$montant_total", 
                      0
                    ] 
                  } 
                },
                totalPaid: { $sum: "$montant_paye" },
                orderCount: { $sum: 1 },
                cancelledCount: { 
                  $sum: { $cond: [{ $eq: ["$statut", "ANNULEE"] }, 1, 0] } 
                },
                failedCount: { 
                  $sum: { $cond: [{ $eq: ["$statut", "ECHEC"] }, 1, 0] } 
                },
                lastOrderDate: { $max: "$date_creation" }
              }
            }
          ],
          payments: [
            { $unwind: "$paiements" },
            {
              $group: {
                _id: "$paiements.methode",
                count: { $sum: 1 },
                total: { $sum: "$paiements.montant" }
              }
            }
          ],
          monthly: [
            { 
              $match: { 
                $or: [
                  { statut: "LIVREE" },
                  { statut: "PARTIELLE" },
                  { statut_paiement: { $in: ["PAYEE", "PARTIELLEMENT_PAYEE"] } }
                ]
              } 
            },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m", date: { $ifNull: ["$date_creation", new Date()] } } },
                revenue: { $sum: "$montant_total" },
                orderCount: { $sum: 1 }
              }
            },
            { $sort: { "_id": 1 } },
            { $project: { month: "$_id", revenue: 1, orderCount: 1, _id: 0 } },
            { $limit: 12 }
          ]
        }
      }
    ]);

    const stats = results[0];
    const g = stats.global[0] || { 
      totalRevenue: 0, totalPaid: 0, orderCount: 0, 
      cancelledCount: 0, failedCount: 0, lastOrderDate: null 
    };

    // 3. Process Payment Methods
    const paymentMethods = {
      especes: { count: 0, total: 0 },
      cheque: { count: 0, total: 0 },
      virement: { count: 0, total: 0 },
      autre: { count: 0, total: 0 }
    };

    stats.payments.forEach(pb => {
      const method = pb._id?.toLowerCase();
      if (paymentMethods[method]) {
        paymentMethods[method] = { count: pb.count, total: pb.total };
      } else {
        paymentMethods.autre.count += pb.count;
        paymentMethods.autre.total += pb.total;
      }
    });

    const monthlyHistory = stats.monthly || [];

    // 4. Calculate ranking and KPIs
    let ranking = 'NOUVEAU';
    if (g.totalRevenue > 100000) ranking = 'VIP';
    else if (g.totalRevenue > 50000) ranking = 'GOLD';
    else if (g.totalRevenue > 10000) ranking = 'SILVER';
    else if (g.orderCount > 0) ranking = 'BRONZE';

    const averageOrderValue = g.orderCount > 0 ? g.totalRevenue / g.orderCount : 0;
    const successRate = g.orderCount > 0 ? ((g.orderCount - (g.failedCount || 0) - (g.cancelledCount || 0)) / g.orderCount) * 100 : 0;

    // 5. Update the stats document
    await PointDeVenteStats.findOneAndUpdate(
      { pointDeVente: pdvId },
      {
        totalRevenue: g.totalRevenue || 0,
        totalPaid: g.totalPaid || 0,
        totalOutstanding: Math.max(0, (g.totalRevenue || 0) - (g.totalPaid || 0)),
        orderCount: g.orderCount || 0,
        cancelledCount: g.cancelledCount || 0,
        failedCount: g.failedCount || 0,
        averageOrderValue,
        successRate,
        ranking,
        lastOrderDate: g.lastOrderDate,
        paymentMethods,
        monthlyHistory,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    // Sync ranking to PDV model
    await PointDeVente.findByIdAndUpdate(pdvId, { classification: ranking });

    console.log(`📊 Stats updated for PDV: ${pdvId} (Rank: ${ranking}, Revenue: ${g.totalRevenue})`);
  } catch (error) {
    console.error('❌ Error updating PDV stats:', error);
  }
}

module.exports = { updatePDVStats };
