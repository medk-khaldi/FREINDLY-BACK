const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");
const authenticateToken = require("../middleware/auth.middleware");

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// Créer une notification
router.post("/", notificationController.createNotification);

// Obtenir les notifications d'un utilisateur
router.get("/user/:userId", notificationController.getUserNotifications);

// Marquer une notification comme lue
router.put("/:notificationId/read", notificationController.markAsRead);

// Marquer toutes les notifications comme lues pour un utilisateur
router.put("/user/:userId/read-all", notificationController.markAllAsRead);

// Supprimer une notification
router.delete("/:notificationId", notificationController.deleteNotification);

module.exports = router;