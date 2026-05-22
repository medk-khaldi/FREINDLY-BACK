const mongoose = require('mongoose');
const Livraison = require('../models/Livraison');
const Facture = require('../models/Facture');
const MouvementStock = require('../models/MouvementStock');
const { enregistrerMouvement } = require('./mouvement.controller');

/**
 * Lister toutes les factures (livraisons avec données de paiement)
 */
exports.listerFactures = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = { 
            statut: { $in: ['LIVREE', 'PARTIELLE', 'EN_ATTENTE', 'EN_COURS', 'ECHEC'] } 
        };

        if (startDate || endDate) {
            query.date_creation = {};
            if (startDate) query.date_creation.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date_creation.$lte = end;
            }
        }

        const factures = await Livraison.find(query)
        .populate({
            path: 'commande',
            populate: [
                { path: 'pointDeVente', select: 'nom adresse telephone' },
                { path: 'lignesCommande', select: 'produit lot quantite prix_unitaire' }
            ]
        })
        .populate({
            path: 'lignesLivraison',
            populate: [
                { path: 'produit', select: 'nom prix_unitaire prix_reference' },
                { path: 'lot', select: 'nom quantite_unitaire' }
            ]
        })
        .populate('facture')
        .sort({ date_creation: -1 });

        res.json(factures);
    } catch (error) {
        console.error('Erreur liste factures:', error);
        res.status(500).json({ message: 'Erreur lors du chargement des factures' });
    }
};

/**
 * Compléter manuellement le paiement d'une livraison
 */
exports.completerPaiement = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { livraisonId } = req.params;
        const { methode, montant, commentaire } = req.body;

        if (!methode || !montant) {
            return res.status(400).json({ message: 'Méthode et montant requis' });
        }

        const livraison = await Livraison.findById(livraisonId).populate('commande').session(session);
        if (!livraison) {
            await session.abortTransaction();
            return res.status(404).json({ message: 'Livraison introuvable' });
        }

        if (livraison.statut_paiement === 'PAYEE') {
            await session.abortTransaction();
            return res.status(400).json({ message: 'Cette livraison est déjà totalement payée' });
        }

        const resteAPayer = Math.max(0, (livraison.montant_total || 0) - (livraison.montant_paye || 0));
        
        if (Number(montant) > resteAPayer + 0.001) { // Marge pour erreurs d'arrondi
            await session.abortTransaction();
            return res.status(400).json({ 
                message: `Le montant saisi (${montant} DT) dépasse le reste à payer (${resteAPayer.toFixed(3)} DT)` 
            });
        }

        // 1. Ajouter le paiement
        const nouveauMontantPaye = (livraison.montant_paye || 0) + Number(montant);
        livraison.paiements.push({
            methode,
            montant: Number(montant),
            date: new Date()
        });
        livraison.montant_paye = nouveauMontantPaye;

        // 2. Mettre à jour le statut
        // Seuil de tolérance pour les flottants
        if (nouveauMontantPaye >= (livraison.montant_total - 0.001)) {
            livraison.statut_paiement = 'PAYEE';
        } else {
            livraison.statut_paiement = 'PARTIELLEMENT_PAYEE';
        }

        await livraison.save({ session });

        // 3. Mettre à jour la facture associée si elle existe
        if (livraison.facture) {
            const facture = await Facture.findById(livraison.facture).session(session);
            if (facture) {
                facture.statut = livraison.statut_paiement;
                await facture.save({ session });
            }
        }

        // 4. Enregistrer la trace dans MouvementStock (Audit Trail)
        // On récupère l'ID formaté pour le commentaire
        const idFormate = await livraison.getIdFormate();
        
        await enregistrerMouvement({
            type: 'PAIEMENT',
            quantite: 0, // Les paiements n'impactent pas la quantité physique
            utilisateurId: req.user?.id,
            reference: livraison._id,
            reference_type: 'Livraison',
            commentaire: `Complément de paiement manuel (${methode}) pour ${idFormate}. ${commentaire || ''}`,
            session: session
        });

        await session.commitTransaction();
        session.endSession();

        res.json({ 
            message: 'Paiement enregistré avec succès',
            livraison 
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Erreur complément paiement:', error);
        res.status(500).json({ message: 'Erreur lors du traitement du paiement', error: error.message });
    }
};

/**
 * Récupérer une facture par ID (ou par ID de livraison associée)
 */
exports.getFactureById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'ID invalide' });
        }

        // 1. Chercher par ID de facture
        let facture = await Facture.findById(id)
            .populate({
                path: 'livraison',
                populate: {
                    path: 'lignesLivraison.produit',
                    select: 'nom reference prix_unitaire image'
                }
            })
            .populate({
                path: 'commande',
                populate: { path: 'pointDeVente', select: 'nom adresse telephone email' }
            });

        // 2. Si non trouvé, chercher par ID de livraison
        if (!facture) {
            facture = await Facture.findOne({ livraison: id })
                .populate({
                    path: 'livraison',
                    populate: {
                        path: 'lignesLivraison.produit',
                        select: 'nom reference prix_unitaire image'
                    }
                })
                .populate({
                    path: 'commande',
                    populate: { path: 'pointDeVente', select: 'nom adresse telephone email' }
                });
        }

        if (!facture) {
            // 3. Fallback: Ancienne livraison sans document Facture
            const livraison = await Livraison.findById(id)
                .populate({
                    path: 'lignesLivraison.produit',
                    select: 'nom reference prix_unitaire image'
                })
                .populate({
                    path: 'commande',
                    populate: { path: 'pointDeVente', select: 'nom adresse telephone email' }
                });

            if (!livraison) {
                return res.status(404).json({ message: 'Facture et Livraison introuvables' });
            }

            // Créer une facture virtuelle à la volée
            let id_formate = 'FAC-ERROR';
            try {
                id_formate = (await livraison.getIdFormate()).replace('LIV', 'FAC');
            } catch (e) {
                console.error("Erreur fallback format ID:", e);
                id_formate = `FAC-${livraison.numero_livraison || '0000'}`;
            }

            return res.json({
                success: true,
                facture: {
                    _id: livraison._id, 
                    livraison: livraison.toObject(),
                    commande: livraison.commande,
                    montant_total: livraison.montant_total || 0,
                    statut: livraison.statut_paiement === 'PAYEE' ? 'PAYEE' : 
                          (livraison.statut_paiement === 'PARTIELLEMENT_PAYEE' ? 'PARTIELLEMENT_PAYEE' : 'PROFORMA'),
                    date_creation: livraison.date_creation || new Date(),
                    date_echeance: null,
                    id_formate: id_formate
                }
            });
        }

        // Enrichir avec l'ID formaté
        const factureObj = facture.toObject();
        try {
            factureObj.id_formate = await facture.getIdFormate();
        } catch (e) {
            factureObj.id_formate = 'FAC-ERROR';
        }

        res.json({
            success: true,
            facture: factureObj
        });
    } catch (error) {
        console.error('Erreur récupération facture:', error);
        res.status(500).json({ message: 'Erreur serveur', error: error.message });
    }
};

/**
 * Modifier un paiement existant
 */
exports.modifierPaiement = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { livraisonId, paiementId } = req.params;
        const { methode, montant, commentaire } = req.body;

        const livraison = await Livraison.findById(livraisonId).session(session);
        if (!livraison) {
            await session.abortTransaction();
            return res.status(404).json({ message: 'Livraison introuvable' });
        }

        // Trouver le paiement à modifier
        const paiement = livraison.paiements.id(paiementId);
        if (!paiement) {
            await session.abortTransaction();
            return res.status(404).json({ message: 'Paiement introuvable' });
        }

        const ancienMontant = paiement.montant;
        const ancienneMethode = paiement.methode;

        // Recalculer le montant total payé temporairement pour vérification
        const nouveauMontantTotalPaye = livraison.paiements.reduce((acc, p) => {
            if (p._id.toString() === paiementId) return acc + Number(montant);
            return acc + (p.montant || 0);
        }, 0);

        if (nouveauMontantTotalPaye > (livraison.montant_total || 0) + 0.001) {
            await session.abortTransaction();
            return res.status(400).json({ 
                message: `Le nouveau total payé (${nouveauMontantTotalPaye.toFixed(3)} DT) dépasserait le montant total (${livraison.montant_total.toFixed(3)} DT)` 
            });
        }

        // Mettre à jour les champs
        if (methode) paiement.methode = methode;
        if (montant !== undefined) paiement.montant = Number(montant);

        // Appliquer le nouveau total
        livraison.montant_paye = nouveauMontantTotalPaye;

        // Mettre à jour le statut
        if (livraison.montant_paye >= (livraison.montant_total || 0)) {
            livraison.statut_paiement = 'PAYEE';
        } else if (livraison.montant_paye > 0) {
            livraison.statut_paiement = 'PARTIELLEMENT_PAYEE';
        } else {
            livraison.statut_paiement = 'NON_PAYEE';
        }

        await livraison.save({ session });

        // Mettre à jour la facture associée
        if (livraison.facture) {
            const Facture = require('../models/Facture');
            const facture = await Facture.findById(livraison.facture).session(session);
            if (facture) {
                facture.statut = livraison.statut_paiement;
                await facture.save({ session });
            }
        }

        // Audit Trail
        const idFormate = await livraison.getIdFormate();
        await enregistrerMouvement({
            type: 'PAIEMENT',
            quantite: 0,
            utilisateurId: req.user?.id,
            reference: livraison._id,
            reference_type: 'Livraison',
            commentaire: `Modification paiement (${ancienneMethode} ${ancienMontant} -> ${methode} ${montant}) pour ${idFormate}. ${commentaire || ''}`,
            session: session
        });

        await session.commitTransaction();
        session.endSession();

        res.json({ message: 'Paiement modifié avec succès', livraison });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Erreur modification paiement:', error);
        res.status(500).json({ message: 'Erreur lors de la modification du paiement', error: error.message });
    }
};

