const router = require("express").Router();
const controller = require("../controllers/auth.controller");
const { logLogin } = require("../middleware/activityLogger");
const { authLimiter } = require("../middleware/rateLimiter");

// 🔹 Route pour créer un compte utilisateur
router.post("/register", authLimiter, controller.register);

// 🔹 Vérifier l'email avec le code
router.post("/verify-email", authLimiter, controller.verifyEmail);

// 🔹 Renvoyer le code de vérification
router.post("/resend-verification", authLimiter, controller.resendVerificationCode);

// 🔹 Login normal (tous les utilisateurs)
router.post("/login", authLimiter, logLogin, controller.login);

// 🔹 Login admin uniquement (seed superviseur)
router.post("/login-admin", authLimiter, logLogin, controller.loginAdmin);

// 🔹 Mot de passe oublié - Envoie le code
router.post("/forgot-password", authLimiter, controller.forgotPassword);

// 🔹 Vérifier le code de réinitialisation
router.post("/verify-reset-code", authLimiter, controller.verifyResetCode);

// 🔹 Réinitialiser le mot de passe
router.post("/reset-password", authLimiter, controller.resetPassword);

// 🔹 Obtenir l'utilisateur actuel (via cookie)
router.get("/me", controller.getMe);

// 🔹 Mettre à jour le profil
const auth = require("../middleware/auth.middleware");
router.put("/profile", auth, controller.updateProfile);

// 🔹 Changement de mot de passe sécurisé (Admin)
router.post("/admin/request-password-change-code", auth, controller.requestAdminPasswordChangeCode);
router.put("/admin/change-password-secure", auth, controller.changeAdminPasswordSecure);

// 🔹 Changement d'email sécurisé (Admin) - Multi-étapes
router.post("/admin/request-email-change-code", auth, controller.requestAdminEmailChangeCode);
router.post("/admin/verify-current-email-code", auth, controller.verifyCurrentEmailCode);
router.post("/admin/verify-and-request-new", auth, controller.verifyCurrentEmailAndRequestNew);
router.put("/admin/finalize-email-change", auth, controller.finalizeAdminEmailChange);

// 🔹 Logout
router.post("/logout", controller.logout);

module.exports = router;
