/**
 * Script de migration FINAL pour les anciens paiements
 * Cible les commandes CMD 285 et antérieures qui sont LIVRÉES
 * Recalcule le montant total en gérant correctement les LOTS/PACKS
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const Livraison = require('../models/Livraison');
const Commande = require('../models/Commande');
const LigneCommande = require('../models/LigneCommande');
const Produit = require('../models/Produit');
const Lot = require('../models/Lot');

const migrate = async () => {
    try {
        await connectDB();
        console.log('🔍 Début de la migration FINALE avec gestion des LOTS (CMD <= 285)...');

        // Charger toutes les livraisons livrées avec leur commande et les lignes de commande (inclure Lot)
        const livraisons = await Livraison.find({ statut: 'LIVREE' })
            .populate({
                path: 'commande',
                populate: {
                    path: 'lignesCommande',
                    populate: { path: 'lot' }
                }
            })
            .populate('lignesLivraison.produit');
        
        console.log(`📦 ${livraisons.length} livraisons livrées trouvées au total.`);

        let count = 0;
        let skippedNotTargeted = 0;

        for (const livraison of livraisons) {
            if (livraison.commande && livraison.commande.numero_commande <= 285) {
                
                console.log(`⚙️ Traitement de CMD-${livraison.commande.numero_commande.toString().padStart(4, '0')}...`);
                
                // Vérifier l'intégrité des produits (éviter ValidationError si un produit a été supprimé)
                const hasInvalidProduct = livraison.lignesLivraison.some(l => !l.produit);
                if (hasInvalidProduct) {
                    console.log(`   ❌ Livraison ignorée : Contient des produits introuvables (supprimés)`);
                    skippedNotTargeted++;
                    continue;
                }

                let nouveauMontantTotal = 0;
                const lignesCmd = livraison.commande.lignesCommande || [];

                for (const line of livraison.lignesLivraison) {
                    if (!line.produit) continue;

                    // Trouver la ligne de commande correspondante
                    const lc = lignesCmd.find(lc => 
                        lc.produit.toString() === line.produit._id.toString()
                    );

                    if (lc) {
                        const pu = lc.prix_unitaire || 0;
                        // Gestion des LOTS: Diviser par quantite_unitaire si c'est un lot
                        const qteUnitaire = (lc.lot && lc.lot.quantite_unitaire) ? lc.lot.quantite_unitaire : 1;
                        const quantiteEnPacks = line.quantite / qteUnitaire;
                        
                        nouveauMontantTotal += (quantiteEnPacks * pu);
                    } else {
                        // Fallback: prix reference produit (unité)
                        nouveauMontantTotal += (line.quantite * (line.produit.prix_reference || 0));
                    }
                }

                // Arrondir à 3 décimales pour éviter les erreurs de virgule flottante
                nouveauMontantTotal = Math.round(nouveauMontantTotal * 1000) / 1000;

                livraison.montant_total = nouveauMontantTotal;
                livraison.montant_paye = nouveauMontantTotal;
                livraison.statut_paiement = 'PAYEE';
                
                livraison.paiements = [{
                    methode: 'ESPECES',
                    montant: nouveauMontantTotal,
                    date: livraison.date_livraison || livraison.date_creation || new Date()
                }];

                await livraison.save();
                console.log(`   ✅ Validé: ${nouveauMontantTotal} DT`);
                count++;
            } else {
                skippedNotTargeted++;
            }
        }

        console.log('\n--- Résumé de la migration FINALE ---');
        console.log(`✅ Livraisons corrigées : ${count}`);
        console.log(`⏩ Ignorées : ${skippedNotTargeted}`);
        console.log('-------------------------------\n');
        
        console.log('🎉 Migration FINALE terminée avec succès.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur critique lors de la migration:', error);
        process.exit(1);
    }
};

migrate();
