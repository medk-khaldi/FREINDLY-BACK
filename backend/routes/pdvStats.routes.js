const express = require('express');
const router = express.Router();
const pdvStatsController = require('../controllers/pdvStats.controller');
const auth = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');

/**
 * @route   GET /api/pdv-stats
 * @desc    Get all PDVs with basic info
 * @access  Admin, Responsable
 */
router.get('/', auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "responsable_entrepot"), pdvStatsController.getAllPDVs);
router.get('/all-with-stats', auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "responsable_entrepot"), pdvStatsController.getAllPDVsWithStats);

/**
 * @route   GET /api/pdv-stats/:id
 * @desc    Get detailed stats for a POS
 * @access  Admin, Responsable
 */
router.get('/:id', auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "responsable_entrepot"), pdvStatsController.getPDVStats);

/**
 * @route   GET /api/pdv-stats/:id/history
 * @desc    Get delivery history for a POS
 * @access  Admin, Responsable
 */
router.get('/:id/history', auth, authorizeRoles("admin", "responsableEntrepot", "responsable", "responsable_entrepot"), pdvStatsController.getPDVHistory);

/**
 * @route   PATCH /api/pdv-stats/:id
 * @desc    Update POS profile classification/limit
 * @access  Admin
 */
router.patch('/:id', auth, authorizeRoles("admin"), pdvStatsController.updatePDVProfile);

/**
 * @route   POST /api/pdv-stats/:id/recalculate
 * @desc    Force recalculate stats for a POS
 * @access  Admin
 */
router.post('/:id/recalculate', auth, authorizeRoles("admin"), pdvStatsController.recalculateStats);

module.exports = router;
