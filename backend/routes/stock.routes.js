const express = require("express");
const router = express.Router();
const stockController = require("../controllers/stock.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");

// Appliquer l'auth optionnelle sur toutes les routes stock
// → req.user est peuplé si l'utilisateur est connecté (pour la traçabilité des mouvements)
router.use(optionalAuth);

// 🔹 Ajouter plusieurs stocks (BULK) → TOUJOURS AVANT :id
router.post("/bulk", stockController.ajouterStocksBulk);

// 🔹 Stock consolidé avec mouvements par période → AVANT :id
router.get("/movements-analysis", (req, res, next) => {
  console.log("🔍 Route movements-analysis appelée avec query:", req.query);
  next();
}, stockController.getConsolidatedWithMovements);

// 🔹 Analyse du stock pour tableau analytique et courbes
router.get("/analysis", stockController.getStockAnalysis);

// 🔹 Récupérer tous les stocks
router.get("/", stockController.getAll);

// 🔹 Créer un stock
router.post("/", stockController.ajouterStock);

// 🔹 Récupérer un stock par ID
router.get("/:id", (req, res, next) => {
  console.log("🔍 Route /:id appelée avec id:", req.params.id);
  next();
}, stockController.getById);

// 🔹 Mettre à jour un stock
router.put("/:id", stockController.update);

// 🔹 Supprimer un stock
router.delete("/:id", stockController.delete);

module.exports = router;
