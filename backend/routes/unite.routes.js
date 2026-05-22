const router = require("express").Router();
const controller = require("../controllers/unite.controller");

// Créer une unité
router.post("/", controller.create);

// Lister toutes les unités
router.get("/", controller.getAll);

// (Optionnel) récupérer une unité par id
router.get("/:id", controller.getById);

// (Optionnel) modifier une unité
router.put("/:id", controller.update);

// (Optionnel) supprimer une unité
router.delete("/:id", controller.delete);

// Restaurer une unité
router.patch("/:id/restore", controller.restore);

module.exports = router;
