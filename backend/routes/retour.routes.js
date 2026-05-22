const router = require("express").Router();
const controller = require("../controllers/retour.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");

router.use(optionalAuth);

router.get("/stats", controller.getStats);
router.get("/", controller.getAll);
router.post("/", controller.create);
router.post("/:id/remettre-stock", controller.remettreEnStock);

module.exports = router;
