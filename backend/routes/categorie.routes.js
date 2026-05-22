const router = require("express").Router();
const controller = require("../controllers/categorie.controller");

// Créer une catégorie
router.post("/", controller.create);

// Lister toutes les catégories
router.get("/", controller.getAll);

// Obtenir l'arborescence
router.get("/tree", controller.getTree);


// (Optionnel) récupérer une catégorie par id
router.get("/:id", controller.getById);

// (Optionnel) modifier une catégorie
router.put("/:id", controller.update);

// (Optionnel) supprimer une catégorie
router.delete("/:id", controller.delete);

module.exports = router;
