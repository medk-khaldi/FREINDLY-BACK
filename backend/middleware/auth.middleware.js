const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  // 1. Get all possible tokens
  const authHeader = req.headers.authorization;
  const bearerToken = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.substring(7) : null;
  const staffToken = req.cookies.token;
  const clientToken = req.cookies.client_token;

  let token = null;

  // 2. Priority Logic
  if (bearerToken) {
    // Bearer token (usually from mobile or explicit API calls) always wins
    token = bearerToken;
  } else {
    // Intelligent cookie selection
    const origin = req.headers.origin || req.headers.referer || "";
    const isAdminClientRoute = req.originalUrl.includes("/api/client/auth/admin");
    const isMarketplaceRoute = !isAdminClientRoute && (
                               req.originalUrl.startsWith("/api/client") || 
                               req.originalUrl.startsWith("/api/pdv/auth") || 
                               req.originalUrl.startsWith("/api/avis") || 
                               req.originalUrl.startsWith("/api/favoris"));
    const isFromMarketplaceUI = origin.includes("localhost:3000");

    if (isMarketplaceRoute || isFromMarketplaceUI) {

      // Favor client token if we are on a client route or coming from marketplace UI
      token = clientToken || staffToken;
    } else {
      // Favor staff token otherwise (Admin Dashboard)
      token = staffToken || clientToken;
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Token manquant, veuillez vous connecter" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    
    // Default userType for backward compatibility
    if (!req.user.userType) {
      req.user.userType = (token === clientToken) ? 'client' : 'staff';
    }
    
    next();
  } catch (error) {
    res.status(401).json({ message: "Token invalide ou expiré" });
  }
};
