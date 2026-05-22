const express = require("express");
const router = express.Router();
const configController = require("../controllers/config.controller");
console.log('🔍 Chargement des routes CONFIG...');
const auth = require("../middleware/auth.middleware");
const optionalAuth = require("../middleware/optionalAuth.middleware");
const { authorizeRoles } = require("../middleware/role.middleware");

// Lecture publique (authentifiée optionnellement)
router.get("/:key", optionalAuth, configController.getConfig);
router.get("/", optionalAuth, configController.getAllConfigs);

// Modification restreinte à l'admin et au responsable
router.post("/", auth, authorizeRoles('admin', 'responsableEntrepot', 'responsable'), configController.updateConfig);

module.exports = router;
