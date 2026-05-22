const jwt = require("jsonwebtoken");

/**
 * Middleware d'authentification optionnel flexible.
 * Cherche le token dans les headers Authorization (Bearer) ET dans les cookies.
 * Si un token valide est présent, il peuple req.user.
 * Si absent ou invalide, la requête continue sans bloquer.
 */
module.exports = (req, res, next) => {
    let token = null;
    
    // 1. Chercher dans les headers Authorization (méthode standard API/Frontend)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } 
    // 2. Chercher dans les cookies (méthode HttpOnly)
    else {
        const staffToken = req.cookies?.token;
        const clientToken = req.cookies?.client_token;
        
        if (staffToken || clientToken) {
            const origin = req.headers.origin || req.headers.referer || "";
            const isMarketplaceRoute = req.originalUrl.includes("/api/commandes/client") || 
                                       req.originalUrl.includes("/api/client") ||
                                       req.originalUrl.includes("/api/avis") ||
                                       req.originalUrl.includes("/api/favoris");
            const isFromMarketplaceUI = origin.includes("localhost:3000");
            
            if (isMarketplaceRoute || isFromMarketplaceUI) {
                token = clientToken || staffToken;
            } else {
                token = staffToken || clientToken;
            }
        }
    }

    if (!token) {
        return next(); // Pas de token -> continuer sans user
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;

        // Populate userType for consistency
        if (!req.user.userType) {
            req.user.userType = (token === req.cookies?.client_token) ? 'client' : 'staff';
        }
    } catch (error) {
        // Token invalide -> ignorer silencieusement et continuer
    }

    next();
};
