const express = require('express');
const router = express.Router();
const lotController = require('../controllers/lot.controller');

// Routes publiques (pas de middleware d'authentification comme les autres routes)
router.get('/', lotController.obtenirTousLesLots);
router.get('/:id', lotController.obtenirLotParId);
router.post('/', lotController.creerLot);
router.put('/:id', lotController.mettreAJourLot);
router.delete('/:id', lotController.supprimerLot);

module.exports = router;
