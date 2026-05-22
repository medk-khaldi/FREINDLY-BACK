const Chauffeur = require("../models/Chauffeur");
const Utilisateur = require("../models/Utilisateur");

exports.creer = async (req, res) => {
  try {
    const { utilisateur, camion_assigne } = req.body;
    if (!utilisateur) {
      return res.status(400).json({ message: "utilisateur (id) requis" });
    }
    const user = await Utilisateur.findById(utilisateur);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    
    // Vérifier si un chauffeur existe déjà pour cet utilisateur
    const existingChauffeur = await Chauffeur.findOne({ utilisateur });
    if (existingChauffeur) {
      return res.status(400).json({ message: "Un chauffeur existe déjà pour cet utilisateur" });
    }
    
    const chauffeur = await Chauffeur.create({ utilisateur, camion_assigne });
    
    // Populate pour retourner les données complètes
    const populatedChauffeur = await Chauffeur.findById(chauffeur._id)
      .populate("utilisateur", "username email role profileImage createdAt")
      .populate("camion_assigne", "immatriculation capacite statut");
    
    res.status(201).json(populatedChauffeur);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.lister = async (req, res) => {
  try {
    const Voyage = require("../models/Voyage");
    const withDeleted = req.query.withDeleted === 'true';
    
    // Récupérer tous les utilisateurs avec le rôle chauffeur
    const userQuery = Utilisateur.find({ role: 'chauffeur' });
    if (withDeleted) userQuery.setOptions({ withDeleted: true });
    const utilisateurs = await userQuery;
    
    // Récupérer tous les chauffeurs existants
    const chauffeurQuery = Chauffeur.find();
    if (withDeleted) chauffeurQuery.setOptions({ withDeleted: true });
    
    const chauffeurs = await chauffeurQuery
      .populate({ path: "utilisateur", select: "username email role profileImage createdAt isDeleted", options: { withDeleted: true } })
      .populate({ path: "camion_assigne", select: "immatriculation capacite statut", options: { withDeleted: true } });
    
    // Mettre à jour le statut des chauffeurs en fonction des voyages en cours
    for (const chauffeur of chauffeurs) {
      const voyageEnCours = await Voyage.findOne({
        chauffeur: chauffeur._id,
        statut: 'EN_COURS'
      });
      
      const nouveauStatut = voyageEnCours ? 'en service' : 'hors service';
      
      if (chauffeur.statut !== nouveauStatut) {
        chauffeur.statut = nouveauStatut;
        await chauffeur.save();
      }
    }
    
    // Créer un Map des chauffeurs existants par utilisateur ID
    const chauffeursMap = new Map();
    chauffeurs.forEach(c => {
      if (c.utilisateur) {
        chauffeursMap.set(c.utilisateur._id.toString(), c);
      }
    });
    
    // Créer la liste complète: chauffeurs existants + utilisateurs sans entrée chauffeur
    const result = [];
    
    for (const user of utilisateurs) {
      const existingChauffeur = chauffeursMap.get(user._id.toString());
      
      if (existingChauffeur) {
        // Chauffeur existe déjà
        result.push(existingChauffeur);
      } else {
        // Créer une entrée virtuelle pour l'utilisateur
        result.push({
          _id: `virtual_${user._id}`,
          utilisateur: {
            _id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            profileImage: user.profileImage,
            createdAt: user.createdAt
          },
          camion_assigne: null,
          statut: 'hors service',
          isVirtual: true
        });
      }
    }
    
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const chauffeur = await Chauffeur.findById(req.params.id).options({ withDeleted: true })
      .populate({ path: "utilisateur", options: { withDeleted: true } })
      .populate({ path: "camion_assigne", options: { withDeleted: true } });
    if (!chauffeur) return res.status(404).json({ message: "Chauffeur introuvable" });
    res.json(chauffeur);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.modifier = async (req, res) => {
  try {
    const update = {};
    if (req.body.utilisateur !== undefined) update.utilisateur = req.body.utilisateur;
    if (req.body.camion_assigne !== undefined) update.camion_assigne = req.body.camion_assigne;
    const chauffeur = await Chauffeur.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).options({ withDeleted: true })
      .populate({ path: "utilisateur", options: { withDeleted: true } })
      .populate({ path: "camion_assigne", options: { withDeleted: true } });
    if (!chauffeur) return res.status(404).json({ message: "Chauffeur introuvable" });
    res.json(chauffeur);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.supprimer = async (req, res) => {
  try {
    const chauffeur = await Chauffeur.findById(req.params.id);
    if (!chauffeur) return res.status(404).json({ message: "Chauffeur introuvable" });
    
    // Soft delete de l'utilisateur associé
    if (chauffeur.utilisateur) {
      const user = await Utilisateur.findById(chauffeur.utilisateur);
      if (user) await user.softDelete();
    }
    
    // Soft delete du chauffeur
    await chauffeur.softDelete();
    
    res.json({ message: "Chauffeur et utilisateur supprimés (soft delete)" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.restaurer = async (req, res) => {
  try {
    // Trouver le chauffeur supprimé (inclure les supprimés via options)
    const chauffeur = await Chauffeur.findOne({ _id: req.params.id, isDeleted: true }).setOptions({ withDeleted: true });
    if (!chauffeur) return res.status(404).json({ message: "Chauffeur supprimé introuvable" });
    
    // Restaurer l'utilisateur associé
    if (chauffeur.utilisateur) {
      const user = await Utilisateur.findOne({ _id: chauffeur.utilisateur, isDeleted: true }).setOptions({ withDeleted: true });
      if (user) await user.restore();
    }
    
    // Restaurer le chauffeur
    await chauffeur.restore();
    
    res.json({ message: "Chauffeur et utilisateur restaurés avec succès", chauffeur });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};


// Créer une entrée chauffeur pour un utilisateur existant
exports.creerPourUtilisateur = async (req, res) => {
  try {
    const { userId } = req.params;
    const { camion_assigne } = req.body;
    
    const user = await Utilisateur.findById(userId);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
    
    if (user.role !== 'chauffeur') {
      return res.status(400).json({ message: "L'utilisateur doit avoir le rôle chauffeur" });
    }
    
    // Vérifier si un chauffeur existe déjà
    const existingChauffeur = await Chauffeur.findOne({ utilisateur: userId });
    if (existingChauffeur) {
      return res.status(400).json({ message: "Un chauffeur existe déjà pour cet utilisateur" });
    }
    
    const chauffeur = await Chauffeur.create({ 
      utilisateur: userId, 
      camion_assigne: camion_assigne || null 
    });
    
    const populatedChauffeur = await Chauffeur.findById(chauffeur._id)
      .populate("utilisateur", "username email role profileImage createdAt")
      .populate("camion_assigne", "immatriculation capacite statut");
    
    res.status(201).json(populatedChauffeur);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

