const express = require('express');
const router = express.Router();
const avisController = require('../controllers/avis.controller');
const auth = require('../middleware/auth.middleware');

// Public routes
router.get('/produit/:produitId', avisController.getAvisByProduct);
router.get('/produit/:produitId/stats', avisController.getStatsForProduct);

// Protected routes (requires client login)
router.get('/produit/:produitId/mine', auth, avisController.getMyAvis);
router.post('/', auth, avisController.createAvis);
router.put('/:id', auth, avisController.updateAvis);
router.delete('/:id', auth, avisController.deleteAvis);

module.exports = router;
