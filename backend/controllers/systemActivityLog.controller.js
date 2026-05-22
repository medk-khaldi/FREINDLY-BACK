const SystemActivityLog = require('../models/SystemActivityLog');
const mongoose = require('mongoose');

// Create activity log entry
const logActivity = async (req, res) => {
    try {
        const { action, resource, resourceId, details } = req.body;
        
        const logEntry = new SystemActivityLog({
            user: req.user.id,
            action,
            resource,
            resourceId,
            details,
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            success: true
        });

        await logEntry.save();
        res.status(201).json({ message: 'Activity logged successfully' });
    } catch (error) {
        console.error('Error logging activity:', error);
        res.status(500).json({ message: 'Error logging activity', error: error.message });
    }
};

// Log error activity
const logError = async (userId, action, resource, errorMessage, req = null) => {
    try {
        const logEntry = new SystemActivityLog({
            user: userId,
            action: action || 'SYSTEM_ERROR',
            resource: resource || 'system',
            details: errorMessage,
            ipAddress: req ? (req.ip || req.connection.remoteAddress) : null,
            userAgent: req ? req.get('User-Agent') : null,
            success: false,
            errorMessage
        });

        await logEntry.save();
    } catch (error) {
        console.error('Error logging error activity:', error);
    }
};

// Get all activity logs with pagination and filters
const getActivityLogs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        // Première étape : récupérer tous les utilisateurs admin et le compte superviseur pour les exclure
        const Utilisateur = mongoose.model('Utilisateur');
        const excludeUsers = await Utilisateur.find({ 
            $or: [
                { role: { $in: ['admin', 'superviseur'] } },
                { username: 'superviseur' }
            ]
        }).select('_id');
        const excludedIds = excludeUsers.map(user => user._id);

        // Build filter object
        const filter = {};
        
        // Exclure les activités des utilisateurs admin/superviseurs
        filter.user = { $nin: excludedIds };
        
        if (req.query.user) {
            // Si on filtre par utilisateur, on garde l'exclusion
            filter.$and = [
                { user: { $nin: excludedIds } },
                { user: req.query.user }
            ];
            delete filter.user;
        }
        
        if (req.query.action) {
            filter.action = req.query.action;
        }
        
        if (req.query.resource) {
            filter.resource = req.query.resource;
        }
        
        if (req.query.success !== undefined) {
            filter.success = req.query.success === 'true';
        }
        
        // Date range filter
        if (req.query.startDate || req.query.endDate) {
            filter.timestamp = {};
            if (req.query.startDate) {
                filter.timestamp.$gte = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filter.timestamp.$lte = new Date(req.query.endDate);
            }
        }

        const logs = await SystemActivityLog.find(filter)
            .populate({ path: 'user', select: 'username email role', options: { withDeleted: true } })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);

        const total = await SystemActivityLog.countDocuments(filter);

        // Define a separate filter for LOGIN specific statistics
        // We use the same date range but force login action
        const loginStatsFilter = { ...filter, action: 'LOGIN' };
        
        // Total number of logins for the period
        const totalLoginsCount = await SystemActivityLog.countDocuments(loginStatsFilter);

        // Count unique users who logged in during the period
        const uniqueLoginsCountArray = await SystemActivityLog.aggregate([
            { $match: loginStatsFilter },
            { $group: { _id: '$user' } },
            { $count: 'count' }
        ]);

        res.json({
            logs,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            },
            totalLoginsCount,
            uniqueUsersCount: uniqueLoginsCountArray[0]?.count || 0
        });
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        res.status(500).json({ message: 'Error fetching activity logs', error: error.message });
    }
};

// Get activity statistics
const getActivityStats = async (req, res) => {
    try {
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const startOfWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        const Utilisateur = mongoose.model('Utilisateur');
        const excludeUsers = await Utilisateur.find({ 
            $or: [
                { role: { $in: ['admin', 'superviseur'] } },
                { username: 'superviseur' }
            ]
        }).select('_id');
        const excludedIds = excludeUsers.map(user => user._id);

        const [todayStats, weekStats, monthStats, actionStats, userStats, loginStatsToday] = await Promise.all([
            // Today's activity (excluding admins)
            SystemActivityLog.aggregate([
                { $match: { 
                    timestamp: { $gte: startOfDay },
                    user: { $nin: excludedIds }
                }},
                { $group: { _id: '$success', count: { $sum: 1 } } }
            ]),
            
            // This week's activity (excluding admins)
            SystemActivityLog.aggregate([
                { $match: { 
                    timestamp: { $gte: startOfWeek },
                    user: { $nin: excludedIds }
                }},
                { $group: { _id: '$action', count: { $sum: 1 } } }
            ]),
            
            // This month's activity (excluding admins)
            SystemActivityLog.aggregate([
                { $match: { 
                    timestamp: { $gte: startOfMonth },
                    user: { $nin: excludedIds }
                }},
                { $group: { _id: '$resource', count: { $sum: 1 } } }
            ]),
            
            // Action distribution (excluding admins)
            SystemActivityLog.aggregate([
                { $match: { user: { $nin: excludedIds } }},
                { $group: { _id: '$action', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            
            // Most active users (excluding admins)
            SystemActivityLog.aggregate([
                { $match: { 
                    timestamp: { $gte: startOfWeek },
                    user: { $nin: excludedIds }
                }},
                { $group: { _id: '$user', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                { $lookup: { from: 'utilisateurs', localField: '_id', foreignField: '_id', as: 'user' } },
                { $unwind: '$user' }
            ]),

            // Unique users who logged in today (excluding admins)
            SystemActivityLog.aggregate([
                { $match: { 
                    timestamp: { $gte: startOfDay },
                    action: 'LOGIN',
                    user: { $nin: excludedIds }
                }},
                { $group: { _id: '$user' } },
                { $count: 'count' }
            ])
        ]);

        res.json({
            today: todayStats,
            week: weekStats,
            month: monthStats,
            actions: actionStats,
            activeUsers: userStats,
            activeUsersToday: loginStatsToday[0]?.count || 0
        });
    } catch (error) {
        console.error('Error fetching activity stats:', error);
        res.status(500).json({ message: 'Error fetching activity stats', error: error.message });
    }
};

// Helper function to log activity (for use in other controllers)
const logUserActivity = async (userId, action, resource, resourceId = null, details = null, req = null) => {
    try {
        const logEntry = new SystemActivityLog({
            user: userId,
            action,
            resource,
            resourceId,
            details,
            ipAddress: req ? (req.ip || req.connection.remoteAddress) : null,
            userAgent: req ? req.get('User-Agent') : null,
            success: true
        });

        await logEntry.save();
    } catch (error) {
        console.error('Error logging user activity:', error);
    }
};

module.exports = {
    logActivity,
    logError,
    getActivityLogs,
    getActivityStats,
    logUserActivity
};