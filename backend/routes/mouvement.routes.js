const express = require("express");
const router = express.Router();
const mouvementController = require("../controllers/mouvement.controller");
const stockController = require("../controllers/stock.controller");

// Stock consolidé avec mouvements par période
router.get("/consolidated-stock", stockController.getConsolidatedWithMovements);

// Statistiques agrégées
router.get("/stats", mouvementController.getStats);

// Historique d'un stock spécifique
router.get("/stock/:stockId", mouvementController.getHistoriqueStock);

// Lister tous les mouvements (avec filtres via query params)
router.get("/", mouvementController.listerMouvements);

// Créer un mouvement manuellement
router.post("/", mouvementController.creerMouvement);

module.exports = router;
