const router = require("express").Router();
const controller = require("../controllers/marque.controller"); // ton controller reste le même

// Créer une marque
router.post("/", controller.create);

// Lister toutes les marques
router.get("/", controller.getAll);

// Récupérer une marque par id
router.get("/:id", controller.getById);

// Modifier une marque
router.put("/:id", controller.update);

// Supprimer une marque
router.delete("/:id", controller.delete);

module.exports = router;
