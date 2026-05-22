const Utilisateur = require("../models/Utilisateur");
const bcrypt = require("bcrypt");

exports.createUser = async (req, res) => {
  try {
    const { nom, prenom, email, mot_de_passe } = req.body;
    if (!nom || !prenom || !email || !mot_de_passe) {
      return res.status(400).json({
        message: "nom, prenom, email et mot_de_passe requis"
      });
    }
    const existe = await Utilisateur.findOne({ email });
    if (existe) {
      return res.status(400).json({ message: "Email déjà utilisé" });
    }
    const hash = await bcrypt.hash(mot_de_passe, 10);
    const utilisateur = await Utilisateur.create({
      nom,
      prenom,
      email,
      mot_de_passe: hash
    });
    const { mot_de_passe: _, ...userSansMdp } = utilisateur.toObject();
    res.status(201).json(userSansMdp);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const withDeleted = req.query.withDeleted === 'true';
    const query = Utilisateur.find().select("-password");
    if (withDeleted) {
      query.setOptions({ withDeleted: true });
    }
    const utilisateurs = await query;
    res.json(utilisateurs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.restoreUser = async (req, res) => {
  try {
    const user = await Utilisateur.findOne({ _id: req.params.id, isDeleted: true }).setOptions({ withDeleted: true });
    if (!user) return res.status(404).json({ message: "Utilisateur supprimé introuvable" });
    await user.restore();
    res.json({ message: "Utilisateur restauré avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const utilisateur = await Utilisateur.findById(req.params.id).select("-mot_de_passe");
    if (!utilisateur) return res.status(404).json({ message: "Utilisateur introuvable" });
    res.json(utilisateur);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const updateData = {};
    
    if (username) {
      // Vérifier si le nom d'utilisateur est déjà utilisé par un autre utilisateur
      const existingUserByUsername = await Utilisateur.findOne({ 
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
      const existingUserByEmail = await Utilisateur.findOne({ 
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
    
    const utilisateur = await Utilisateur.findByIdAndUpdate(
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
};

