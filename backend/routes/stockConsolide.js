const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');

// Import direct des fonctions
const {
  lister,
  getByProduit,
  ajouterQuantite,
  retirerQuantite,
  definirQuantite
} = require('../controllers/stockConsolide.controller.js');

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// Routes
router.get('/', lister);
router.get('/produit/:produitId', getByProduit);
router.post('/produit/:produitId/ajouter', ajouterQuantite);
router.post('/produit/:produitId/retirer', retirerQuantite);
router.put('/produit/:produitId', definirQuantite);

module.exports = router;