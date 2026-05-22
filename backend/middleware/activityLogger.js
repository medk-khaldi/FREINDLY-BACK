const { logUserActivity, logError } = require('../controllers/systemActivityLog.controller');

// Middleware to automatically log user activities
const logActivity = (action, resource) => {
    return (req, res, next) => {
        // Store original res.json to intercept response
        const originalJson = res.json;
        
        res.json = function(data) {
            // Log activity after successful response
            if (req.user && res.statusCode < 400) {
                const resourceId = data?._id || data?.id || req.params.id;
                const details = getActivityDetails(action, resource, data, req);
                
                logUserActivity(
                    req.user.id,
                    action,
                    resource,
                    resourceId,
                    details,
                    req
                ).catch(err => {
                    console.error('Failed to log activity:', err);
                });
            } else if (req.user && res.statusCode >= 400) {
                // Log error activity
                logError(
                    req.user.id,
                    action,
                    resource,
                    data?.message || 'Unknown error',
                    req
                ).catch(err => {
                    console.error('Failed to log error activity:', err);
                });
            }
            
            // Call original json method
            return originalJson.call(this, data);
        };
        
        next();
    };
};

// Generate activity details based on action and resource
const getActivityDetails = (action, resource, data, req) => {
    switch (action) {
        case 'CREATE':
            return `Création de ${resource}: ${getResourceName(resource, data)}`;
        case 'UPDATE':
            return `Modification de ${resource}: ${getResourceName(resource, data)}`;
        case 'DELETE':
            return `Suppression de ${resource}: ${req.params.id}`;
        case 'VIEW':
            return `Consultation de ${resource}`;
        default:
            return `Action ${action} sur ${resource}`;
    }
};

// Get a human-readable name for the resource
const getResourceName = (resource, data) => {
    switch (resource) {
        case 'commande':
            return data?.id_formate || data?._id || 'commande';
        case 'livraison':
            return data?.id_formate || data?._id || 'livraison';
        case 'voyage':
            return data?.id_formate || data?._id || 'voyage';
        case 'produit':
            return data?.nom || data?._id || 'produit';
        case 'stock':
            return `${data?.produit?.nom || 'produit'} - ${data?.entrepot?.nom || 'entrepôt'}`;
        case 'user':
            return data?.username || data?.email || data?._id || 'utilisateur';
        default:
            return data?.nom || data?.username || data?._id || resource;
    }
};

// Log login activity
const logLogin = async (req, res, next) => {
    // Store original res.json to intercept response
    const originalJson = res.json;
    
    res.json = function(data) {
        // Log login activity after successful authentication
        // Note: data.token was removed after HttpOnly cookie migration, check only data.user
        if (data.user) {
            logUserActivity(
                data.user.id,
                'LOGIN',
                'user',
                data.user.id,
                `Connexion réussie`,
                req
            ).catch(err => {
                console.error('Failed to log login activity:', err);
            });
        }
        
        // Call original json method
        return originalJson.call(this, data);
    };
    
    next();
};

// Log logout activity
const logLogout = async (req, res, next) => {
    if (req.user) {
        try {
            await logUserActivity(
                req.user.id,
                'LOGOUT',
                'user',
                req.user.id,
                'Déconnexion',
                req
            );
        } catch (err) {
            console.error('Failed to log logout activity:', err);
        }
    }
    next();
};

module.exports = {
    logActivity,
    logLogin,
    logLogout
};