const express = require("express");
const router = express.Router();
const controller = require("../controllers/dashboardStats.controller");
const auth = require("../middleware/auth.middleware");
const { authorizeRoles } = require("../middleware/role.middleware");

router.get("/stats", auth, authorizeRoles("admin", "responsableEntrepot"), controller.getDashboardStats);

module.exports = router;
