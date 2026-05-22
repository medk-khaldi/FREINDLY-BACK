const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Avis = require('./models/Avis');
const Client = require('./models/Client');
const PointDeVente = require('./models/PointDeVente');

async function test() {
    try {
        console.log('Connecting to:', process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        const totalAvis = await Avis.countDocuments();
        console.log(`Total Avis in DB: ${totalAvis}`);

        const sampleAvis = await Avis.find().limit(5).populate('client').lean();
        console.log('Sample Avis:', JSON.stringify(sampleAvis, null, 2));

        const clients = await Client.find().limit(3).select('_id email nom prenom').lean();
        console.log('Sample Clients:', clients);

        const pdvs = await PointDeVente.find().limit(3).select('_id email nom').lean();
        console.log('Sample PDVs:', pdvs);

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

test();
