const Produit = require("../models/Produit");
const LigneCommande = require("../models/LigneCommande");
const Avis = require("../models/Avis");
const path = require('path');
const fs = require('fs');
const { extractWeight } = require("../utils/weightUtils");
const Format = require("../models/Format");
const Unite = require("../models/Unite");

// Helper : déterminer si l'utilisateur est un staff (admin/responsable/chauffeur)
function isStaffUser(req) {
  if (!req.user) return false;
  const staffRoles = ['admin', 'responsable_entrepot', 'chauffeur'];
  // Le middleware optionalAuth définit soit userType: 'staff' soit le rôle dans le token
  return req.user.userType === 'staff' || staffRoles.includes(req.user.role);
}

// 🔹 Helper : obtenir le pourcentage de limite d'achat pour l'utilisateur
async function getPurchaseLimitPercentage(req) {
  try {
    const GlobalConfig = require("../models/GlobalConfig");
    const config = await GlobalConfig.findOne({ key: 'MARKETPLACE_PURCHASE_LIMITS' });
    
    // Valeurs par défaut si non configuré
    const defaultLimits = { particular: 100, pdv: 100 };
    const limits = config ? { ...defaultLimits, ...config.value } : defaultLimits;

    // Déterminer le type d'utilisateur connecté
    if (!req.user) return 100; // Visiteur = pas de limite affichée ou limite complète
    
    // Si c'est un staff, pas de limite
    if (isStaffUser(req)) return 100;

    // Client particulier ou PDV
    // Note: on assume que req.user.role ou req.user.userType contient l'info
    if (req.user.role === 'pdv') return limits.pdv;
    return limits.particular;
  } catch (err) {
    console.error("⚠️ Erreur lors de la récupération des limites d'achat:", err);
    return 100;
  }
}

// 🔹 Créer un produit
exports.create = async (req, res) => {
  try {
    const { nom, prix_reference, seuil_minimum, categorie, unite, marque, format, code_barre, visibleMarketplace } = req.body;

    // Gérer les lots qui peuvent venir comme 'lots[]' depuis FormData
    let lots = req.body.lots || req.body['lots[]'];
    if (lots && !Array.isArray(lots)) {
      lots = [lots];
    }

    // Vérification des champs obligatoires
    if (!nom || prix_reference === undefined) {
      return res.status(400).json({ message: "Champs obligatoires manquants : nom ou prix_reference" });
    }

    // Créer d'abord le produit pour obtenir l'ObjectId
    const produitTemp = new Produit({
      nom,
      prix_reference,
      seuil_minimum: seuil_minimum || 0,
      visibleMarketplace: visibleMarketplace !== undefined ? visibleMarketplace : true
    });

    // Générer le code à partir des 4 derniers caractères de l'ObjectId (hex -> decimal)
    const objectIdStr = produitTemp._id.toString();
    const last4Hex = objectIdStr.slice(-4);
    const decimalValue = parseInt(last4Hex, 16);
    // Prendre les 4 derniers chiffres du résultat décimal
    const decimalStr = decimalValue.toString();
    produitTemp.code = decimalStr.slice(-4).padStart(4, '0');

    // Ajouter le code barre EAN si fourni
    if (code_barre && code_barre.trim() !== '') {
      const existing = await Produit.findOne({ code_barre: code_barre.trim(), isDeleted: false });
      if (existing) {
        return res.status(400).json({ message: `Le code-barres "${code_barre}" est déjà utilisé par le produit : ${existing.nom}` });
      }
      produitTemp.code_barre = code_barre.trim();
    }

    // Ajouter l'image : priorité au fichier local, sinon lien externe
    if (req.file) {
      produitTemp.image = `/uploads/products/${req.file.filename}`;
    } else if (req.body.imageUrl) {
      // Si une URL d'image est fournie via le scan ou autre
      produitTemp.image = req.body.imageUrl;
    }

    // Ajouter les références seulement si elles sont définies et non vides
    if (categorie && categorie !== '') produitTemp.categorie = categorie;
    if (unite && unite !== '') produitTemp.unite = unite;
    if (marque && marque !== '') produitTemp.marque = marque;
    
    // Gérer le format et ses lots (Priorité au format)
    if (format && format !== '') {
      produitTemp.format = format;
      const formatDoc = await Format.findById(format).populate('lots');
      if (formatDoc && formatDoc.lots && formatDoc.lots.length > 0) {
        produitTemp.lots = formatDoc.lots.map(l => l._id);
        console.log(`📦 Lots hérités du format ${formatDoc.nom} pour la création`);
      } else if (lots && Array.isArray(lots)) {
        produitTemp.lots = lots.filter(lot => lot && lot !== '');
      }
    } else if (lots && Array.isArray(lots)) {
      produitTemp.lots = lots.filter(lot => lot && lot !== '');
    }

    // ⚖️ AUTO-CALCUL DU POIDS
    if (!req.body.poids_unitaire) {
      try {
        const formatDoc = format ? await Format.findById(format) : null;
        const uniteDoc = unite ? await Unite.findById(unite) : null;
        const extractedWeight = extractWeight(formatDoc?.nom, uniteDoc?.nom);

        if (extractedWeight !== null) {
          produitTemp.poids_unitaire = extractedWeight;
          produitTemp.poids_estime = true;
        }
      } catch (weightErr) {
        console.error("⚠️ Erreur lors de l'extraction du poids:", weightErr);
      }
    } else {
      produitTemp.poids_unitaire = req.body.poids_unitaire;
      produitTemp.poids_estime = false;
    }

    await produitTemp.save();

    // Populate pour retourner les données complètes
    await produitTemp.populate('categorie unite marque format lots');

    res.status(201).json({ message: "Produit créé avec succès", produit: produitTemp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Lister tous les produits (avec stock disponible pour le marketplace)
exports.getAll = async (req, res) => {
  try {
    const Stock = require('../models/Stock');

    const query = {};
    // Appliquer le filtre de visibilité pour les non-staff (clients ou visiteurs)
    if (!isStaffUser(req)) {
      query.visibleMarketplace = { $ne: false };
    }

    const produits = await Produit.find(query)
      .populate("categorie")
      .populate("unite")
      .populate("marque")
      .populate("format")
      .populate("lots")
      .populate("promotionActive")
      .lean();

    // Use StockConsolide for accurate stock tracking
    const StockConsolide = require('../models/StockConsolide');
    const stocksConsolides = await StockConsolide.find().lean();

    // Obtenir le pourcentage de limite pour l'utilisateur actuel
    const limitPercentage = await getPurchaseLimitPercentage(req);

    // Aggregate reviews for all products in one query
    const avisStats = await Avis.aggregate([
      {
        $group: {
          _id: "$produit",
          moyenneNote: { $avg: "$note" },
          nombreAvis: { $sum: 1 }
        }
      }
    ]);

    // Build lookup maps
    const stockMap = {};
    stocksConsolides.forEach(s => {
      stockMap[s.produit.toString()] = s.quantite_disponible || 0;
    });

    const avisMap = {};
    avisStats.forEach(a => {
      avisMap[a._id.toString()] = {
        moyenneNote: a.moyenneNote,
        nombreAvis: a.nombreAvis
      };
    });

    // Attach stockDisponible and avisStats to each product
    const produitsEnrichis = produits
      .map(p => {
        const stock = stockMap[p._id.toString()] ?? 0;
        const purchaseLimit = Math.floor(stock * (limitPercentage / 100));

        return {
          ...p,
          stockDisponible: stock,
          purchaseLimit: Math.max(0, purchaseLimit),
          moyenneNote: avisMap[p._id.toString()]?.moyenneNote ?? 0,
          nombreAvis: avisMap[p._id.toString()]?.nombreAvis ?? 0
        };
      })
      .sort((a, b) => {
        const aOut = a.stockDisponible === 0 ? 1 : 0;
        const bOut = b.stockDisponible === 0 ? 1 : 0;
        return aOut - bOut;
      });

    res.status(200).json(produitsEnrichis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};


// 🔹 Récupérer un produit par ID
exports.getById = async (req, res) => {
  try {
    const Stock = require('../models/Stock');

    const produit = await Produit.findById(req.params.id)
      .populate("categorie")
      .populate("unite")
      .populate("marque")
      .populate("format")
      .populate("lots")
      .populate("promotionActive")
      .lean();

    if (!produit) return res.status(404).json({ message: "Produit non trouvé" });

    // Sécurité : si c'est un client et que le produit est masqué
    if (!isStaffUser(req) && produit.visibleMarketplace === false) {
      return res.status(404).json({ message: "Produit non trouvé" });
    }

    // Get stock from StockConsolide
    const StockConsolide = require('../models/StockConsolide');
    const stockConsolide = await StockConsolide.findOne({ produit: produit._id });
    const stockDisponible = stockConsolide ? stockConsolide.quantite_disponible : 0;

    // Obtenir le pourcentage de limite
    const limitPercentage = await getPurchaseLimitPercentage(req);
    const purchaseLimit = Math.floor(stockDisponible * (limitPercentage / 100));

    // Get review stats
    const avisStats = await Avis.aggregate([
      { $match: { produit: produit._id } },
      {
        $group: {
          _id: null,
          moyenneNote: { $avg: "$note" },
          nombreAvis: { $sum: 1 }
        }
      }
    ]);

    const result = {
      ...produit,
      stockDisponible: Math.max(0, stockDisponible),
      purchaseLimit: Math.max(0, purchaseLimit),
      moyenneNote: avisStats[0]?.moyenneNote ?? 0,
      nombreAvis: avisStats[0]?.nombreAvis ?? 0
    };

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Mettre à jour un produit
exports.update = async (req, res) => {
  try {
    console.log('📥 Mise à jour produit - Body:', req.body);
    console.log('📥 Mise à jour produit - File:', req.file);

    const produit = await Produit.findById(req.params.id);
    if (!produit) return res.status(404).json({ message: "Produit non trouvé" });

    const { nom, prix_reference, seuil_minimum, categorie, unite, marque, format, deleteImage, code_barre, poids_unitaire, visibleMarketplace } = req.body;

    // Gérer les lots qui peuvent venir comme 'lots[]' depuis FormData
    let lots = req.body.lots || req.body['lots[]'];
    if (lots && !Array.isArray(lots)) {
      lots = [lots];
    }

    // Préparer les mises à jour et les suppressions
    const updateFields = {};
    const unsetFields = {};

    if (nom !== undefined) updateFields.nom = nom;
    if (prix_reference !== undefined) updateFields.prix_reference = prix_reference;
    if (seuil_minimum !== undefined) updateFields.seuil_minimum = seuil_minimum;
    if (visibleMarketplace !== undefined) updateFields.visibleMarketplace = visibleMarketplace;

    // Gérer le code barre EAN
    if (code_barre !== undefined) {
      if (code_barre && code_barre.trim() !== '') {
        updateFields.code_barre = code_barre.trim();
      } else {
        unsetFields.code_barre = '';
      }
    }

    // Gérer la suppression de l'image existante
    if (deleteImage === 'true' && produit.image) {
      console.log('🗑️ Demande de suppression de l\'image existante');
      const oldImagePath = path.join(__dirname, '..', produit.image);
      if (fs.existsSync(oldImagePath)) {
        if (!produit.image.startsWith('http')) { // Ne pas essayer de supprimer si c'est une URL externe
          try { fs.unlinkSync(oldImagePath); } catch (e) { }
        }
        console.log('✅ Image existante supprimée');
      }
      unsetFields.image = "";
    }

    // Gérer la nouvelle image (priorité au fichier, puis à l'URL externe)
    if (req.file) {
      console.log('✅ Nouvelle image détectée:', req.file.filename);
      updateFields.image = `/uploads/products/${req.file.filename}`;
      if (unsetFields.hasOwnProperty('image')) delete unsetFields.image;
    } else if (req.body.imageUrl) {
      console.log('🔗 Utilisation de l\'image externe:', req.body.imageUrl);
      updateFields.image = req.body.imageUrl;
      if (unsetFields.hasOwnProperty('image')) delete unsetFields.image;
    }

    // Gérer les références - soit on les met à jour, soit on les supprime
    if (categorie !== undefined) {
      if (categorie && categorie !== '') {
        updateFields.categorie = categorie;
      } else {
        unsetFields.categorie = "";
        console.log('🗑️ Suppression de la catégorie');
      }
    }

    if (unite !== undefined) {
      if (unite && unite !== '') {
        updateFields.unite = unite;
      } else {
        unsetFields.unite = "";
        console.log('🗑️ Suppression de l\'unité');
      }
    }

    if (marque !== undefined) {
      if (marque && marque !== '') {
        updateFields.marque = marque;
      } else {
        unsetFields.marque = "";
        console.log('🗑️ Suppression de la marque');
      }
    }

    if (format !== undefined) {
      if (format && format !== '') {
        updateFields.format = format;
        
        // 🆕 Sync Lots du Format (Priorité absolue)
        const formatDoc = await Format.findById(format).populate('lots');
        if (formatDoc && formatDoc.lots && formatDoc.lots.length > 0) {
          updateFields.lots = formatDoc.lots.map(l => l._id);
          if (unsetFields.hasOwnProperty('lots')) delete unsetFields.lots;
          console.log(`📦 Lots synchronisés depuis le format ${formatDoc.nom}`);
        }
      } else {
        unsetFields.format = "";
        console.log('🗑️ Suppression du format');
      }
    }
    // ⚖️ MISE À JOUR DU POIDS
    if (poids_unitaire !== undefined) {
      updateFields.poids_unitaire = poids_unitaire;
      updateFields.poids_estime = false;
    } else if (format !== undefined || unite !== undefined) {
      // Si le format ou l'unité change, on recalcule le poids estimé SEULEMENT si poids_unitaire n'était pas manuel
      if (produit.poids_estime) {
        try {
          const formatId = format !== undefined ? format : produit.format;
          const uniteId = unite !== undefined ? unite : produit.unite;

          const formatDoc = formatId ? await Format.findById(formatId) : null;
          const uniteDoc = uniteId ? await Unite.findById(uniteId) : null;

          const extractedWeight = extractWeight(formatDoc?.nom, uniteDoc?.nom);
          if (extractedWeight !== null) {
            updateFields.poids_unitaire = extractedWeight;
            updateFields.poids_estime = true;
          }
        } catch (weightErr) {
          console.error("⚠️ Erreur lors de la mise à jour du poids:", weightErr);
        }
      }
    }

    // Gérer les lots de manière sécurisée (éviter les conflits $set/$unset)
    // 🆕 Ignorer si le format a été mis à jour avec des lots (priorité déjà gérée plus haut)
    if (lots !== undefined && !updateFields.lots) {
      if (Array.isArray(lots)) {
        const filteredLots = lots.filter(lot => lot && lot !== '');
        if (filteredLots.length > 0) {
          updateFields.lots = filteredLots;
          if (unsetFields.hasOwnProperty('lots')) delete unsetFields.lots;
        } else {
          unsetFields.lots = "";
          if (updateFields.hasOwnProperty('lots')) delete updateFields.lots;
        }
      } else {
        unsetFields.lots = "";
        if (updateFields.hasOwnProperty('lots')) delete updateFields.lots;
      }
    }

    // Construire la requête de mise à jour
    const updateQuery = {};
    if (Object.keys(updateFields).length > 0) {
      updateQuery.$set = updateFields;
    }
    if (Object.keys(unsetFields).length > 0) {
      updateQuery.$unset = unsetFields;
    }

    console.log('🔄 Requête de mise à jour:', updateQuery);

    // Appliquer les mises à jour
    await Produit.findByIdAndUpdate(req.params.id, updateQuery);

    // Récupérer le produit mis à jour avec populate
    const produitMisAJour = await Produit.findById(req.params.id)
      .populate('categorie unite marque format lots');

    console.log('✅ Produit mis à jour avec succès');
    res.status(200).json({ message: "Produit mis à jour avec succès", produit: produitMisAJour });
  } catch (err) {
    console.error('❌ Erreur mise à jour produit:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Supprimer un produit (Soft Delete)
exports.delete = async (req, res) => {
  try {
    const produit = await Produit.findById(req.params.id);
    if (!produit) return res.status(404).json({ message: "Produit non trouvé" });

    // On conserve l'image sur le disque pour permettre la restauration
    /*
    if (produit.image) {
      const imagePath = path.join(__dirname, '..', produit.image);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }
    */

    await produit.softDelete();
    res.status(200).json({ message: "Produit supprimé avec succès (soft delete)" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Restaurer un produit
exports.restore = async (req, res) => {
  try {
    const produit = await Produit.findOne({ _id: req.params.id, isDeleted: true }).setOptions({ withDeleted: true });
    if (!produit) return res.status(404).json({ message: "Produit supprimé non trouvé" });

    await produit.restore();
    res.status(200).json({ message: "Produit restauré avec succès", produit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Récupérer un produit par code barre (code interne ou EAN)
exports.getByCode = async (req, res) => {
  try {
    const { code } = req.params;
    if (!code) return res.status(400).json({ message: 'Code requis' });

    const produit = await Produit.findOne({
      $or: [{ code: code }, { code_barre: code }]
    })
      .populate('categorie')
      .populate('unite')
      .populate('marque')
      .populate('format')
      .populate('lots')
      .populate('promotionActive');

    if (!produit) {
      return res.status(404).json({ message: `Aucun produit trouvé pour le code : ${code}` });
    }

    res.status(200).json(produit);
  } catch (err) {
    console.error('❌ Erreur getByCode:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// 🔹 Récupérer les meilleures ventes (Top Sellers)
exports.getTopSellers = async (req, res) => {
  try {
    const topSellersAgg = await LigneCommande.aggregate([
      // 1. Grouper par produit et faire la somme des quantités
      {
        $group: {
          _id: "$produit",
          totalVendu: { $sum: "$quantite" }
        }
      },
      // 2. Trier par la somme décroissante
      { $sort: { totalVendu: -1 } },
      // 3. Limiter aux 10 premiers
      { $limit: 10 },
      // 4. Faire le lien avec la collection produits
      {
        $lookup: {
          from: "produits", // Nom de la collection en base (souvent au pluriel)
          localField: "_id",
          foreignField: "_id",
          as: "produitDetails"
        }
      },
      // 5. Extraire le produit du tableau
      { $unwind: "$produitDetails" },
      // 6. Remplacer la racine par les détails du produit
      {
        $replaceRoot: { newRoot: "$produitDetails" }
      }
    ]);

    // Remplir (populate) les références pour que l'affichage frontend fonctionne
    const populatedTopSellers = await Produit.populate(topSellersAgg, [
      { path: "categorie" },
      { path: "marque" },
      { path: "unite" },
      { path: "format" },
      { path: "lots" },
      { path: "promotionActive" }
    ]);

    // --- ENRICHISSEMENT STOCK ET AVIS ---
    const StockConsolide = require('../models/StockConsolide');
    const produitIds = populatedTopSellers.map(p => p._id);

    // Récupérer les stocks consolidés
    const stocksConsolides = await StockConsolide.find({ produit: { $in: produitIds } }).lean();
    const stockMap = {};
    stocksConsolides.forEach(s => {
      stockMap[s.produit.toString()] = s.quantite_disponible || 0;
    });

    // Récupérer les avis (moyenne et nombre)
    const avisStats = await Avis.aggregate([
      { $match: { produit: { $in: produitIds } } },
      {
        $group: {
          _id: "$produit",
          moyenneNote: { $avg: "$note" },
          nombreAvis: { $sum: 1 }
        }
      }
    ]);
    const avisMap = {};
    avisStats.forEach(a => {
      avisMap[a._id.toString()] = {
        moyenneNote: a.moyenneNote,
        nombreAvis: a.nombreAvis
      };
    });

    // Fusionner les données enrichies
    const result = populatedTopSellers.map(p => {
      const pObj = p.toObject ? p.toObject() : p;
      return {
        ...pObj,
        stockDisponible: stockMap[pObj._id.toString()] || 0,
        moyenneNote: avisMap[pObj._id.toString()]?.moyenneNote || 0,
        nombreAvis: avisMap[pObj._id.toString()]?.nombreAvis || 0
      };
    });

    // Filtrer par visibilité pour les clients si nécessaire
    if (!isStaffUser(req)) {
      return res.status(200).json(result.filter(p => p.visibleMarketplace !== false));
    }

    res.status(200).json(result);
  } catch (err) {
    console.error('❌ Erreur getTopSellers:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};
// 🔹 Mettre à jour la catégorie de plusieurs produits en vrac (+ synchronisation des lots)
exports.bulkUpdateCategory = async (req, res) => {
  try {
    const { productIds, categoryId } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "Aucun produit sélectionné" });
    }

    if (!categoryId) {
      return res.status(400).json({ message: "Catégorie cible manquante" });
    }

    // 🆕 Charger toutes les catégories pour calculer les hiérarchies de lots
    const CategorieProduit = require("../models/CategorieProduit");
    const allCategories = await CategorieProduit.find().lean();

    // Helper: collecter les lots d'une catégorie + ses parents + ses descendants
    const getHierarchyLots = (catId) => {
      if (!catId) return [];
      const lotIds = new Set();

      // 1. Remonter vers les parents
      let currentId = catId.toString();
      while (currentId) {
        const cat = allCategories.find(c => c._id.toString() === currentId);
        if (!cat) break;
        (cat.lots || []).forEach(l => lotIds.add(l.toString()));
        currentId = cat.parent ? cat.parent.toString() : null;
      }

      // 2. Descendre vers les enfants
      const collectDown = (parentId) => {
        allCategories
          .filter(c => c.parent && c.parent.toString() === parentId)
          .forEach(child => {
            (child.lots || []).forEach(l => lotIds.add(l.toString()));
            collectDown(child._id.toString());
          });
      };
      collectDown(catId.toString());

      return Array.from(lotIds);
    };

    const newHierarchyLots = getHierarchyLots(categoryId);

    // Pour chaque produit, calculer les nouveaux lots en préservant les "spéciaux"
    const products = await Produit.find({ _id: { $in: productIds } }).lean();

    const bulkOps = products.map(product => {
      const oldHierarchyLots = getHierarchyLots(product.categorie);
      const currentLots = (product.lots || []).map(l => l.toString());

      // Lots "spéciaux" = ceux qui n'appartenaient pas à l'ancienne hiérarchie
      const specialLots = currentLots.filter(id => !oldHierarchyLots.includes(id));

      // Fusionner : nouveaux lots hiérarchiques + lots spéciaux conservés
      const finalLots = [...new Set([...newHierarchyLots, ...specialLots])];

      return {
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { categorie: categoryId, lots: finalLots } }
        }
      };
    });

    const result = await Produit.bulkWrite(bulkOps);

    console.log(`🔄 Bulk category update: ${result.modifiedCount} produits déplacés vers ${categoryId}, lots synchronisés (${newHierarchyLots.length} lots hiérarchiques)`);

    res.status(200).json({
      message: `${result.modifiedCount} produits mis à jour avec succès`,
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    console.error('❌ Erreur bulkUpdateCategory:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Mettre à jour la visibilité sur le marketplace de plusieurs produits en vrac
exports.bulkUpdateMarketplaceVisibility = async (req, res) => {
  try {
    const { productIds, visible } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "Aucun produit sélectionné" });
    }

    const result = await Produit.updateMany(
      { _id: { $in: productIds } },
      { $set: { visibleMarketplace: visible } }
    );

    res.status(200).json({
      message: `${result.modifiedCount} produits mis à jour avec succès`,
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    console.error('❌ Erreur bulkUpdateMarketplaceVisibility:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Valider et rafraîchir les produits du panier
exports.validateCart = async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds)) {
      return res.status(400).json({ message: "Liste de produits invalide" });
    }

    const StockConsolide = require('../models/StockConsolide');

    const produits = await Produit.find({ _id: { $in: productIds } })
      .populate("categorie")
      .populate("unite")
      .populate("marque")
      .populate("format")
      .populate("lots")
      .populate("promotionActive")
      .lean();

    // Récupérer le stock et les avis pour ces produits
    const stocks = await StockConsolide.find({ produit: { $in: productIds } }).lean();
    
    // Obtenir le pourcentage de limite
    const limitPercentage = await getPurchaseLimitPercentage(req);
    const avisStats = await Avis.aggregate([
      { $match: { produit: { $in: productIds.map(id => new (require('mongoose').Types.ObjectId)(id)) } } },
      {
        $group: {
          _id: "$produit",
          moyenneNote: { $avg: "$note" },
          nombreAvis: { $sum: 1 }
        }
      }
    ]);

    const stockMap = {};
    stocks.forEach(s => stockMap[s.produit.toString()] = s.quantite_disponible);

    const avisMap = {};
    avisStats.forEach(a => avisMap[a._id.toString()] = { moyenneNote: a.moyenneNote, nombreAvis: a.nombreAvis });

    const result = produits.map(p => {
      const stock = stockMap[p._id.toString()] || 0;
      const purchaseLimit = Math.floor(stock * (limitPercentage / 100));

      return {
        ...p,
        stockDisponible: stock,
        purchaseLimit: Math.max(0, purchaseLimit),
        moyenneNote: avisMap[p._id.toString()]?.moyenneNote ?? 0,
        nombreAvis: avisMap[p._id.toString()]?.nombreAvis ?? 0
      };
    });

    res.status(200).json(result);
  } catch (err) {
    console.error('❌ Erreur validateCart:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Suggestions de recherche (Autocomplete)
exports.searchSuggestions = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const searchQuery = {
      nom: { $regex: q, $options: "i" }
    };

    // Appliquer le filtre de visibilité pour les non-staff
    if (!isStaffUser(req)) {
      searchQuery.visibleMarketplace = { $ne: false };
    }

    const suggestions = await Produit.find(searchQuery)
      .select("nom image prix_reference format unite")
      .populate("format")
      .populate("unite")
      .limit(8)
      .lean();

    res.json(suggestions);
  } catch (err) {
    console.error("❌ Erreur searchSuggestions:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// 🔹 Supprimer plusieurs produits en vrac (Soft Delete)
exports.bulkDelete = async (req, res) => {
  try {
    const { productIds } = req.body;
    
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "Aucun produit sélectionné" });
    }

    const result = await Produit.updateMany(
      { _id: { $in: productIds } },
      { 
        $set: { 
          isDeleted: true, 
          deletedAt: new Date() 
        } 
      }
    );

    console.log(`🗑️ Bulk delete: ${result.modifiedCount} produits supprimés`);

    res.status(200).json({ 
      message: `${result.modifiedCount} produits supprimés avec succès`,
      modifiedCount: result.modifiedCount 
    });
  } catch (err) {
    console.error('❌ Erreur bulkDelete:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// 🔹 Mettre à jour plusieurs produits en vrac
exports.bulkUpdate = async (req, res) => {
  try {
    const { productIds, updates } = req.body;
    
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "Aucun produit sélectionné" });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Aucune modification fournie" });
    }

    const updateFields = {};
    
    // Mapper les champs autorisés
    if (updates.marque) updateFields.marque = updates.marque;
    if (updates.unite) updateFields.unite = updates.unite;
    
    // 🆕 Gérer le format et ses lots (Priorité au format)
    if (updates.format) {
      updateFields.format = updates.format;
      const formatDoc = await Format.findById(updates.format).populate('lots');
      if (formatDoc && formatDoc.lots && formatDoc.lots.length > 0) {
        updateFields.lots = formatDoc.lots.map(l => l._id);
        console.log(`📦 BulkUpdate: Lots hérités du format ${formatDoc.nom}`);
      }
    }

    if (updates.poids_unitaire !== undefined && updates.poids_unitaire !== '') {
      updateFields.poids_unitaire = parseFloat(updates.poids_unitaire);
      updateFields.poids_estime = false;
    }
    if (updates.seuil_minimum !== undefined && updates.seuil_minimum !== '') {
      updateFields.seuil_minimum = parseFloat(updates.seuil_minimum);
    }
    if (updates.prix_reference !== undefined && updates.prix_reference !== '') {
      updateFields.prix_reference = parseFloat(updates.prix_reference);
    }

    let result;
    // Si on a déjà des lots (venant du format), on fait un $set simple
    if (updateFields.lots) {
       result = await Produit.updateMany(
        { _id: { $in: productIds } },
        { $set: updateFields }
      );
    } else if (updates.lots && updates.lots.length > 0 && updates.lotsMode !== 'set') {
      // Cas complexe : ajout de lots à une liste existante
      result = await Produit.updateMany(
        { _id: { $in: productIds } },
        { 
          $set: updateFields,
          $addToSet: { lots: { $each: updates.lots } }
        }
      );
    } else {
      // Cas simple : remplacement total ou pas de lots
      if (updates.lots && updates.lots.length > 0) {
        updateFields.lots = updates.lots;
      } else if (updates.lotsMode === 'set' && updates.lots && updates.lots.length === 0) {
        updateFields.lots = [];
      }

      result = await Produit.updateMany(
        { _id: { $in: productIds } },
        { $set: updateFields }
      );
    }

    console.log(`🔄 Bulk update: ${result.modifiedCount} produits mis à jour`);

    res.status(200).json({ 
      message: `${result.modifiedCount} produits mis à jour avec succès`,
      modifiedCount: result.modifiedCount 
    });
  } catch (err) {
    console.error('❌ Erreur bulkUpdate:', err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};
