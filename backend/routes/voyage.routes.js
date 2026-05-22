const router = require("express").Router();
const controller = require("../controllers/voyage.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");

router.use(optionalAuth);

router.post("/preview-eta", controller.previewETA);
router.post("/", controller.creer);
router.get("/livraisons/disponibles", controller.getLivraisonsDisponibles);
router.get("/", controller.lister);
router.get("/camions/disponibilite", controller.getCamionsDisponibilite);
router.get("/:id", controller.getById);
router.put("/:id", controller.modifier);
router.patch("/:id/declarer-sortie", controller.declarerSortie);
router.patch("/:id/reordonner-stops", controller.reordonnerStops);
router.patch("/:voyageId/livraisons/:livraisonId", controller.associerLivraison);
router.patch("/:id/demarrer", controller.demarrer);
router.patch("/:id/terminer", controller.terminer);
router.delete("/:id", controller.supprimer);

module.exports = router;
