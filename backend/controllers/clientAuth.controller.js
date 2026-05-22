const Client = require("../models/Client");
const PointDeVente = require("../models/PointDeVente");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateVerificationCode, sendVerificationEmail, sendPasswordResetEmail } = require("../utils/emailService");
const notificationController = require("./notification.controller");

// 🔹 REGISTER CLIENT
exports.register = async (req, res) => {
  try {
    const { nom, prenom, email, password, telephone, genre, dateNaissance, adresse } = req.body;

    // Check if email already exists and is verified
    const existingClient = await Client.findOne({ email });
    const existingPDV = await PointDeVente.findOne({ email });
    
    if (existingClient || existingPDV) {
      const isVerified = (existingClient && existingClient.isEmailVerified) || (existingPDV && existingPDV.isEmailVerified);
      
      if (isVerified) {
        return res.status(400).json({ message: "Cet email est déjà utilisé et vérifié." });
      }
      
      // If the account exists but is NOT verified, we allow re-registration by removing the pending one
      if (existingClient) await Client.deleteOne({ _id: existingClient._id });
      if (existingPDV) await PointDeVente.deleteOne({ _id: existingPDV._id });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const client = await Client.create({
      nom,
      prenom,
      email,
      password: hashedPassword,
      telephone,
      genre,
      dateNaissance,
      isEmailVerified: false,
      emailVerificationCode: verificationCode,
      emailVerificationExpires: verificationExpires,
      isActive: true,
      adresses: adresse && (adresse.gouvernorat || (adresse.latitude && adresse.longitude)) ? [{
        label: 'Adresse enregistrée',
        gouvernorat: adresse.gouvernorat || 'Sélectionné sur la carte',
        delegation: adresse.delegation || '',
        localite: adresse.localite || '',
        rue: adresse.rue || 'Point sur la carte',
        codePostal: adresse.codePostal || '',
        isDefault: true,
        latitude: adresse.latitude ? Number(adresse.latitude) : undefined,
        longitude: adresse.longitude ? Number(adresse.longitude) : undefined
      }] : []
    });

    // Envoyer l'email de vérification
    await sendVerificationEmail(email, prenom, verificationCode);

    res.status(201).json({
      message: "Compte créé. Veuillez vérifier votre email.",
      email: client.email
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 VERIFY EMAIL
exports.verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    // Chercher dans Client ou PDV
    let user = await Client.findOne({ email });
    let userType = 'client';

    if (!user) {
      user = await PointDeVente.findOne({ email });
      userType = 'pdv';
    }

    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: "Cet email est déjà vérifié." });
    }

    if (user.emailVerificationCode !== code || user.emailVerificationExpires < Date.now()) {
      return res.status(400).json({ message: "Code invalide ou expiré." });
    }

    user.isEmailVerified = true;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    // 🎯 FIDÉLITÉ: Bonus de bienvenue (Seulement pour Client)
    if (userType === 'client') {
      try {
        const { earnPoints, getPointsConfig } = require('../services/pointsService');
        const config = await getPointsConfig();
        await earnPoints(user._id, config.bonusInscription || 100, `Cadeau de bienvenue 🎁`);
      } catch (pointsErr) {
        console.error('❌ Erreur points bienvenue:', pointsErr);
      }

      // Auto-login for Client
      const token = jwt.sign(
        { id: user._id, role: 'client', userType: 'client', email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      res.cookie("client_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1000
      });

      return res.status(200).json({
        message: "Email vérifié avec succès. Bienvenue !",
        user: {
          id: user._id,
          nom: user.nom,
          prenom: user.prenom,
          email: user.email,
          role: 'client',
          userType: 'client'
        }
      });
    } else {
      // For PDV, wait for admin approval
      // NOTIFY ADMINS
      await notificationController.notifyNewRegistration(user, 'PDV');

      return res.status(200).json({
        message: "Email vérifié. Votre compte est en attente d'approbation par l'administration.",
        needsApproval: true
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 RESEND VERIFICATION CODE
exports.resendCode = async (req, res) => {
  try {
    const { email } = req.body;
    
    let user = await Client.findOne({ email });
    if (!user) user = await PointDeVente.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: "Cet email est déjà vérifié." });
    }

    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    user.emailVerificationCode = verificationCode;
    user.emailVerificationExpires = verificationExpires;
    await user.save();

    await sendVerificationEmail(email, user.prenom || user.nom, verificationCode);

    res.json({ message: "Nouveau code envoyé." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 LOGIN UNIFIÉ (Client & PDV)
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Chercher dans Client
    let user = await Client.findOne({ email });
    let userType = 'client';

    if (user) {
      if (!user.isEmailVerified) {
        return res.status(403).json({ 
          message: "Veuillez vérifier votre email.",
          needsVerification: true,
          email: user.email
        });
      }
    }

    // 2. Chercher dans PDV si non trouvé
    if (!user) {
      user = await PointDeVente.findOne({ email });
      userType = 'pdv';

      if (user) {
        if (!user.isEmailVerified) {
          return res.status(403).json({ 
            message: "Veuillez vérifier votre email.",
            needsVerification: true,
            email: user.email
          });
        }
        if (user.statut_validation !== 'APPROUVE') {
          return res.status(403).json({ message: "Votre compte est en attente d'approbation par l'administration." });
        }
      }
    }

    if (!user) {
      return res.status(400).json({ message: "Identifiants incorrects." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Identifiants incorrects." });
    }

    if (userType === 'client' && !user.isActive) {
      return res.status(403).json({ message: "Votre compte est désactivé." });
    }
    
    if (userType === 'pdv' && !user.actif) {
      return res.status(403).json({ message: "Votre compte est désactivé." });
    }

    // Update last login
    user.lastLogin = Date.now();
    await user.save();

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, role: userType, userType, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Set Cookie
    res.cookie("client_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      message: "Connexion réussie",
      user: {
        id: user._id,
        nom: user.nom,
        prenom: user.prenom || "",
        email: user.email,
        telephone: user.telephone,
        role: userType,
        userType: userType,
        adresses: user.adresses || [],
        favoris: user.favoris || [],
        responsable_nom: user.responsable_nom || "",
        adresse: user.adresse || "",
        latitude: user.latitude || "",
        longitude: user.longitude || ""
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 GET CURRENT USER SESSION
exports.getMe = async (req, res) => {
  try {
    const token = req.cookies.client_token;
    if (!token) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    let user;
    if (decoded.userType === 'client') {
      user = await Client.findById(decoded.id).select("-password");
    } else if (decoded.userType === 'pdv') {
      user = await PointDeVente.findById(decoded.id).select("-password");
    }

    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    res.json({
      user: {
        id: user._id,
        nom: user.nom || "",
        prenom: user.prenom || "",
        email: user.email,
        telephone: user.telephone || "",
        role: decoded.userType,
        userType: decoded.userType,
        adresses: user.adresses || [],
        favoris: user.favoris || [],
        panier: user.panier || [],
        createdAt: user.createdAt,
        responsable_nom: user.responsable_nom || "",
        adresse: user.adresse || "",
        latitude: user.latitude || "",
        longitude: user.longitude || ""
      }
    });
  } catch (error) {
    res.status(401).json({ message: "Session invalide ou expirée" });
  }
};

// Helper pour calculer le Plus Code court offline côté backend
const getShortPlusCodeBackend = function(latitude, longitude) {
  const SEPARATOR_ = '+';
  const SEPARATOR_POSITION_ = 8;
  const CODE_ALPHABET_ = '23456789CFGHJMPQRVWX';
  const ENCODING_BASE_ = CODE_ALPHABET_.length;
  const LATITUDE_MAX_ = 90;
  const LONGITUDE_MAX_ = 180;
  const MAX_DIGIT_COUNT_ = 15;
  const PAIR_CODE_LENGTH_ = 10;
  const PAIR_PRECISION_ = Math.pow(ENCODING_BASE_, 3);
  const GRID_COLUMNS_ = 4;
  const GRID_ROWS_ = 5;
  const FINAL_LAT_PRECISION_ = PAIR_PRECISION_ * Math.pow(GRID_ROWS_, (MAX_DIGIT_COUNT_ - PAIR_CODE_LENGTH_));
  const FINAL_LNG_PRECISION_ = PAIR_PRECISION_ * Math.pow(GRID_COLUMNS_, (MAX_DIGIT_COUNT_ - PAIR_CODE_LENGTH_));

  latitude = Number(latitude);
  longitude = Number(longitude);
  if (isNaN(latitude) || isNaN(longitude)) return '';

  var latVal = Math.floor(latitude * FINAL_LAT_PRECISION_);
  latVal += LATITUDE_MAX_ * FINAL_LAT_PRECISION_;
  if (latVal < 0) latVal = 0;
  else if (latVal >= 2 * LATITUDE_MAX_ * FINAL_LAT_PRECISION_) latVal = 2 * LATITUDE_MAX_ * FINAL_LAT_PRECISION_ - 1;

  var lngVal = Math.floor(longitude * FINAL_LNG_PRECISION_);
  lngVal += LONGITUDE_MAX_ * FINAL_LNG_PRECISION_;
  if (lngVal < 0) {
    lngVal = (lngVal % (2 * LONGITUDE_MAX_ * FINAL_LNG_PRECISION_)) + 2 * LONGITUDE_MAX_ * FINAL_LNG_PRECISION_;
  } else if (lngVal >= 2 * LONGITUDE_MAX_ * FINAL_LNG_PRECISION_) {
    lngVal = lngVal % (2 * LONGITUDE_MAX_ * FINAL_LNG_PRECISION_);
  }

  const code = new Array(MAX_DIGIT_COUNT_ + 1);
  code[SEPARATOR_POSITION_] = SEPARATOR_;

  for (var i = MAX_DIGIT_COUNT_ - PAIR_CODE_LENGTH_; i >= 1; i--) {
    var latDigit = latVal % GRID_ROWS_;
    var lngDigit = lngVal % GRID_COLUMNS_;
    var ndx = latDigit * GRID_COLUMNS_ + lngDigit;
    code[SEPARATOR_POSITION_ + 2 + i] = CODE_ALPHABET_.charAt(ndx);
    latVal = Math.floor(latVal / GRID_ROWS_);
    lngVal = Math.floor(lngVal / GRID_COLUMNS_);
  }

  code[SEPARATOR_POSITION_ + 1] = CODE_ALPHABET_.charAt(latVal % ENCODING_BASE_);
  code[SEPARATOR_POSITION_ + 2] = CODE_ALPHABET_.charAt(lngVal % ENCODING_BASE_);
  latVal = Math.floor(latVal / ENCODING_BASE_);
  lngVal = Math.floor(lngVal / ENCODING_BASE_);

  for (var i = PAIR_CODE_LENGTH_ / 2 + 1; i >= 0; i -= 2) {
    code[i] = CODE_ALPHABET_.charAt(latVal % ENCODING_BASE_);
    code[i + 1] = CODE_ALPHABET_.charAt(lngVal % ENCODING_BASE_);
    latVal = Math.floor(latVal / ENCODING_BASE_);
    lngVal = Math.floor(lngVal / ENCODING_BASE_);
  }

  const fullCode = code.slice(0, 12).join('');
  return fullCode.substring(4);
};

// 🔹 UPDATE CLIENT PROFILE
exports.updateProfile = async (req, res) => {
  try {
    const { nom, prenom, telephone, genre, dateNaissance, preferences } = req.body;
    const client = await Client.findById(req.user.id);

    if (!client) {
      return res.status(404).json({ message: "Client introuvable." });
    }

    if (nom) client.nom = nom;
    if (prenom) client.prenom = prenom;
    if (telephone) client.telephone = telephone;
    if (genre) client.genre = genre;
    if (dateNaissance) client.dateNaissance = dateNaissance;
    if (preferences) client.preferences = { ...client.preferences, ...preferences };
    
    if (req.body.adresses) {
      client.adresses = req.body.adresses;
      client.markModified('adresses');
    }

    if (req.body.latitude !== undefined && req.body.longitude !== undefined) {
      const plusCode = getShortPlusCodeBackend(req.body.latitude, req.body.longitude);
      let suffix = '';
      if (req.body.adresse && req.body.adresse.includes('📍')) {
        const parts = req.body.adresse.split('📍');
        suffix = parts[1] ? parts[1].trim() : '';
      }
      const computedRue = suffix ? `📍 ${suffix}` : (plusCode ? `📍 ${plusCode}` : 'Point sur la carte');

      if (client.adresses && client.adresses.length > 0) {
        const defaultIdx = client.adresses.findIndex(a => a.isDefault);
        const idx = defaultIdx !== -1 ? defaultIdx : 0;
        client.adresses[idx].latitude = Number(req.body.latitude);
        client.adresses[idx].longitude = Number(req.body.longitude);
        client.adresses[idx].rue = computedRue;
        client.adresses[idx].isDefault = true;
        client.markModified('adresses');
      } else {
        client.adresses = [{
          label: 'Adresse enregistrée',
          gouvernorat: 'Tunisie',
          delegation: '',
          localite: '',
          rue: computedRue,
          codePostal: '',
          isDefault: true,
          latitude: Number(req.body.latitude),
          longitude: Number(req.body.longitude)
        }];
      }
    }

    await client.save();
    res.json({ message: "Profil mis à jour", user: client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 GET CURRENT CLIENT PROFILE (REDUNDANT WITH getMe BUT KEPT FOR ROUTES)
exports.getProfile = async (req, res) => {
  try {
    const client = await Client.findById(req.user.id).select("-password");
    if (!client) {
      return res.status(404).json({ message: "Client introuvable." });
    }
    res.json(client);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 UPDATE CLIENT CART
exports.updateCart = async (req, res) => {
  try {
    const cartItems = req.body.cartItems || [];
    const isValidObjectId = (id) => id && require('mongoose').Types.ObjectId.isValid(id);

    const panierFormatted = cartItems.map(item => {
      const pId = isValidObjectId(item.produitId) ? item.produitId 
                : isValidObjectId(item.produit) ? item.produit 
                : isValidObjectId(item._id) ? item._id 
                : null;

      return {
        cartItemId: item.cartItemId,
        produitId: pId,
        nom: item.nom,
        prix: item.prix || item.prix_reference,
        prix_reference: item.prix_reference || item.prix,
        image: item.image,
        quantite: item.quantite || item.quantity || 1,
        selectedLot: item.selectedLot,
        promotionActive: item.promotionActive,
        categorie: item.categorie,
        format: item.format
      };
    });

    const client = await Client.findOneAndUpdate(
      { _id: req.user.id },
      { $set: { panier: panierFormatted } },
      { returnDocument: 'after', runValidators: true }
    );

    if (!client) {
      return res.status(404).json({ message: "Client introuvable." });
    }

    res.json({ message: "Panier mis à jour" });
  } catch (error) {
    console.error("❌ Erreur dans updateCart:", error);
    res.status(500).json({ error: error.message });
  }
};

// 🔹 FORGOT PASSWORD
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Chercher dans Client ou PDV
    let user = await Client.findOne({ email });
    let userName = "";

    if (!user) {
      user = await PointDeVente.findOne({ email });
      if (user) userName = user.nom;
    } else {
      userName = user.prenom || user.nom;
    }

    if (!user) {
      return res.status(404).json({ message: "Aucun compte associé à cet email." });
    }

    const resetCode = generateVerificationCode();
    const resetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    user.resetPasswordToken = resetCode;
    user.resetPasswordExpires = resetExpires;
    await user.save();

    await sendPasswordResetEmail(email, userName, resetCode);

    res.json({ message: "Code de réinitialisation envoyé par email." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 VERIFY RESET CODE
exports.verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    let user = await Client.findOne({ email });
    if (!user) user = await PointDeVente.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    if (user.resetPasswordToken !== code || user.resetPasswordExpires < Date.now()) {
      return res.status(400).json({ message: "Code invalide ou expiré." });
    }

    res.json({ valid: true, message: "Code valide." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 RESET PASSWORD
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    let user = await Client.findOne({ email });
    if (!user) user = await PointDeVente.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    if (user.resetPasswordToken !== code || user.resetPasswordExpires < Date.now()) {
      return res.status(400).json({ message: "Code invalide ou expiré." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 LOGOUT CLIENT
exports.logout = (req, res) => {
  res.clearCookie("client_token", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production"
  });
  res.json({ message: "Déconnexion réussie" });
};
