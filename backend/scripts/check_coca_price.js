const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const Produit = require('../models/Produit');

const check = async () => {
    try {
        await connectDB();
        const p = await Produit.findOne({ nom: /Coca/i });
        console.log(`Produit: ${p?.nom} | Prix Ref: ${p?.prix_reference}`);
        process.exit(0);
    } catch (error) {
        process.exit(1);
    }
};

check();
