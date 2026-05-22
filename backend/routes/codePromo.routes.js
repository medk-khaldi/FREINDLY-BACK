const express = require("express");
const router = express.Router();
const codePromoController = require("../controllers/codePromo.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");
const auth = require("../middleware/auth.middleware");
const { authorizeRoles } = require("../middleware/role.middleware");

// Client: Valider
router.post("/validate", optionalAuth, codePromoController.validerCodePromo);

// Admin: CRUD
router.get("/admin", auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "responsable_entrepot"), codePromoController.getAllCodesPromo);
router.post("/admin", auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "responsable_entrepot"), codePromoController.createCodePromo);
router.put("/admin/:id", auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "responsable_entrepot"), codePromoController.updateCodePromo);
router.delete("/admin/:id", auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "responsable_entrepot"), codePromoController.deleteCodePromo);

module.exports = router;
