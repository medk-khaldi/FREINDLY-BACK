const express = require('express');
const router = express.Router();
const { uploadPDVDoc } = require('../middleware/upload.middleware');
const pdvAuth = require('../controllers/pdvAuth.controller');
const auth = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimiter');

// Public routes
router.post('/register', authLimiter, uploadPDVDoc.single('document'), pdvAuth.register);
router.post('/logout', pdvAuth.logout);

// Protected routes (requires login as PDV)
router.get('/profile', auth, pdvAuth.getProfile);
router.put('/profile', auth, pdvAuth.updateProfile);
router.put('/cart', auth, pdvAuth.updateCart);

module.exports = router;
