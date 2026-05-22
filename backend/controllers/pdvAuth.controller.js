const PointDeVente = require("../models/PointDeVente");
const Client = require("../models/Client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateVerificationCode, sendVerificationEmail } = require("../utils/emailService");

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

// 🔹 REGISTER PDV
exports.register = async (req, res) => {
  try {
    const { nom, responsable_nom, email, password, telephone, adresse, matricule_fiscale, latitude, longitude, type_document } = req.body;

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

    const document_approbation = req.file ? {
      type_document,
      filename: req.file.filename,
      path: `pdv-docs/${req.file.filename}`
    } : null;

    let finalAdresse = adresse;
    if (latitude !== undefined && longitude !== undefined) {
      const plusCode = getShortPlusCodeBackend(latitude, longitude);
      if (plusCode) {
        if (!finalAdresse || finalAdresse === 'Point sur la carte' || finalAdresse === 'Sélectionné sur la carte') {
          finalAdresse = `${plusCode} Tunisie`;
        } else if (finalAdresse && !finalAdresse.includes('+')) {
          finalAdresse = `${finalAdresse} (${plusCode})`;
        }
      }
    }

    const pdv = await PointDeVente.create({
      nom,
      responsable_nom,
      email,
      password: hashedPassword,
      telephone,
      adresse: finalAdresse,
      matricule_fiscale,
      latitude,
      longitude,
      inscription_source: 'MARKETPLACE',
      statut_validation: 'EN_ATTENTE',
      isEmailVerified: false,
      emailVerificationCode: verificationCode,
      emailVerificationExpires: verificationExpires,
      actif: true,
      document_approbation
    });

    // Envoyer l'email de vérification
    await sendVerificationEmail(email, responsable_nom || nom, verificationCode);

    res.status(201).json({
      message: "Compte créé. Veuillez vérifier votre email.",
      email: pdv.email
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 GET CURRENT PDV PROFILE
exports.getProfile = async (req, res) => {
  try {
    const pdv = await PointDeVente.findById(req.user.id).select("-password");
    if (!pdv) {
      return res.status(404).json({ message: "Point de vente introuvable." });
    }
    res.json(pdv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 UPDATE PDV PROFILE
exports.updateProfile = async (req, res) => {
  try {
    const { nom, responsable_nom, telephone, adresse, latitude, longitude } = req.body;
    const pdv = await PointDeVente.findById(req.user.id);

    if (!pdv) {
      return res.status(404).json({ message: "Point de vente introuvable." });
    }

    if (nom) pdv.nom = nom;
    if (responsable_nom) pdv.responsable_nom = responsable_nom;
    if (telephone) pdv.telephone = telephone;
    
    let finalAdresse = adresse || pdv.adresse;
    if (latitude !== undefined && longitude !== undefined) {
      pdv.latitude = Number(latitude);
      pdv.longitude = Number(longitude);
      
      const plusCode = getShortPlusCodeBackend(latitude, longitude);
      if (plusCode) {
        if (!finalAdresse || finalAdresse === 'Point sur la carte' || finalAdresse === 'Sélectionné sur la carte') {
          finalAdresse = `${plusCode} Tunisie`;
        } else if (finalAdresse && !finalAdresse.includes('+')) {
          finalAdresse = `${finalAdresse} (${plusCode})`;
        }
      }
    }
    pdv.adresse = finalAdresse;

    await pdv.save();
    res.json({ message: "Profil mis à jour", user: pdv });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 UPDATE PDV CART
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

    const pdv = await PointDeVente.findOneAndUpdate(
      { _id: req.user.id },
      { $set: { panier: panierFormatted } },
      { returnDocument: 'after', runValidators: true }
    );

    if (!pdv) {
      return res.status(404).json({ message: "Point de vente introuvable." });
    }

    res.json({ message: "Panier mis à jour" });
  } catch (error) {
    console.error("❌ Erreur dans pdvAuth.updateCart:", error);
    res.status(500).json({ error: error.message });
  }
};

// 🔹 LOGOUT PDV
exports.logout = (req, res) => {
  res.clearCookie("client_token", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production"
  });
  res.json({ message: "Déconnexion réussie" });
};
