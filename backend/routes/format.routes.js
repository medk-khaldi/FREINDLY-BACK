const express = require('express');
const router = express.Router();
const formatController = require('../controllers/format.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

router.get('/', formatController.getAllFormats);
router.post('/', formatController.createFormat);
router.put('/:id', formatController.updateFormat);
router.delete('/:id', formatController.deleteFormat);
router.patch('/:id/restore', formatController.restoreFormat);
router.patch('/:id/lots', formatController.updateFormatLots);

module.exports = router;
