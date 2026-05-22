exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {

    const userRole = req.user.role?.trim();
    console.log(`[AUTH] Checking roles for user ${req.user?.id}. Role: "${userRole}". Required: ${JSON.stringify(roles)}`);
    if (!roles.includes(userRole)) {
      console.log(`[AUTH] Access denied. "${userRole}" not in ${JSON.stringify(roles)}`);
      return res.status(403).json({
        message: "Accès refusé"
      });
    }
    next();
  };
};