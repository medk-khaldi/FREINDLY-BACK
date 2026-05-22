const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const Livraison = require('../models/Livraison');
const Commande = require('../models/Commande');
const LigneCommande = require('../models/LigneCommande');
const Produit = require('../models/Produit');

const analyze = async () => {
    try {
        await connectDB();
        const livraisons = await Livraison.find({ statut: 'LIVREE' })
            .populate({
                path: 'commande',
                populate: { path: 'lignesCommande' }
            })
            .populate('lignesLivraison.produit');
            
        console.log('--- Analyse des Incohérences (CMD <= 285) ---');
        for (const l of livraisons) {
            if (l.commande && l.commande.numero_commande <= 285) {
                let totalCmdPrice = 0;
                let totalRefPrice = 0;
                let hasIssue = false;
                
                for (const line of l.lignesLivraison) {
                    if (!line.produit) continue;
                    
                    const lc = l.commande.lignesCommande.find(item => item.produit && item.produit.toString() === line.produit._id.toString());
                    const cmdPrice = lc ? lc.prix_unitaire : line.produit.prix_reference;
                    const refPrice = line.produit.prix_reference;
                    
                    totalCmdPrice += (line.quantite * cmdPrice);
                    totalRefPrice += (line.quantite * refPrice);
                }
                
                if (totalRefPrice > 0 && Math.abs(totalCmdPrice - totalRefPrice) > 10) {
                    const ratio = totalCmdPrice / totalRefPrice;
                    if (ratio > 2 || ratio < 0.5) {
                        console.log(`CMD-${l.commande.numero_commande}: Total Cmd Price = ${totalCmdPrice} | Total Ref Price = ${totalRefPrice} | Ratio = ${ratio.toFixed(1)}x`);
                    }
                }
            }
        }
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

analyze();
