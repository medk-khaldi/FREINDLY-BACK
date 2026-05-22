const express = require('express');
const router = express.Router();
const clientAuth = require('../controllers/clientAuth.controller');
const adminClient = require('../controllers/adminClient.controller');
const auth = require('../middleware/auth.middleware');
const { authorizeRoles } = require("../middleware/role.middleware");
const { authLimiter } = require('../middleware/rateLimiter');

// Public routes
router.post('/register', authLimiter, clientAuth.register);
router.post('/verify-email', authLimiter, clientAuth.verifyEmail);
router.post('/resend-code', authLimiter, clientAuth.resendCode);
router.post('/login', authLimiter, clientAuth.login);
router.get('/me', clientAuth.getMe);
router.post('/logout', clientAuth.logout);
router.post('/forgot-password', authLimiter, clientAuth.forgotPassword);
router.post('/verify-reset-code', authLimiter, clientAuth.verifyResetCode);
router.post('/reset-password', authLimiter, clientAuth.resetPassword);

// Protected routes (requires login as Client)
router.get('/profile', auth, clientAuth.getProfile);
router.put('/profile', auth, clientAuth.updateProfile);
router.put('/cart', auth, clientAuth.updateCart);

// Admin routes (requires Admin or ResponsableEntrepot role)
router.get('/admin/all', auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "RESPONSABLE"), adminClient.getAllClients);
router.get('/admin/:id', auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "RESPONSABLE"), adminClient.getClientById);
router.put('/admin/:id', auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "RESPONSABLE"), adminClient.updateClient);
router.patch('/admin/:id/toggle-status', auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "RESPONSABLE"), adminClient.toggleClientStatus);

module.exports = router;
