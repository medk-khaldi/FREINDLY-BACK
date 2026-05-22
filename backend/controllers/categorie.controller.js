const CategorieProduit = require("../models/CategorieProduit");
const Produit = require("../models/Produit");

// Créer une catégorie
exports.create = async (req, res) => {
    try {
        if (!req.body.nom || typeof req.body.nom !== 'string') {
            return res.status(400).json({ message: "Le nom de la catégorie est obligatoire." });
        }

        const categorie = new CategorieProduit({
            nom: req.body.nom.trim(),
            parent: req.body.parent || null,
            lots: req.body.lots || []
        });

        const savedDocument = await categorie.save();
        const populated = await savedDocument.populate('lots');
        
        res.status(201).json(populated);
    } catch (error) {
        console.error("Error in category creation:", error);
        if (error.code === 11000) {
            return res.status(400).json({ message: "Une catégorie avec ce nom existe déjà (index unique)." });
        }
        if (error.name === 'ValidationError') {
            return res.status(400).json({ message: "Données invalides : " + error.message });
        }
        res.status(500).json({ message: "Erreur serveur lors de la création", error: error.message });
    }
};

// Lister toutes les catégories (ou filtrer par parent)
exports.getAll = async (req, res) => {
    try {
        const filter = req.query.parent !== undefined 
            ? { parent: req.query.parent === 'null' ? null : req.query.parent }
            : {};
        const categories = await CategorieProduit.find(filter)
            .populate('parent', 'nom')
            .populate('lots');
        res.status(200).json(categories);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// Obtenir l'arborescence complète (Tree structure récursive)
exports.getTree = async (req, res) => {
    try {
        const allCategories = await CategorieProduit.find().populate('lots');
        
        // Fonction récursive pour construire l'arbre
        const buildTree = (parentId = null) => {
            return allCategories
                .filter(cat => {
                    const catParentId = cat.parent ? cat.parent.toString() : null;
                    const targetParentId = parentId ? parentId.toString() : null;
                    return catParentId === targetParentId;
                })
                .map(cat => ({
                    ...cat.toObject(),
                    subcategories: buildTree(cat._id)
                }));
        };

        const tree = buildTree(null);
        res.status(200).json(tree);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};


// Récupérer une catégorie par id
exports.getById = async (req, res) => {
    try {
        const categorie = await CategorieProduit.findById(req.params.id)
            .populate('parent', 'nom')
            .populate('lots');
        if (!categorie) return res.status(404).json({ message: "Catégorie non trouvée" });
        res.status(200).json(categorie);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

// Modifier une catégorie
exports.update = async (req, res) => {
    try {
        const { nom, parent, lots } = req.body;
        const updateData = {};
        if (nom) updateData.nom = nom.trim();
        if (parent !== undefined) updateData.parent = parent || null;
        if (lots !== undefined) updateData.lots = lots;

        const updated = await CategorieProduit.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true } /** Retourne l'objet modifié */
        ).populate('parent', 'nom').populate('lots');

        // 🆕 Propagation automatique des lots aux produits de cette catégorie et ses descendantes
        if (lots && lots.length > 0) {
            // Trouver toutes les sous-catégories récursivement
            const getAllDescendantIds = async (parentId) => {
                const children = await CategorieProduit.find({ parent: parentId }, '_id');
                let ids = [parentId];
                for (const child of children) {
                    const childIds = await getAllDescendantIds(child._id);
                    ids = [...ids, ...childIds];
                }
                return ids;
            };

            const allTargetCategoryIds = await getAllDescendantIds(req.params.id);
            
            console.log(`🚀 Propagation des lots vers ${allTargetCategoryIds.length} catégories (cible: ${req.params.id})`);
            
            const result = await Produit.updateMany(
                { categorie: { $in: allTargetCategoryIds } },
                { $addToSet: { lots: { $each: lots } } }
            );
            console.log(`✅ Mise à jour terminée : ${result.modifiedCount} produits modifiés.`);
        }
        
        res.status(200).json(updated);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "Ce nom est déjà utilisé par une autre catégorie." });
        }
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};


// Supprimer une catégorie (Hard Delete) et détacher les produits
exports.delete = async (req, res) => {
    try {
        const categorie = await CategorieProduit.findById(req.params.id);
        if (!categorie) return res.status(404).json({ message: "Catégorie non trouvée" });
        
        // 1. Trouver tous les IDs de la hiérarchie descendante (récursivement)
        const getAllDescendantIds = async (parentId) => {
            const children = await CategorieProduit.find({ parent: parentId });
            let ids = [parentId];
            for (const child of children) {
                const childIds = await getAllDescendantIds(child._id);
                ids = [...ids, ...childIds];
            }
            return ids;
        };

        const allTargetCategoryIds = await getAllDescendantIds(req.params.id);

        // 2. Détacher les produits (Les mettre en "Sans catégorie")
        const result = await Produit.updateMany(
            { categorie: { $in: allTargetCategoryIds } },
            { $set: { categorie: null } }
        );
        console.log(`🧹 Détachement terminé : ${result.modifiedCount} produits mis en "Sans catégorie".`);

        // 3. Supprimer définitivement la catégorie et ses enfants de la BD
        await CategorieProduit.deleteMany({ _id: { $in: allTargetCategoryIds } });

        res.status(200).json({ 
            message: "Catégorie et sous-catégories supprimées définitivement. Produits détachés.",
            detachedCount: result.modifiedCount 
        });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur", error: error.message });
    }
};

