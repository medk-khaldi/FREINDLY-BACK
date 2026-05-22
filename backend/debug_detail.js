const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Commande = require('./models/Commande');
const Livraison = require('./models/Livraison');

async function debugDetail() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const pdvId = '6984baa4639ea9d551f40a3a'; // Supermarché Central
        
        const cmds = await Commande.find({ pointDeVente: pdvId }).select('_id');
        const cmdIds = cmds.map(c => c._id);
        
        console.log(`Commands for Central: ${cmdIds.length}`);
        
        const livs = await Livraison.find({ commande: { $in: cmdIds } });
        console.log(`Total livraisons: ${livs.length}`);
        
        const statusMap = {};
        livs.forEach(l => {
            statusMap[l.statut] = (statusMap[l.statut] || 0) + 1;
        });
        console.log('Status breakdown:', statusMap);

        const livree = livs.filter(l => l.statut === 'LIVREE');
        if (livree.length > 0) {
            console.log('Sample LIVREE:', {
                id: livree[0]._id,
                date: livree[0].date_creation,
                typeOfDate: typeof livree[0].date_creation,
                isDate: livree[0].date_creation instanceof Date
            });
        }
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugDetail();
