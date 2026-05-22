const jwt = require("jsonwebtoken");
const cookie = require("cookie");

const socketAuthMiddleware = (socket, next) => {
  try {
    // 1. Try to get token from cookies (HttpOnly)
    const cookies = socket.handshake.headers.cookie ? cookie.parse(socket.handshake.headers.cookie) : {};
    const tokenType = socket.handshake.query.tokenType;
    
    // Prioritize client_token if it exists, as staff can always fallback to 'token'
    // This solves the localhost collision where both cookies exist.
    let token;
    if (tokenType === 'client') {
      token = cookies.client_token;
    } else {
      token = cookies.token;
    }

    // 2. Fallback on auth object or query param
    if (!token) {
      token = socket.handshake.auth.token || socket.handshake.query.token;
    }
    
    if (!token) {
      console.error("❌ Socket auth failed: No token provided");
      return next(new Error("Authentication error: No token provided"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Socket auth failed:", err.message);
    return next(new Error("Authentication error: Invalid token"));
  }
};

module.exports = socketAuthMiddleware;
