const router = require("express").Router();
const bcrypt = require("bcryptjs");
const auth = require("../middleware/auth.middleware");
const { authorizeRoles } = require("../middleware/role.middleware");
const { uploadAvatar } = require("../middleware/upload.middleware");
const User = require("../models/Utilisateur"); // ton modèle utilisateur

// -------------------------
// 1️⃣ Inscription (tout nouvel utilisateur)
// -------------------------
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Vérifier si email existe
    const existingUserByEmail = await User.findOne({ email });
    if (existingUserByEmail)
      return res.status(400).json({ message: "Email déjà utilisé" });

    // Vérifier si le nom d'utilisateur existe
    const existingUserByUsername = await User.findOne({ username });
    if (existingUserByUsername)
      return res.status(400).json({ message: "Nom d'utilisateur déjà utilisé" });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Role en_attente = compte inactif
    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      role: "en_attente"
    });

    res.status(201).json({
      message: "Compte créé, en attente d'activation",
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const userController = require("../controllers/user.controller");

// -------------------------
// 2️⃣ Liste de TOUS les utilisateurs (pour admin dashboard)
// -------------------------
router.get("/", auth, authorizeRoles("admin", "responsableEntrepot"), userController.getAllUsers);

// -------------------------
// 2️⃣.1️⃣ Supprimer un utilisateur (soft delete)
// -------------------------
router.delete("/:id", auth, authorizeRoles("admin"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });
    await user.softDelete();
    res.json({ message: "Utilisateur supprimé avec succès (soft delete)" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------
// 2️⃣.2️⃣ Restaurer un utilisateur
// -------------------------
router.patch("/:id/restore", auth, authorizeRoles("admin"), userController.restoreUser);

// -------------------------
// 3️⃣ Liste utilisateurs en attente (role: null)
// -------------------------
router.get("/pending", auth, authorizeRoles("admin", "responsableEntrepot"), async (req, res) => {
  try {
    const users = await User.find({ role: "en_attente" });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------
// 4️⃣ Assignation rôle
// -------------------------
router.patch("/:id/assign-role", auth, authorizeRoles("admin", "responsableEntrepot"), async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.params.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });
    if (user.role && user.role !== "en_attente") return res.status(400).json({ message: "Utilisateur déjà activé" });

    const currentUser = req.user; // depuis auth.middleware

    // Vérifier la hiérarchie
    if (currentUser.role === "responsableEntrepot" && role !== "chauffeur") {
      return res.status(403).json({ message: "ResponsableEntrepot peut assigner seulement le rôle Chauffeur" });
    }

    if (role === "admin") {
      return res.status(403).json({ message: "Impossible de créer un autre admin" });
    }

    user.role = role;
    await user.save();

    res.json({ message: `Rôle '${role}' assigné à ${user.username}`, user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// -------------------------
// 5️⃣ Création utilisateur par admin (ex: responsable ou chauffeur)
// -------------------------
router.post(
  "/create",
  auth,
  authorizeRoles("admin", "responsableEntrepot"), // admin ou responsable
  async (req, res) => {
    try {
      let { username, email, password, role } = req.body;

      // Interdire la création d'un admin par qui que ce soit
      if (role === "admin") {
        return res.status(403).json({ message: "Impossible de créer un autre admin" });
      }

      const currentUser = req.user;

      // ResponsableEntrepot ne peut créer que des chauffeurs
      if (currentUser.role === "responsableEntrepot" && role !== "chauffeur") {
        return res.status(403).json({ message: "ResponsableEntrepot peut créer seulement des chauffeurs" });
      }

      // Vérifier si email existe
      const existingUserByEmail = await User.findOne({ email });
      if (existingUserByEmail) {
        return res.status(400).json({ message: "Email déjà utilisé" });
      }

      // Vérifier si le nom d'utilisateur existe
      const existingUserByUsername = await User.findOne({ username });
      if (existingUserByUsername) {
        return res.status(400).json({ message: "Nom d'utilisateur déjà utilisé" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await User.create({
        username,
        email,
        password: hashedPassword,
        role // le rôle est assigné directement pour création par admin/responsable
      });

      res.status(201).json({
        message: "Utilisateur créé avec succès",
        user: {
          id: newUser._id,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// -------------------------
// 6️⃣ Mise à jour utilisateur
// -------------------------
router.put(
  "/:id",
  auth,
  authorizeRoles("admin", "responsableEntrepot"),
  async (req, res) => {
    try {
      const { username, email, password } = req.body;
      const updateData = {};
      
      if (username) {
        // Vérifier si le nom d'utilisateur est déjà utilisé par un autre utilisateur
        const existingUserByUsername = await User.findOne({ 
          username, 
          _id: { $ne: req.params.id } 
        });
        if (existingUserByUsername) {
          return res.status(400).json({ message: "Nom d'utilisateur déjà utilisé" });
        }
        updateData.username = username;
      }
      
      if (email) {
        // Vérifier si l'email est déjà utilisé par un autre utilisateur
        const existingUserByEmail = await User.findOne({ 
          email, 
          _id: { $ne: req.params.id } 
        });
        if (existingUserByEmail) {
          return res.status(400).json({ message: "Email déjà utilisé" });
        }
        updateData.email = email;
      }
      
      // Si un nouveau mot de passe est fourni, le hasher
      if (password) {
        const hash = await bcrypt.hash(password, 10);
        updateData.password = hash;
      }
      
      const utilisateur = await User.findByIdAndUpdate(
        req.params.id, 
        updateData, 
        { new: true, runValidators: true }
      ).select("-password");
      
      if (!utilisateur) {
        return res.status(404).json({ message: "Utilisateur introuvable" });
      }
      
      res.json(utilisateur);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur", error: err.message });
    }
  }
);

// -------------------------
// 7️⃣ Mettre à jour la photo de profil (soi-même)
// -------------------------
router.put("/profile/image", auth, uploadAvatar.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier envoyé" });
    }

    const imageUrl = `/uploads/avatars/${req.file.filename}`;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });

    user.profileImage = imageUrl;
    await user.save();

    res.json({ 
      message: "Photo de profil mise à jour", 
      profileImage: imageUrl,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
