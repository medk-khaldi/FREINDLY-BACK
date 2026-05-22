const express = require("express");
const router = express.Router();
const PaymentController = require("../controllers/payment.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");

router.use(optionalAuth);

// Créer un PaymentIntent Stripe
router.post("/create-payment-intent", PaymentController.createPaymentIntent);

// Confirmer le paiement et créer la commande
router.post("/confirm", PaymentController.confirmPayment);

module.exports = router;
