const express = require('express');
const router = express.Router();
const { 
    logActivity, 
    getActivityLogs, 
    getActivityStats 
} = require('../controllers/systemActivityLog.controller');
const authenticateToken = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');

// All routes require authentication
router.use(authenticateToken);

// Log activity (for manual logging)
router.post('/', logActivity);

// Get activity logs (admin only)
router.get('/', authorizeRoles('admin'), getActivityLogs);

// Get activity statistics (admin only)
router.get('/stats', authorizeRoles('admin'), getActivityStats);

module.exports = router;