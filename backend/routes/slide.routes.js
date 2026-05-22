const express = require('express');
const router = express.Router();
const slideController = require('../controllers/slide.controller');
const auth = require('../middleware/auth.middleware');
const { uploadSlide } = require('../middleware/upload.middleware');

// Public routes (for marketplace)
router.get('/active', slideController.getActiveSlides);

// Protected routes (for admin)
router.get('/', auth, slideController.getAllSlides);
router.post('/', auth, uploadSlide.single('image'), slideController.createSlide);
router.put('/:id', auth, uploadSlide.single('image'), slideController.updateSlide);
router.delete('/:id', auth, slideController.deleteSlide);
router.patch('/:id/toggle', auth, slideController.toggleSlideStatus);
router.put('/reorder', auth, slideController.reorderSlides);

module.exports = router;
