const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotion.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');

// Routes publiques (lecture)
router.use(authMiddleware);
router.get('/', promotionController.getAllPromotions);

// Routes protégées pour le Responsable et l'Admin (modifications)
router.use(authorizeRoles('admin', 'responsableEntrepot', 'responsable', 'responsable_entrepot'));

router.post('/', promotionController.createPromotion);
router.delete('/:id', promotionController.deletePromotion);
router.patch('/:id/toggle', promotionController.toggleStatus);
router.put('/:id', promotionController.updatePromotion);

module.exports = router;
