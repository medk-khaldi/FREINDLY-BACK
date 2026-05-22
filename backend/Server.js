const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, '.env') });
const connectDB = require("./config/db");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const rateLimit = require("express-rate-limit");
// 🔹 Modèle utilisateur
const User = require("./models/Utilisateur");

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3002',
      'http://127.0.0.1:3002',
    ];

const http = require("http");
const { Server } = require("socket.io");
const setupTrackingSocket = require("./socket/trackingSocket");
const setupMessagingSocket = require("./socket/messagingSocket");
const setupDashboardSocket = require("./socket/dashboardSocket");

// ================== CONNEXION MONGODB & DÉMARRAGE SERVEUR ==================
const startServer = async () => {
  try {
    await connectDB();
    await seedAdmin(); // Seed admin automatique après connexion

    const PORT = process.env.PORT || 5000;
    const server = http.createServer(app);

    // Initialiser Socket.IO globalement
    const io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
      }
    });

    // Configurer les modules Socket
    setupTrackingSocket(io);
    setupMessagingSocket(io);
    setupDashboardSocket(io);

    // Rendre l'instance io accessible aux controllers via req.app.get('io')
    app.set('io', io);

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log("✅ Base de données prête et connectée");
      console.log("🛰️  Real-time tracking system active");
    });
  } catch (error) {
    console.error("❌ Échec du démarrage du serveur:", error.message);
    process.exit(1);
  }
};

// ================== MIDDLEWARE ==================

// ✅ CORS configuré pour les deux frontends en premier
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true
}));

// 🛡️ Securité des headers HTTP avec Helmet
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ⏱️ Rate limiting désactivé (causait des blocages en dev)
// const globalLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 1000,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { message: "Trop de requêtes effectuées depuis cette IP, veuillez réessayer plus tard." }
// });
// app.use("/api", globalLimiter);

// 📦 Limitation de taille des payloads JSON et URL-encoded
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

app.use(cookieParser());

// 🧹 Assainissement des entrées pour bloquer les injections NoSQL
// Workaround for Express 5 where req.query is a read-only getter
app.use((req, res, next) => {
  if (req.query) {
    Object.defineProperty(req, 'query', {
      value: { ...req.query },
      writable: true,
      configurable: true,
      enumerable: true
    });
  }
  if (req.params) {
    Object.defineProperty(req, 'params', {
      value: { ...req.params },
      writable: true,
      configurable: true,
      enumerable: true
    });
  }
  next();
});
app.use(mongoSanitize());

// ✅ Logger simple pour déboguer les requêtes
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ Servir les fichiers statiques (images de produits)
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// ================== SEED ADMIN ==================
async function seedAdmin() {
  try {
    const adminUsername = process.env.ADMIN_USERNAME || "superviseur";
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPasswordRaw = process.env.ADMIN_PASSWORD;

    // Vérifier si un superviseur existe déjà
    const existingAdmin = await User.findOne({ role: "admin" });

    if (existingAdmin) {
      console.log(`✅ Superviseur déjà présent en base : ${existingAdmin.username}`);
      return;
    }

    if (!adminEmail || !adminPasswordRaw) {
      console.warn("⚠️ ADMIN_EMAIL ou ADMIN_PASSWORD non configuré dans .env. Création du superviseur ignorée.");
      return;
    }

    // Créer le superviseur seulement s'il n'existe pas
    const hashedPassword = await bcrypt.hash(adminPasswordRaw, 10);

    const supervisor = new User({
      username: adminUsername,
      email: adminEmail,
      password: hashedPassword,
      role: "admin"
    });

    await supervisor.save();
    console.log("✅ Superviseur créé automatiquement depuis les variables d'environnement");

  } catch (err) {
    console.error("❌ Erreur seed superviseur:", err.message);
  }
}

// ================== ROUTES ==================

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/client/auth", require("./routes/client.routes"));
app.use("/api/pdv/auth", require("./routes/pdvAuth.routes"));
app.use("/api/users", require("./routes/user.routes"));
console.log('🔍 Chargement route stock-consolide...');
try {
  const stockConsolideRouter = require("./routes/stockConsolide");
  app.use("/api/stock-consolide", stockConsolideRouter);
  console.log('✅ Route stock-consolide chargée avec succès');
} catch (error) {
  console.log('❌ Erreur chargement route stock-consolide:', error.message);
}

app.use("/api/produits", require("./routes/produit.routes"));
app.use("/api/commandes", require("./routes/commande.routes"));
app.use("/api/livraisons", require("./routes/livraison.routes"));
app.use("/api/retours", require("./routes/retour.routes"));
app.use("/api/factures", require("./routes/facture.routes"));
app.use("/api/voyages", require("./routes/voyage.routes"));
app.use("/api/stocks", require("./routes/stock.routes"));
app.use("/api/mouvements", require("./routes/mouvement.routes"));
app.use("/api/points-vente", require("./routes/pointDeVente.routes"));
app.use("/api/entrepots", require("./routes/entrepot.routes"));
app.use("/api/categories", require("./routes/categorie.routes"));
app.use("/api/unites", require("./routes/unite.routes"));
app.use("/api/marques", require("./routes/marqueProduit.routes"));
app.use("/api/formats", require("./routes/format.routes"));
app.use("/api/lots", require("./routes/lot.routes"));
app.use("/api/camions", require("./routes/camion.routes"));
app.use("/api/chauffeurs", require("./routes/chauffeur.routes"));
app.use("/api/responsables", require("./routes/responsableEntrepot.routes"));
app.use("/api/notifications", require("./routes/notification.routes"));
app.use("/api/driver-tracking", require("./routes/driverTracking.routes"));
app.use("/api/system-activity", require("./routes/systemActivity.routes"));
app.use("/api/geocoding", require("./routes/geocoding.routes"));
app.use("/api/pdv-stats", require("./routes/pdvStats.routes"));
app.use("/api/favoris", require("./routes/favoris.routes"));
app.use("/api/avis", require("./routes/avis.routes"));
app.use("/api/promotions", require("./routes/promotion.routes"));
app.use("/api/code-promo", require("./routes/codePromo.routes"));
app.use("/api/slides", require("./routes/slide.routes"));
app.use("/api/config", require("./routes/config.routes"));
app.use("/api/messages", require("./routes/messaging.routes"));
app.use("/api/points", require("./routes/points.routes"));
app.use("/api/dashboard", require("./routes/dashboardStats.routes"));
app.use("/api/payment", require("./routes/payment.routes"));

// ================== GLOBAL ERROR HANDLER ==================
app.use((err, req, res, next) => {
  console.error("❌ [GLOBAL ERROR]", req.method, req.url);
  console.error("   Message:", err.message);
  console.error("   Stack:", err.stack?.split('\n').slice(0, 3).join('\n'));
  res.status(err.status || 500).json({
    message: "Erreur serveur interne",
    error: err.message
  });
});

// Lancement du démarrage
startServer();
