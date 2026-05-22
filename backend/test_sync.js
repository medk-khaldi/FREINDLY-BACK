const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { updatePDVStats } = require('./utils/statsHelper');
const PointDeVenteStats = require('./models/PointDeVenteStats');
const PointDeVente = require('./models/PointDeVente');
const Commande = require('./models/Commande');
const Livraison = require('./models/Livraison');

async function testSync() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const pdvId = '6984baa4639ea9d551f40a3a';
        
        console.log('--- FORCING UPDATE ---');
        await updatePDVStats(pdvId);
        
        const stats = await PointDeVenteStats.findOne({ pointDeVente: pdvId });
        console.log('Resulting Stats:');
        console.log(JSON.stringify({
            totalRevenue: stats.totalRevenue,
            paymentMethods: stats.paymentMethods,
            monthlyHistory: stats.monthlyHistory
        }, null, 2));
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

testSync();
