const socketAuthMiddleware = require('../middleware/socketAuth.middleware');

const setupDashboardSocket = (io) => {
  console.log("🛰️  Dashboard Socket setup started");
  const dashboardNamespace = io.of("/dashboard");

  dashboardNamespace.use(socketAuthMiddleware);

  dashboardNamespace.on("connection", (socket) => {
    const userId = socket.user.id;
    const role = socket.user.role;
    console.log(`📡 User connected to dashboard: ${userId} (${role})`);

    // Join room based on role
    if (role === 'admin') {
      socket.join('admins');
      socket.join('staff');
    } else if (role === 'responsableEntrepot' || role === 'responsable') {
      socket.join('responsables');
      socket.join('staff');
    } else if (role === 'chauffeur') {
      socket.join('chauffeurs');
    } else if (role === 'client' || role === 'pdv') {
      socket.join('clients');
    }

    // Individual room for targeted notifications/events
    socket.join(`user_${userId}`);

    socket.on("disconnect", () => {
      console.log(`🔌 User disconnected from dashboard: ${userId}`);
    });
  });
};

module.exports = setupDashboardSocket;
