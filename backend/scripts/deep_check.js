const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const Livraison = require('../models/Livraison');

const check = async () => {
    try {
        await connectDB();
        const livraisons = await Livraison.find({ statut: 'LIVREE' }).populate('commande').limit(5);
        
        for (const l of livraisons) {
             console.log(`LIV: ${l._id} | Paiements: ${JSON.stringify(l.paiements)}`);
        }
        process.exit(0);
    } catch (error) {
        process.exit(1);
    }
};

check();
