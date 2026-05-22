const PointDeVente = require('../models/PointDeVente');
const PointDeVenteStats = require('../models/PointDeVenteStats');
const Livraison = require('../models/Livraison');
const Commande = require('../models/Commande');
const { updatePDVStats } = require('../utils/statsHelper');

/**
 * Get all PDVs with their classification and basic info.
 */
exports.getAllPDVs = async (req, res) => {
  try {
    const pdvs = await PointDeVente.find().sort({ nom: 1 });
    res.json(pdvs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get all PDVs with their stats included.
 */
exports.getAllPDVsWithStats = async (req, res) => {
  try {
    const pdvs = await PointDeVente.find().sort({ nom: 1 });
    const stats = await PointDeVenteStats.find();
    
    const combined = pdvs.map(pdv => {
      const pdvStats = stats.find(s => s.pointDeVente.toString() === pdv._id.toString());
      return {
        ...pdv.toObject(),
        stats: pdvStats || null
      };
    });
    
    res.json(combined);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get detailed stats for a specific PDV.
 */
exports.getPDVStats = async (req, res) => {
  try {
    const { id } = req.params;
    let stats = await PointDeVenteStats.findOne({ pointDeVente: id }).populate('pointDeVente');
    
    // If no stats yet, or missing new fields like monthlyHistory, try to calculate them
    if (!stats || !stats.monthlyHistory || stats.monthlyHistory.length === 0) {
      // Small optimization: only recalcula if there are actually commands (already handled in helper)
      await updatePDVStats(id);
      stats = await PointDeVenteStats.findOne({ pointDeVente: id }).populate('pointDeVente');
    }

    if (!stats) {
      return res.status(404).json({ message: "Statistiques non trouvées pour ce point de vente" });
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get delivery history for a specific PDV.
 */
exports.getPDVHistory = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find all commands for this PDV
    const commands = await Commande.find({ pointDeVente: id }).select('_id');
    const commandIds = commands.map(c => c._id);

    // Find all deliveries for these commands
    const history = await Livraison.find({ commande: { $in: commandIds } })
      .sort({ date_creation: -1 })
      .populate({
        path: 'commande',
        select: 'numero_commande id_formate pointDeVente lignesCommande',
        populate: [
          { path: 'pointDeVente', select: 'nom adresse telephone email' },
          { 
            path: 'lignesCommande', 
            select: 'produit lot quantite prix_unitaire',
            populate: { path: 'lot', select: 'nom quantite_unitaire' }
          }
        ]
      })
      .populate({
        path: 'lignesLivraison',
        populate: { 
          path: 'produit', 
          select: 'nom image prix_reference',
          populate: { path: 'unite', select: 'nom' }
        }
      })
      .populate({
        path: 'voyage',
        select: 'chauffeur date_depart',
        populate: { 
          path: 'chauffeur',
          populate: { path: 'utilisateur', select: 'username' }
        }
      });

    res.json(history);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Update PDV profile (Classification, Credit Limit, etc.)
 */
exports.updatePDVProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const pdv = await PointDeVente.findByIdAndUpdate(id, updateData, { new: true });
    
    if (!pdv) {
      return res.status(404).json({ message: "Point de vente non trouvé" });
    }

    res.json(pdv);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Force recalculation of stats for a PDV.
 */
exports.recalculateStats = async (req, res) => {
  try {
    const { id } = req.params;
    await updatePDVStats(id);
    const stats = await PointDeVenteStats.findOne({ pointDeVente: id });
    res.json({ message: "Statistiques recalculées avec succès", stats });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
