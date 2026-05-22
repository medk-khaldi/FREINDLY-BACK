const express = require('express');
const router = express.Router();
const favorisController = require('../controllers/favoris.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Toutes les routes de favoris nécessitent d'être connecté
router.use(authMiddleware);

router.post('/toggle', favorisController.toggleFavori);
router.get('/', favorisController.getFavoris);

module.exports = router;
