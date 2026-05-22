const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.middleware');
const Client = require('../models/Client');
const { getPointsConfig } = require('../services/pointsService');

// @route   GET api/points/me
// @desc    Obtenir le solde et l'historique des points du client
// @access  Private (Client)
router.get('/me', auth, async (req, res) => {
  try {
    const client = await Client.findById(req.user.id)
      .select('pointsFidelite niveau historiquePoints');
    
    if (!client) {
      return res.status(404).json({ message: 'Client non trouvé' });
    }

    const config = await getPointsConfig();
    
    res.json({
      points: client.pointsFidelite || 0,
      niveau: client.niveau || 'BRONZE',
      valeurEnDT: ( (client.pointsFidelite || 0) * (config.valeurPoint || 0.01) ).toFixed(3),
      historique: (client.historiquePoints || []).sort((a, b) => b.date - a.date).slice(0, 50),
      config: {
        pointsParDT: config.pointsParDT,
        valeurPoint: config.valeurPoint,
        seuilSilver: config.seuilSilver,
        seuilGold: config.seuilGold
      }
    });
  } catch (error) {
    console.error('Erreur GET /points/me:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// @route   GET api/points/admin/stats
// @desc    Obtenir les statistiques globales de fidélité pour l'admin
// @access  Private (Admin)
router.get('/admin/stats', auth, async (req, res) => {
  try {
    // Vérifier si l'utilisateur est admin
    if (req.user.userType !== 'admin' && req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Accès refusé' });
    }

    const [statsPoints, topClients, levelCounts] = await Promise.all([
      Client.aggregate([
        { $group: { _id: null, totalPoints: { $sum: '$pointsFidelite' } } }
      ]),
      Client.find({ pointsFidelite: { $gt: 0 } })
        .sort({ pointsFidelite: -1 })
        .limit(10)
        .select('nom prenom email pointsFidelite niveau'),
      Client.aggregate([
        { $group: { _id: '$niveau', count: { $sum: 1 } } }
      ])
    ]);

    res.json({
      totalPointsEnCirculation: statsPoints[0]?.totalPoints || 0,
      topClients,
      repartitionNiveaux: levelCounts.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {})
    });
  } catch (error) {
    console.error('Erreur GET /points/admin/stats:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
