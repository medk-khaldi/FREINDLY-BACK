const rateLimit = require("express-rate-limit");

// 🛡️ Specific rate limiter for sensitive connection-related actions (Brute Force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Tentatives de connexion excessives. Veuillez réessayer dans 15 minutes." }
});

module.exports = {
  authLimiter
};
