const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PointDeVenteStats = require('./models/PointDeVenteStats');
const PointDeVente = require('./models/PointDeVente');

async function find() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const stats = await PointDeVenteStats.find().populate('pointDeVente');
        
        console.log('--- ALL PDV STATS ---');
        stats.forEach(s => {
            console.log(`PDV: ${s.pointDeVente?.nom} (ID: ${s.pointDeVente?._id})`);
            console.log(`  Orders: ${s.orderCount}, Revenue: ${s.totalRevenue}, Success: ${s.successRate}%`);
            console.log(`  Monthly History:`, JSON.stringify(s.monthlyHistory, null, 2));
            console.log(`  Payment Methods:`, JSON.stringify(s.paymentMethods, null, 2));
            console.log('---------------------');
        });
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

find();
