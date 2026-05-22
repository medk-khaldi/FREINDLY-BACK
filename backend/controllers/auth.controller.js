const User = require("../models/Utilisateur");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateVerificationCode, sendVerificationEmail, sendPasswordResetEmail } = require("../utils/emailService");
const notificationController = require("./notification.controller");

// 🔹 REGISTER avec envoi de code de vérification
exports.register = async (req, res) => {
  try {
    const { username, email, password, role = "en_attente" } = req.body;

    // Vérifier si l'email existe déjà
    const existingUserByEmail = await User.findOne({ email });
    if (existingUserByEmail) {
      if (existingUserByEmail.isEmailVerified === false) {
        // Supprimer l'ancien compte non vérifié pour permettre la ré-inscription
        await User.deleteOne({ _id: existingUserByEmail._id });
      } else {
        return res.status(400).json({ message: "Email déjà utilisé" });
      }
    }

    // Vérifier si le nom d'utilisateur existe déjà
    const existingUserByUsername = await User.findOne({ username });
    if (existingUserByUsername)
      return res.status(400).json({ message: "Nom d'utilisateur déjà utilisé" });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Générer un code de vérification
    const verificationCode = generateVerificationCode();
    const verificationCodeExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role,
      isEmailVerified: false,
      verificationCode,
      verificationCodeExpires
    });

    // Envoyer l'email de vérification
    const emailSent = await sendVerificationEmail(email, username, verificationCode);
    
    if (!emailSent) {
      return res.status(500).json({ 
        message: "Compte créé mais erreur d'envoi d'email. Contactez l'administrateur." 
      });
    }

    res.status(201).json({ 
      message: "Compte créé avec succès. Vérifiez votre email pour le code de vérification.",
      userId: user._id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 VERIFY EMAIL avec code
exports.verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Utilisateur introuvable" });

    if (user.isEmailVerified)
      return res.status(400).json({ message: "Email déjà vérifié" });

    if (user.verificationCode !== code)
      return res.status(400).json({ message: "Code de vérification incorrect" });

    if (new Date() > user.verificationCodeExpires)
      return res.status(400).json({ message: "Code de vérification expiré" });

    // Marquer l'email comme vérifié
    user.isEmailVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;
    await user.save();

    // NOTIFY ADMINS
    await notificationController.notifyNewRegistration(user, 'STAFF');

    res.json({ message: "Email vérifié avec succès. Votre compte est en attente de validation par l'administrateur." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 RESEND VERIFICATION CODE
exports.resendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Utilisateur introuvable" });

    if (user.isEmailVerified)
      return res.status(400).json({ message: "Email déjà vérifié" });

    // Générer un nouveau code
    const verificationCode = generateVerificationCode();
    const verificationCodeExpires = new Date(Date.now() + 15 * 60 * 1000);

    user.verificationCode = verificationCode;
    user.verificationCodeExpires = verificationCodeExpires;
    await user.save();

    // Envoyer l'email
    const emailSent = await sendVerificationEmail(email, user.username, verificationCode);
    
    if (!emailSent) {
      return res.status(500).json({ message: "Erreur d'envoi d'email" });
    }

    res.json({ message: "Nouveau code de vérification envoyé" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 LOGIN normal (pour tous les utilisateurs SAUF admin) - Vérifie que l'email est vérifié SEULEMENT pour les nouveaux comptes
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Utilisateur introuvable" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Mot de passe incorrect" });

    // ✅ Bloquer les comptes en attente de rôle
    if (user.role === "en_attente") {
      return res.status(403).json({ 
        message: "Votre compte est en attente de validation par un administrateur." 
      });
    }

    // ✅ Bloquer les admins sur la connexion normale
    if (user.role === "admin") {
      return res.status(403).json({ 
        message: "Les administrateurs doivent utiliser l'interface de connexion admin.",
        isAdmin: true
      });
    }

    // Vérifier si l'email est vérifié SEULEMENT si le champ isEmailVerified existe
    // Les anciens comptes n'ont pas ce champ, donc on les laisse passer
    if (user.isEmailVerified === false) {
      // Le champ existe et est false = nouveau compte non vérifié
      return res.status(403).json({ 
        message: "Email non vérifié. Vérifiez votre boîte mail pour le code de vérification.",
        emailNotVerified: true
      });
    }
    // Si isEmailVerified est undefined (anciens comptes) ou true (vérifiés), on continue

    // ✅ Génération JWT
    const token = jwt.sign(
      { id: user._id, role: user.role, username: user.username, email: user.email, userType: 'staff' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // ✅ Set Cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      message: "Connexion réussie",
      user: {
        id: user._id,
        username: user.username,
        nom: user.nom || "",
        prenom: user.prenom || "",
        email: user.email,
        role: user.role,
        userType: 'staff',
        profileImage: user.profileImage,
        favoris: user.favoris || [],
        createdAt: user.createdAt || user._id.getTimestamp()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 LOGOUT
exports.logout = (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production"
  });
  res.json({ message: "Déconnexion réussie" });
};

// 🔹 FORGOT PASSWORD - Envoie un code de réinitialisation
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    console.log('🔐 Demande de réinitialisation pour:', email);

    const user = await User.findOne({ email });
    if (!user) {
      console.log('❌ Utilisateur non trouvé:', email);
      return res.status(400).json({ message: "Aucun compte associé à cet email" });
    }

    console.log('✅ Utilisateur trouvé:', user.username);

    // Générer un code de réinitialisation
    const resetCode = generateVerificationCode();
    const resetCodeExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    console.log('🔢 Code de réinitialisation généré:', resetCode);

    user.resetPasswordCode = resetCode;
    user.resetPasswordCodeExpires = resetCodeExpires;
    await user.save();

    console.log('💾 Code sauvegardé dans la base de données');

    // Envoyer l'email
    console.log('📧 Tentative d\'envoi d\'email à:', email);
    const emailSent = await sendPasswordResetEmail(email, user.username, resetCode);
    
    if (!emailSent) {
      console.error('❌ Échec de l\'envoi de l\'email de réinitialisation');
      return res.status(500).json({ message: "Erreur d'envoi d'email" });
    }

    console.log('✅ Email de réinitialisation envoyé avec succès');
    res.json({ message: "Code de réinitialisation envoyé à votre email" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 VERIFY RESET CODE
exports.verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Utilisateur introuvable" });

    if (user.resetPasswordCode !== code)
      return res.status(400).json({ message: "Code de réinitialisation incorrect" });

    if (new Date() > user.resetPasswordCodeExpires)
      return res.status(400).json({ message: "Code de réinitialisation expiré" });

    res.json({ message: "Code vérifié. Vous pouvez maintenant réinitialiser votre mot de passe." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 RESET PASSWORD
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Utilisateur introuvable" });

    if (user.resetPasswordCode !== code)
      return res.status(400).json({ message: "Code de réinitialisation incorrect" });

    if (new Date() > user.resetPasswordCodeExpires)
      return res.status(400).json({ message: "Code de réinitialisation expiré" });

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    user.resetPasswordCode = undefined;
    user.resetPasswordCodeExpires = undefined;
    await user.save();

    res.json({ message: "Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 LOGIN ADMIN (uniquement seed admin / superviseur)
exports.loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Utilisateur introuvable" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Mot de passe incorrect" });

    // ✅ Vérification rôle admin
    if (user.role === "en_attente") {
      return res.status(403).json({ message: "Votre compte est en attente de validation par un administrateur." });
    }
    
    if (user.role !== "admin") {
      return res.status(403).json({ message: "Seul le superviseur peut se connecter ici" });
    }

    // ✅ Génération JWT
    const token = jwt.sign(
      { id: user._id, role: user.role, username: user.username, email: user.email, userType: 'staff' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // ✅ Set Cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      message: "Connexion admin réussie",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
        createdAt: user.createdAt || user._id.getTimestamp()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 VERIFIER LA SESSION (Get current user)
exports.getMe = async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Default to staff/Utilisateur
    const user = await User.findById(decoded.id).select("-password");
    
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    return res.json({
      user: {
        id: user._id,
        username: user.username,
        nom: user.nom || "",
        prenom: user.prenom || "",
        email: user.email,
        role: user.role,
        userType: 'staff',
        profileImage: user.profileImage,
        favoris: user.favoris || [],
        createdAt: user.createdAt || user._id.getTimestamp()
      }
    });
  } catch (error) {
    res.status(401).json({ message: "Session invalide ou expirée" });
  }
};

/**
 * Mettre à jour le profil (staff)
 */
exports.updateProfile = async (req, res) => {
  try {
    const { nom, prenom, profileImage } = req.body;
    const user = await Utilisateur.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    if (nom !== undefined) user.nom = nom;
    if (prenom !== undefined) user.prenom = prenom;
    if (profileImage !== undefined) user.profileImage = profileImage;

    await user.save();

    res.json({
      message: "Profil mis à jour avec succès",
      user: {
        id: user._id,
        username: user.username,
        nom: user.nom || "",
        prenom: user.prenom || "",
        email: user.email,
        role: user.role,
        userType: 'staff',
        profileImage: user.profileImage
      }
    });
  } catch (err) {
    console.error("❌ Erreur updateProfile staff:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Demander un code de changement de mot de passe (Admin Sécurisé)
 */
exports.requestAdminPasswordChangeCode = async (req, res) => {
  try {
    const { email } = req.body;
    const adminId = req.user.id;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Accès refusé" });
    }

    if (admin.email !== email) {
      return res.status(400).json({ message: "L'email ne correspond pas à votre compte administrateur" });
    }

    // Générer un code
    const code = generateVerificationCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    admin.verificationCode = code;
    admin.verificationCodeExpires = expires;
    await admin.save();

    // Envoyer l'email
    const emailSent = await sendVerificationEmail(email, admin.username, code);
    
    if (!emailSent) {
      return res.status(500).json({ message: "Erreur lors de l'envoi du code de sécurité" });
    }

    res.json({ message: "Code de sécurité envoyé avec succès" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Vérifier le code et changer le mot de passe (Admin Sécurisé)
 */
exports.changeAdminPasswordSecure = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const adminId = req.user.id;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Accès refusé" });
    }

    if (admin.email !== email) {
      return res.status(400).json({ message: "Email incorrect" });
    }

    if (admin.verificationCode !== code || new Date() > admin.verificationCodeExpires) {
      return res.status(400).json({ message: "Code invalide ou expiré" });
    }

    // Mettre à jour le mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    admin.password = hashedPassword;
    admin.verificationCode = undefined;
    admin.verificationCodeExpires = undefined;
    await admin.save();

    res.json({ message: "Mot de passe administrateur mis à jour avec succès" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * ÉTAPE 1: Demander un code sur l'email ACTUEL
 * Vérifie l'email et le mot de passe actuels
 */
exports.requestAdminEmailChangeCode = async (req, res) => {
  try {
    const { email, password } = req.body;
    const adminId = req.user.id;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Accès refusé" });
    }

    if (admin.email !== email) {
      return res.status(400).json({ message: "L'email ne correspond pas à votre compte actuel" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Mot de passe actuel incorrect" });
    }

    const code = generateVerificationCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    admin.verificationCode = code;
    admin.verificationCodeExpires = expires;
    await admin.save();

    await sendVerificationEmail(email, admin.username, code);
    
    res.json({ message: "Code de vérification envoyé à votre email actuel" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * ÉTAPE 1.5: Vérifier simplement si le code 1 est valide
 */
exports.verifyCurrentEmailCode = async (req, res) => {
  try {
    const { code } = req.body;
    const adminId = req.user.id;
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") return res.status(403).json({ message: "Accès refusé" });
    if (admin.verificationCode !== code || new Date() > admin.verificationCodeExpires) {
      return res.status(400).json({ message: "Code de vérification actuel invalide ou expiré" });
    }
    res.json({ message: "Code valide" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * ÉTAPE 2: Vérifier le code 1 et envoyer un code 2 au NOUVEL email
 */
exports.verifyCurrentEmailAndRequestNew = async (req, res) => {
  try {
    const { email, code, newEmail } = req.body;
    const adminId = req.user.id;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // Vérifier le premier code
    if (admin.verificationCode !== code || new Date() > admin.verificationCodeExpires) {
      return res.status(400).json({ message: "Code de vérification actuel invalide ou expiré" });
    }

    // Vérifier si le nouvel email est déjà utilisé
    const existingUser = await User.findOne({ email: newEmail });
    if (existingUser) {
      return res.status(400).json({ message: "Ce nouvel email est déjà utilisé par un autre compte" });
    }

    // Générer un second code pour le NOUVEL email
    const secondCode = generateVerificationCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    admin.pendingEmail = newEmail;
    admin.verificationCode = secondCode;
    admin.verificationCodeExpires = expires;
    await admin.save();

    // Envoyer l'email au NOUVEAU compte
    await sendVerificationEmail(newEmail, admin.username, secondCode);

    res.json({ message: "Code de confirmation envoyé à votre nouvelle adresse email" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * ÉTAPE 3: Confirmer le code 2 et finaliser le changement
 */
exports.finalizeAdminEmailChange = async (req, res) => {
  try {
    const { code } = req.body;
    const adminId = req.user.id;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "admin" || !admin.pendingEmail) {
      return res.status(400).json({ message: "Aucune demande de changement d'email en cours" });
    }

    if (admin.verificationCode !== code || new Date() > admin.verificationCodeExpires) {
      return res.status(400).json({ message: "Code de confirmation du nouvel email invalide ou expiré" });
    }

    // Finaliser le changement
    const oldEmail = admin.email;
    admin.email = admin.pendingEmail;
    admin.pendingEmail = undefined;
    admin.verificationCode = undefined;
    admin.verificationCodeExpires = undefined;
    await admin.save();

    res.json({ 
      message: "Email administrateur mis à jour avec succès",
      newEmail: admin.email
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

