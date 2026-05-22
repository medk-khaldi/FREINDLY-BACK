const CodePromo = require("../models/CodePromo");

/**
 * Client: Valider un code promo
 */
exports.validerCodePromo = async (req, res) => {
  try {
    const { code, cartTotal } = req.body;
    const clientId = req.user?.id;

    if (!code) {
      return res.status(400).json({ message: "Code promo manquant." });
    }

    const promo = await CodePromo.findOne({ code: code.toUpperCase() });

    if (!promo) {
      return res.status(404).json({ message: "Code promo invalide." });
    }

    if (!promo.actif) {
      return res.status(400).json({ message: "Ce code promo n'est plus actif." });
    }

    const now = new Date();
    if (now < promo.dateDebut || now > promo.dateFin) {
      return res.status(400).json({ message: "Ce code promo est expiré ou pas encore valide." });
    }

    if (promo.maxUtilisations !== null && promo.utilisationsActuelles >= promo.maxUtilisations) {
      return res.status(400).json({ message: "Ce code promo a atteint sa limite d'utilisation." });
    }

    if (cartTotal < promo.montantMinimum) {
      return res.status(400).json({ 
        message: `Le montant minimum pour ce code est de ${promo.montantMinimum.toFixed(3)} DT.` 
      });
    }

    if (clientId && promo.clientsUtilises.includes(clientId)) {
      const uses = promo.clientsUtilises.filter(id => id.toString() === clientId.toString()).length;
      if (uses >= promo.utilisationParClient) {
        return res.status(400).json({ message: "Vous avez déjà utilisé ce code promo." });
      }
    }

    // Calcul de la réduction
    let discountAmount = 0;
    if (promo.type === 'PERCENTAGE') {
      discountAmount = cartTotal * (promo.valeur / 100);
      if (promo.montantMaxReduction) {
        discountAmount = Math.min(discountAmount, promo.montantMaxReduction);
      }
    } else {
      discountAmount = Math.min(promo.valeur, cartTotal);
    }

    res.json({
      valid: true,
      code: promo.code,
      type: promo.type,
      valeur: promo.valeur,
      discountAmount,
      newTotal: cartTotal - discountAmount,
      message: "Code promo appliqué avec succès !"
    });

  } catch (error) {
    console.error("Erreur validation code promo:", error);
    res.status(500).json({ message: "Erreur lors de la validation du code promo." });
  }
};

/**
 * Admin: Lister tous les codes
 */
exports.getAllCodesPromo = async (req, res) => {
  try {
    const codes = await CodePromo.find().sort({ createdAt: -1 });
    res.json(codes);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la récupération des codes promo." });
  }
};

/**
 * Admin: Créer un code
 */
exports.createCodePromo = async (req, res) => {
  try {
    const code = new CodePromo(req.body);
    await code.save();
    res.status(201).json(code);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Ce code existe déjà." });
    }
    res.status(400).json({ message: error.message });
  }
};

/**
 * Admin: Modifier/Toggle
 */
exports.updateCodePromo = async (req, res) => {
  try {
    const code = await CodePromo.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(code);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Admin: Supprimer
 */
exports.deleteCodePromo = async (req, res) => {
  try {
    await CodePromo.findByIdAndDelete(req.params.id);
    res.json({ message: "Code promo supprimé." });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la suppression." });
  }
};
