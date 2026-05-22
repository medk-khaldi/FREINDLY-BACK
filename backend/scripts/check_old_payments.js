const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const Livraison = require('../models/Livraison');
const Commande = require('../models/Commande');

const check = async () => {
    try {
        await connectDB();
        const livraisons = await Livraison.find({ statut: 'LIVREE' }).populate('commande');
        
        console.log('--- Rapport des livraisons CMD <= 285 ---');
        for (const livraison of livraisons.slice(0, 20)) { // Just first 20 for sample
            if (livraison.commande && livraison.commande.numero_commande <= 285) {
                console.log(`CMD: ${livraison.commande.numero_commande} | Paid: ${livraison.montant_paye}/${livraison.montant_total} | Status: ${livraison.statut_paiement} | Payments Count: ${livraison.paiements?.length || 0}`);
            }
        }
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

check();
