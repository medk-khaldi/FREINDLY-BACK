const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const Livraison = require('../models/Livraison');
const Commande = require('../models/Commande'); // Register Commande
const LigneCommande = require('../models/LigneCommande');
const Produit = require('../models/Produit');

const debug = async () => {
    try {
        await connectDB();
        
        const livraisons = await Livraison.find({ statut: 'LIVREE' })
            .populate({
                path: 'commande',
                populate: { path: 'lignesCommande' }
            })
            .populate('lignesLivraison.produit');
            
        const l259 = livraisons.find(l => l.commande && l.commande.numero_commande === 259);
            
        if (l259) {
            console.log(`LIV for CMD-259:`);
            console.log(`Total enregistré: ${l259.montant_total} DT`);
            for (const line of l259.lignesLivraison) {
                const ligneCmd = l259.commande.lignesCommande.find(lc => lc.produit.toString() === line.produit._id.toString());
                console.log(`- Item: ${line.produit.nom}`);
                console.log(`  Qty Livraison: ${line.quantite}`);
                console.log(`  Prix Unitaire Cmd: ${ligneCmd?.prix_unitaire}`);
                console.log(`  Quantité Cmd: ${ligneCmd?.quantite}`);
                console.log(`  Sous-total calculé: ${line.quantite * (ligneCmd?.prix_unitaire || 0)} DT`);
            }
        } else {
            console.log("CMD-259 introuvable dans les livraisons livrées.");
        }
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

debug();
