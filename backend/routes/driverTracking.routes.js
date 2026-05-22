const express = require("express");
const router = express.Router();
const driverTrackingController = require("../controllers/driverTracking.controller");
const proteger = require("../middleware/auth.middleware");
const { authorizeRoles: permets } = require("../middleware/role.middleware");

// Toutes les routes sont protégées
router.use(proteger);

// Seuls les admins et responsables peuvent lister tous les chauffeurs actifs
router.get("/active", permets("admin", "responsableEntrepot"), driverTrackingController.getActiveDrivers);

// Un chauffeur peut voir son propre statut (ou un admin)
router.get("/status/:chauffeurId", driverTrackingController.getDriverStatus);

module.exports = router;
