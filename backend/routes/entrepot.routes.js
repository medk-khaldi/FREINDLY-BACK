const router = require("express").Router();
const controller = require("../controllers/entrepot.controller");

// Créer un entrepôt
router.post("/", controller.createEntrepot);

// Récupérer tous les entrepôts
router.get("/", controller.getAllEntrepots);

// Récupérer un entrepôt par ID
router.get("/:id", controller.getEntrepotById);

module.exports = router;
