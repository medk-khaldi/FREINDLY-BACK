const router = require("express").Router();
const controller = require("../controllers/chauffeur.controller");

router.post("/", controller.creer);
router.post("/user/:userId", controller.creerPourUtilisateur);
router.get("/", controller.lister);
router.get("/:id", controller.getById);
router.put("/:id", controller.modifier);
router.delete("/:id", controller.supprimer);
router.patch("/:id/restore", controller.restaurer);

module.exports = router;
