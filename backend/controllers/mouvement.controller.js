const mongoose = require('mongoose');
const MouvementStock = require("../models/MouvementStock");
const Stock = require("../models/Stock");
const Utilisateur = require("../models/Utilisateur");

/**
 * Fonction utilitaire interne : créer un mouvement et mettre à jour le stock
 * Utilisée par les autres controllers (stock, livraison, retour, commande)
 */
exports.enregistrerMouvement = async ({
    stockId,
    type,
    quantite,
    utilisateurId,
    prix_unitaire,
    commentaire,
    reference,
    reference_type,
    lot_info,
    batch_id, // Identifiant de groupe pour les opérations en masse
    session  // Nouvelle option pour les transactions
}) => {
    let stockDoc = null;
    if (stockId) {
        stockDoc = await Stock.findById(stockId).session(session);
        if (!stockDoc) throw new Error(`Stock introuvable: ${stockId}`);
    } else if (type !== 'RESERVATION' && type !== 'LIBERATION' && type !== 'PAIEMENT') {
        throw new Error(`stockId requis pour le type ${type}`);
    }

    // Valider l'utilisateurId - doit être un ObjectId valide ou null
    let validUtilisateurId = null;
    if (utilisateurId) {
        try {
            // Vérifier si c'est un ObjectId valide
            if (mongoose.Types.ObjectId.isValid(utilisateurId)) {
                validUtilisateurId = utilisateurId;
            } else {
                console.warn(`⚠️ utilisateurId invalide: ${utilisateurId}, ignoré`);
            }
        } catch (error) {
            console.warn(`⚠️ Erreur validation utilisateurId: ${error.message}, ignoré`);
        }
    }

    const mouvement = new MouvementStock({
        stock: stockId,
        type,
        quantite,
        prix_unitaire,
        commentaire,
        reference,
        reference_type,
        utilisateur: validUtilisateurId,
        lot_info,
        batch_id,
        date_mouvement: new Date()
    });

    await mouvement.save({ session });

    // ⚠️ IMPORTANT: Ne pas mettre à jour le stock individuel si on utilise le stock consolidé
    // Le stock consolidé est géré séparément dans les contrôleurs de livraison/commande
    // Cette fonction ne fait que l'enregistrement du mouvement pour traçabilité
    
    // Mettre à jour la quantité du stock selon le type de mouvement
    // SEULEMENT pour les mouvements directs (ENTREE, AJUSTEMENT)
    if (type === "ENTREE" || type === "AJUSTEMENT") {
        switch (type) {
            case "ENTREE":
                stockDoc.quantite += quantite;
                break;
            case "AJUSTEMENT":
                // quantite représente ici la NOUVELLE quantité absolue
                stockDoc.quantite = quantite;
                break;
        }
        stockDoc.date_mise_a_jour = new Date();
        await stockDoc.save({ session });
    }
    // Pour SORTIE, RETOUR, TRANSFERT: ne pas modifier le stock individuel
    // car ces opérations sont gérées au niveau consolidé

    return mouvement;
};

/**
 * POST /api/mouvements
 * Créer un mouvement de stock manuellement (via l'API)
 */
exports.creerMouvement = async (req, res) => {
    try {
        const {
            stock,
            type,
            quantite,
            prix_unitaire,
            commentaire,
            reference,
            reference_type,
            batch_id
        } = req.body;

        const utilisateurId = req.user?.id;

        // Validation des champs obligatoires
        if (!stock || !type || quantite === undefined) {
            return res.status(400).json({ message: "Champs obligatoires manquants: stock, type, quantite" });
        }

        if (!["ENTREE", "SORTIE", "RETOUR", "AJUSTEMENT", "TRANSFERT"].includes(type)) {
            return res.status(400).json({ message: "Type de mouvement invalide" });
        }

        if (quantite <= 0) {
            return res.status(400).json({ message: "La quantité doit être supérieure à 0" });
        }

        // Vérifier que le stock existe
        const stockDoc = await Stock.findById(stock);
        if (!stockDoc) {
            return res.status(404).json({ message: "Stock introuvable" });
        }

        // Vérifier la disponibilité pour les sorties
        if (type === "SORTIE") {
            const disponible = stockDoc.quantite - (stockDoc.quantite_reservee || 0);
            if (quantite > disponible) {
                return res.status(400).json({
                    message: `Stock insuffisant. Disponible: ${disponible}, Demandé: ${quantite}`
                });
            }
        }

        const mouvement = await exports.enregistrerMouvement({
            stockId: stock,
            type,
            quantite,
            utilisateurId,
            prix_unitaire,
            commentaire,
            reference,
            reference_type,
            batch_id
        });

        await mouvement.populate({ path: "utilisateur", options: { withDeleted: true } });
        await mouvement.populate({
            path: "stock",
            populate: {
                path: "produit",
                options: { withDeleted: true },
                populate: [
                    { path: "marque", options: { withDeleted: true } },
                    { path: "categorie", options: { withDeleted: true } },
                    { path: "unite", options: { withDeleted: true } }
                ]
            }
        });

        res.status(201).json({
            message: "Mouvement créé avec succès",
            mouvement,
            stock: await Stock.findById(stock)
        });
    } catch (err) {
        console.error("❌ Erreur création mouvement:", err);
        res.status(500).json({ message: "Erreur serveur", error: err.message });
    }
};

/**
 * GET /api/mouvements
 * Lister les mouvements avec filtres optionnels
 */
exports.listerMouvements = async (req, res) => {
    try {
        const { stock, type, dateDebut, dateFin, reference, utilisateur, page = 1, limit = 50 } = req.query;
 
        const filters = {};
        if (stock) filters.stock = stock;
        if (type) filters.type = type;
        
        // Filtrage intelligent par utilisateur (recherche par nom/username/ID)
        if (utilisateur) {
            console.log(`🔍 Recherche mouvements par utilisateur: "${utilisateur}"`);
            
            // Si c'est un ID valide, on l'utilise directement
            if (mongoose.Types.ObjectId.isValid(utilisateur)) {
                filters.utilisateur = utilisateur;
            } else {
                // Recherche textuelle pour trouver les IDs des utilisateurs correspondants
                const queryStr = utilisateur.trim();
                const users = await Utilisateur.find({
                    $or: [
                        { username: { $regex: queryStr, $options: 'i' } },
                        { nom: { $regex: queryStr, $options: 'i' } },
                        { prenom: { $regex: queryStr, $options: 'i' } },
                        { email: { $regex: queryStr, $options: 'i' } }
                    ],
                    isDeleted: { $ne: true },
                    username: { $ne: 'superviseur' } // Exclure le superviseur
                }).select('_id').lean();
                
                if (users.length > 0) {
                    const userIds = users.map(u => u._id);
                    filters.utilisateur = { $in: userIds };
                    console.log(`✅ ${users.length} utilisateur(s) trouvé(s) pour "${queryStr}"`);
                } else {
                    console.log(`❌ Aucun utilisateur trouvé pour "${queryStr}"`);
                    // Retourner un résultat vide car aucun utilisateur ne correspond
                    return res.json({
                        data: [],
                        pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
                    });
                }
            }
        }
        if (dateDebut || dateFin) {
            filters.date_mouvement = {};
            if (dateDebut) {
                // Début de la journée
                const debut = new Date(dateDebut);
                debut.setHours(0, 0, 0, 0);
                filters.date_mouvement.$gte = debut;
            }
            if (dateFin) {
                // Fin de la journée (23:59:59.999)
                const fin = new Date(dateFin);
                fin.setHours(23, 59, 59, 999);
                filters.date_mouvement.$lte = fin;
            }
        }

        // Recherche par référence (ID formaté)
        if (reference) {
            console.log(`🔍 Recherche par référence: "${reference}"`);
            
            // Extraire le type et le numéro de la référence (ex: CMD-0001, LIV-0001-01, RET-0001, STK-0001)
            const refUpper = reference.toUpperCase().trim();
            console.log(`🔍 Référence normalisée: "${refUpper}"`);
            
            // Patterns pour différents types de références
            const cmdPattern = /^CMD(-(\d*))?$/i;
            const livPattern = /^LIV(-(\d*)(-(\d*))?)?$/i;
            const retPattern = /^RET(-(\d*))?$/i;
            const stkPattern = /^STK(-(\d*))?$/i;
            
            let referenceIds = [];
            
            if (cmdPattern.test(refUpper)) {
                // Recherche de commandes
                const match = refUpper.match(cmdPattern);
                const numero = match[2]; // Le numéro après CMD-
                console.log(`📋 Recherche commandes avec pattern: "${numero || 'tous'}"`);
                
                const Commande = require('../models/Commande');
                let commandes;
                
                if (!numero || numero === '') {
                    // "CMD" seul - afficher toutes les commandes
                    commandes = await Commande.find({}).lean();
                    console.log(`✅ ${commandes.length} commandes trouvées (toutes)`);
                } else {
                    // "CMD-001" - chercher les commandes dont le numéro commence par 001 (1, 10, 11, etc.)
                    const numeroInt = parseInt(numero);
                    const numeroStr = numeroInt.toString();
                    commandes = await Commande.find({}).lean();
                    commandes = commandes.filter(cmd => 
                        cmd.numero_commande && cmd.numero_commande.toString().startsWith(numeroStr)
                    );
                    console.log(`✅ ${commandes.length} commandes trouvées commençant par ${numeroStr}`);
                }
                
                if (commandes.length > 0) {
                    referenceIds = commandes.map(cmd => cmd._id);
                    filters.$or = filters.$or || [];
                    filters.$or.push({ reference: { $in: referenceIds }, reference_type: 'Commande' });
                } else {
                    console.log(`❌ Aucune commande trouvée`);
                    return res.json({
                        data: [],
                        pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
                    });
                }
            } else if (livPattern.test(refUpper)) {
                // Recherche de livraisons
                const match = refUpper.match(livPattern);
                const numeroCmd = match[2]; // Le numéro de commande après LIV-
                const numeroLiv = match[4]; // Le numéro de livraison après le deuxième -
                console.log(`📦 Recherche livraisons: commande="${numeroCmd || 'tous'}", livraison="${numeroLiv || 'tous'}"`);
                
                const Commande = require('../models/Commande');
                const Livraison = require('../models/Livraison');
                
                let livraisons;
                
                if (!numeroCmd || numeroCmd === '') {
                    // "LIV" seul - toutes les livraisons
                    livraisons = await Livraison.find({}).lean();
                    console.log(`✅ ${livraisons.length} livraisons trouvées (toutes)`);
                } else {
                    // Trouver les commandes correspondantes
                    const numeroCmdInt = parseInt(numeroCmd);
                    const numeroCmdStr = numeroCmdInt.toString();
                    const commandes = await Commande.find({}).lean();
                    const commandesFiltered = commandes.filter(cmd => 
                        cmd.numero_commande && cmd.numero_commande.toString().startsWith(numeroCmdStr)
                    );
                    
                    if (commandesFiltered.length === 0) {
                        console.log(`❌ Aucune commande trouvée`);
                        return res.json({
                            data: [],
                            pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
                        });
                    }
                    
                    const commandeIds = commandesFiltered.map(cmd => cmd._id);
                    
                    if (!numeroLiv || numeroLiv === '') {
                        // "LIV-001" - toutes les livraisons de ces commandes
                        livraisons = await Livraison.find({ commande: { $in: commandeIds } }).lean();
                        console.log(`✅ ${livraisons.length} livraisons trouvées pour ces commandes`);
                    } else {
                        // "LIV-001-01" - livraisons spécifiques
                        const numeroLivInt = parseInt(numeroLiv);
                        const numeroLivStr = numeroLivInt.toString();
                        livraisons = await Livraison.find({ commande: { $in: commandeIds } }).lean();
                        livraisons = livraisons.filter(liv => 
                            liv.numero_livraison && liv.numero_livraison.toString().startsWith(numeroLivStr)
                        );
                        console.log(`✅ ${livraisons.length} livraisons trouvées`);
                    }
                }
                
                if (livraisons.length > 0) {
                    referenceIds = livraisons.map(liv => liv._id);
                    filters.$or = filters.$or || [];
                    filters.$or.push({ reference: { $in: referenceIds }, reference_type: 'Livraison' });
                } else {
                    console.log(`❌ Aucune livraison trouvée`);
                    return res.json({
                        data: [],
                        pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
                    });
                }
            } else if (retPattern.test(refUpper)) {
                // Recherche de retours
                const match = refUpper.match(retPattern);
                const numero = match[2];
                console.log(`↩️ Recherche retours avec pattern: "${numero || 'tous'}"`);
                
                const Retour = require('../models/Retour');
                let retours;
                
                if (!numero || numero === '') {
                    // "RET" seul - tous les retours
                    retours = await Retour.find({}).lean();
                    console.log(`✅ ${retours.length} retours trouvés (tous)`);
                } else {
                    const numeroInt = parseInt(numero);
                    const numeroStr = numeroInt.toString();
                    retours = await Retour.find({}).lean();
                    retours = retours.filter(ret => 
                        ret.numero_retour && ret.numero_retour.toString().startsWith(numeroStr)
                    );
                    console.log(`✅ ${retours.length} retours trouvés commençant par ${numeroStr}`);
                }
                
                if (retours.length > 0) {
                    referenceIds = retours.map(ret => ret._id);
                    filters.$or = filters.$or || [];
                    filters.$or.push({ reference: { $in: referenceIds }, reference_type: 'Retour' });
                } else {
                    console.log(`❌ Aucun retour trouvé`);
                    return res.json({
                        data: [],
                        pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
                    });
                }
            } else if (stkPattern.test(refUpper)) {
                // Recherche de stocks - mouvements de stock directs (ENTREE directe, AJUSTEMENT)
                const match = refUpper.match(stkPattern);
                const numero = match[2];
                console.log(`📦 Recherche mouvements stock avec pattern: "${numero || 'tous'}"`);
                
                const Stock = require('../models/Stock');
                let stocks;
                
                if (!numero || numero === '') {
                    // "STK" seul - tous les mouvements de stock directs
                    // Inclure les mouvements SANS référence ET ceux avec reference_type = "Stock"
                    filters.$and = [
                        { type: { $in: ['ENTREE', 'AJUSTEMENT'] } },
                        {
                            $or: [
                                // Mouvements sans référence externe (anciens)
                                { reference_type: { $exists: false } },
                                { reference_type: null },
                                { reference_type: '' },
                                // Mouvements avec référence de type Stock (nouveaux)
                                { reference_type: 'Stock' }
                            ]
                        }
                    ];
                    console.log(`✅ Filtre appliqué: mouvements ENTREE/AJUSTEMENT directs (sans référence OU avec reference_type=Stock)`);
                } else {
                    // "STK-001" - chercher les stocks spécifiques
                    const numeroInt = parseInt(numero);
                    const numeroStr = numeroInt.toString();
                    stocks = await Stock.find({}).lean();
                    stocks = stocks.filter(stk => 
                        stk.numero_stock && stk.numero_stock.toString().startsWith(numeroStr)
                    );
                    console.log(`✅ ${stocks.length} stocks trouvés commençant par ${numeroStr}`);
                    
                    if (stocks.length > 0) {
                        const stockIds = stocks.map(stk => stk._id);
                        // Filtrer par stock ET par type de mouvement direct
                        filters.$and = [
                            { stock: { $in: stockIds } },
                            { type: { $in: ['ENTREE', 'AJUSTEMENT'] } },
                            {
                                $or: [
                                    // Mouvements sans référence externe (anciens)
                                    { reference_type: { $exists: false } },
                                    { reference_type: null },
                                    { reference_type: '' },
                                    // Mouvements avec référence de type Stock (nouveaux)
                                    { reference_type: 'Stock' }
                                ]
                            }
                        ];
                        console.log(`✅ Filtre stock appliqué avec ${stockIds.length} IDs (types: ENTREE, AJUSTEMENT, directs uniquement)`);
                    } else {
                        console.log(`❌ Aucun stock trouvé`);
                        return res.json({
                            data: [],
                            pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
                        });
                    }
                }
            } else {
                // Format non reconnu - recherche textuelle dans le commentaire
                console.log(`🔤 Format non reconnu: "${refUpper}"`);
                if (refUpper.length >= 3) {
                    console.log(`🔤 Recherche textuelle dans commentaire`);
                    filters.commentaire = { $regex: reference, $options: 'i' };
                } else {
                    console.log(`⚠️ Recherche trop courte, ignorée`);
                }
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [mouvements, total] = await Promise.all([
            MouvementStock.find(filters)
                .populate({
                    path: "stock",
                    populate: [
                        {
                            path: "produit",
                            options: { withDeleted: true },
                            populate: [
                                { path: "marque", model: "MarqueProduit", options: { withDeleted: true } },
                                { path: "categorie", model: "CategorieProduit", options: { withDeleted: true } },
                                { path: "unite", model: "Unite", options: { withDeleted: true } }
                            ]
                        },
                        { path: "entrepot" }
                    ]
                })
                .populate({ path: "utilisateur", select: "username email role", options: { withDeleted: true } })
                .populate("reference")
                .sort({ date_mouvement: -1 })
                .limit(parseInt(limit))
                .skip(skip),
            MouvementStock.countDocuments(filters)
        ]);

        // Enrichir les mouvements avec les références formatées
        const mouvementsEnrichis = await Promise.all(
            mouvements.map(async (mouvement) => {
                const mouvementObj = mouvement.toObject();
                
                // Ajouter la référence formatée
                if (mouvement.reference && mouvement.reference_type) {
                    mouvementObj.reference_formatee = await mouvement.getReferenceFormatee();
                }
                
                return mouvementObj;
            })
        );

        res.json({
            data: mouvementsEnrichis,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) {
        console.error("❌ Erreur liste mouvements:", err);
        res.status(500).json({ message: "Erreur serveur", error: err.message });
    }
};

/**
 * GET /api/mouvements/stock/:stockId
 * Historique complet d'un stock spécifique
 */
exports.getHistoriqueStock = async (req, res) => {
    try {
        const { stockId } = req.params;

        const mouvements = await MouvementStock.find({ stock: stockId })
            .populate({ path: "utilisateur", select: "username email role", options: { withDeleted: true } })
            .populate("reference")
            .sort({ date_mouvement: -1 });

        // Enrichir les mouvements avec les références formatées
        const mouvementsEnrichis = await Promise.all(
            mouvements.map(async (mouvement) => {
                const mouvementObj = mouvement.toObject();
                
                // Ajouter la référence formatée
                if (mouvement.reference && mouvement.reference_type) {
                    mouvementObj.reference_formatee = await mouvement.getReferenceFormatee();
                }
                
                return mouvementObj;
            })
        );

        res.json(mouvementsEnrichis);
    } catch (err) {
        console.error("❌ Erreur historique stock:", err);
        res.status(500).json({ message: "Erreur serveur", error: err.message });
    }
};

/**
 * GET /api/mouvements/stats
 * Statistiques agrégées des mouvements (pour dashboard)
 */
exports.getStats = async (req, res) => {
    try {
        const { dateDebut, dateFin, utilisateur } = req.query;

        const matchFilter = {};

        // Filtrage intelligent par utilisateur (recherche par nom/username/ID)
        if (utilisateur) {
            // Si c'est un ID valide, on l'utilise directement
            if (mongoose.Types.ObjectId.isValid(utilisateur)) {
                matchFilter.utilisateur = new mongoose.Types.ObjectId(utilisateur);
            } else {
                // Recherche textuelle pour trouver les IDs des utilisateurs correspondants
                const queryStr = utilisateur.trim();
                const users = await Utilisateur.find({
                    $or: [
                        { username: { $regex: queryStr, $options: 'i' } },
                        { nom: { $regex: queryStr, $options: 'i' } },
                        { prenom: { $regex: queryStr, $options: 'i' } },
                        { email: { $regex: queryStr, $options: 'i' } }
                    ],
                    isDeleted: { $ne: true },
                    username: { $ne: 'superviseur' } // Exclure le superviseur
                }).select('_id').lean();
                
                if (users.length > 0) {
                    const userIds = users.map(u => u._id);
                    matchFilter.utilisateur = { $in: userIds };
                } else {
                    // Retourner des stats vides car aucun utilisateur ne correspond
                    return res.json({ ENTREE: 0, SORTIE: 0, RETOUR: 0, AJUSTEMENT: 0, TRANSFERT: 0 });
                }
            }
        }

        if (dateDebut || dateFin) {
            matchFilter.date_mouvement = {};
            if (dateDebut) {
                // Début de la journée
                const debut = new Date(dateDebut);
                debut.setHours(0, 0, 0, 0);
                matchFilter.date_mouvement.$gte = debut;
            }
            if (dateFin) {
                // Fin de la journée (23:59:59.999)
                const fin = new Date(dateFin);
                fin.setHours(23, 59, 59, 999);
                matchFilter.date_mouvement.$lte = fin;
            }
        }

        const stats = await MouvementStock.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: "$type",
                    count: { $sum: 1 },
                    totalQuantite: { $sum: "$quantite" }
                }
            }
        ]);

        // Formater en objet lisible
        const result = { ENTREE: 0, SORTIE: 0, RETOUR: 0, AJUSTEMENT: 0, TRANSFERT: 0 };
        stats.forEach(s => {
            result[s._id] = { count: s.count, totalQuantite: s.totalQuantite };
        });

        res.json(result);
    } catch (err) {
        console.error("❌ Erreur stats mouvements:", err);
        res.status(500).json({ message: "Erreur serveur", error: err.message });
    }
};

