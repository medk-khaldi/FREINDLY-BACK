const Commande = require("../models/Commande");
const LigneCommande = require("../models/LigneCommande");
const Produit = require("../models/Produit");
const Client = require("../models/Client");
const Categorie = require("../models/CategorieProduit");
const mongoose = require("mongoose");

exports.getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Statuses that count towards revenue and leaderboard
    const ACTIVE_STATUSES = ["LIVREE"];

    // 1. KPIs (Lifetime, Monthly, Last Month)
    // We use Commande.total directly as it's the source of truth for Net Revenue (including promos/shipping)
    const getRevenuePipeline = (matchFilter) => [
      { $match: { statut: { $in: ACTIVE_STATUSES }, ...matchFilter } },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
          count: { $sum: 1 }
        }
      }
    ];

    const lifetimeStats = await Commande.aggregate(getRevenuePipeline({}));
    const thisMonthStats = await Commande.aggregate(getRevenuePipeline({ date_commande: { $gte: firstDayOfMonth } }));
    
    // Last month stats
    const firstDayOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastDayOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    const lastMonthStats = await Commande.aggregate(getRevenuePipeline({ 
      date_commande: { $gte: firstDayOfLastMonth, $lte: lastDayOfLastMonth } 
    }));

    // 2. Sales Trend (30 days)
    const trendAgg = await Commande.aggregate([
      { $match: { statut: { $in: ACTIVE_STATUSES }, date_commande: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date_commande" } },
          revenue: { $sum: "$total" },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const salesTrend = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const found = trendAgg.find(t => t._id === dateStr);
      salesTrend.push({
        date: dateStr,
        revenue: found ? found.revenue : 0,
        orders: found ? found.orders : 0
      });
    }

    // 3. Top Products (Net of returns)
    const topProductsAgg = await Commande.aggregate([
      { $match: { statut: { $in: ACTIVE_STATUSES } } },
      { $unwind: "$lignesCommande" },
      {
        $lookup: {
          from: "lignecommandes",
          localField: "lignesCommande",
          foreignField: "_id",
          as: "ligne"
        }
      },
      { $unwind: "$ligne" },
      {
        $group: {
          _id: "$ligne.produit",
          totalVendu: { 
            $sum: { 
              $subtract: [
                { $ifNull: ["$ligne.quantite_reellement_commandee", "$ligne.quantite"] },
                { $ifNull: ["$ligne.quantite_retournee", 0] }
              ]
            } 
          },
          totalRevenue: {
            $sum: {
              $multiply: [
                { 
                  $subtract: [
                    { $ifNull: ["$ligne.quantite_reellement_commandee", "$ligne.quantite"] },
                    { $ifNull: ["$ligne.quantite_retournee", 0] }
                  ]
                },
                "$ligne.prix_unitaire"
              ]
            }
          }
        }
      },
      { $match: { totalVendu: { $gt: 0 } } }, // Only show products with actual net sales
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "produits",
          localField: "_id",
          foreignField: "_id",
          as: "details"
        }
      },
      { $unwind: { path: "$details", preserveNullAndEmptyArrays: true } },
      { $match: { "details": { $exists: true, $ne: null }, "details.isDeleted": { $ne: true } } },
      {
        $lookup: {
          from: "categorieproduits",
          localField: "details.categorie",
          foreignField: "_id",
          as: "categoryDetails"
        }
      },
      { $unwind: { path: "$categoryDetails", preserveNullAndEmptyArrays: true } }
    ]);

    const topProducts = topProductsAgg.map(p => ({
      _id: p._id,
      nom: p.details?.nom || "Produit inconnu",
      image: p.details?.image,
      totalVendu: p.totalVendu,
      totalRevenue: p.totalRevenue,
      categorie: p.categoryDetails ? p.categoryDetails.nom : "Sans catégorie"
    }));

    // 4. Top Customers (Net spend)
    const topCustomersAgg = await Commande.aggregate([
      { $match: { statut: { $in: ACTIVE_STATUSES }, client: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: "$client",
          totalDepense: { $sum: "$total" },
          nombreCommandes: { $sum: 1 }
        }
      },
      { $sort: { totalDepense: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "clients",
          localField: "_id",
          foreignField: "_id",
          as: "clientDetails"
        }
      },
      { $unwind: { path: "$clientDetails", preserveNullAndEmptyArrays: true } },
      // Filter out clients that were hard-deleted
      { $match: { "clientDetails": { $exists: true, $ne: null } } },
    ]);

    const topCustomers = topCustomersAgg.map(c => ({
      _id: c._id,
      nom: c.clientDetails?.nom || "Client",
      prenom: c.clientDetails?.prenom || "Inconnu",
      email: c.clientDetails?.email,
      totalDepense: c.totalDepense,
      nombreCommandes: c.nombreCommandes,
      niveau: c.clientDetails?.niveau || "BRONZE"
    }));

    // 5. Revenue By Category (Net of returns)
    const revenueByCategoryAgg = await Commande.aggregate([
      { $match: { statut: { $in: ACTIVE_STATUSES } } },
      { $unwind: "$lignesCommande" },
      {
        $lookup: {
          from: "lignecommandes",
          localField: "lignesCommande",
          foreignField: "_id",
          as: "ligne"
        }
      },
      { $unwind: "$ligne" },
      {
        $group: {
          _id: "$ligne.categorie",
          revenue: {
            $sum: {
              $multiply: [
                { 
                  $subtract: [
                    { $ifNull: ["$ligne.quantite_reellement_commandee", "$ligne.quantite"] },
                    { $ifNull: ["$ligne.quantite_retournee", 0] }
                  ]
                },
                "$ligne.prix_unitaire"
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: "categorieproduits",
          localField: "_id",
          foreignField: "_id",
          as: "cat"
        }
      },
      { $unwind: { path: "$cat", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          nom: { $ifNull: ["$cat.nom", "Sans catégorie"] },
          revenue: 1
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    res.json({
      revenue: {
        lifetime: lifetimeStats[0]?.total || 0,
        totalOrders: lifetimeStats[0]?.count || 0,
        avgOrderValue: (lifetimeStats[0]?.total || 0) / (lifetimeStats[0]?.count || 1),
        thisMonth: thisMonthStats[0]?.total || 0,
        lastMonth: lastMonthStats[0]?.total || 0
      },
      salesTrend,
      topProducts,
      topCustomers,
      revenueByCategory: revenueByCategoryAgg
    });
  } catch (err) {
    console.error("❌ Erreur getDashboardStats:", err);
    res.status(500).json({ message: "Erreur serveur stats", error: err.message });
  }
};
