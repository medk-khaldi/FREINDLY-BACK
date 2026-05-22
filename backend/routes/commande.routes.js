const express = require("express");
const router = express.Router();
const CommandeController = require("../controllers/commande.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");

router.use(optionalAuth);

// Créer commande Marketplace (Client)
router.post("/client", CommandeController.passerCommandeClient);

// 🔹 Récupérer les commandes de l'utilisateur connecté (Doit être avant /:commandeId)
const auth = require("../middleware/auth.middleware");
router.get("/mes-commandes", auth, CommandeController.getMesCommandes);
router.patch("/:id/confirmer-reception", auth, CommandeController.confirmerReception);

// Créer commande (Interne / PDV)
router.post("/", (req, res, next) => {
    console.log('\n🚨🚨🚨 ROUTE POST /api/commandes APPELÉE 🚨🚨🚨');
    console.log('📥 Body reçu:', JSON.stringify(req.body, null, 2));
    console.log('🍪 Cookies:', req.cookies);
    console.log('👤 User:', req.user);
    next();
}, CommandeController.creerCommande);

// Modifier commande
router.put("/:commandeId", CommandeController.modifierCommande);

// Préparer commande
router.patch("/:commandeId/preparer", CommandeController.preparerCommande);

// Annuler commande
router.patch("/:commandeId/annuler", CommandeController.annulerCommande);

// Lister toutes les commandes
router.get("/", CommandeController.listerCommandes);

// Recalculer les statuts de toutes les commandes
router.post("/recalculer-statuts", CommandeController.recalculerStatuts);

// 🔹 Récupérer une commande par ID
router.get("/:commandeId", CommandeController.getById);

module.exports = router;
