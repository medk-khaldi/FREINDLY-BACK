const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Commande = require('./models/Commande');
const Livraison = require('./models/Livraison');

async function test() {
    try {
        console.log('Connecting to:', process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        const pdvId = '6985a8f93663d77adfd75d26';
        const cmds = await Commande.find({ pointDeVente: pdvId }).select('_id');
        const cmdIds = cmds.map(c => c._id);
        
        console.log(`Found ${cmdIds.length} commands for PDV ${pdvId}`);
        
        const livs = await Livraison.find({ commande: { $in: cmdIds } });
        console.log(`Found ${livs.length} livraisons`);
        
        if (livs.length > 0) {
            const stats = {
                status: {},
                hasPaiements: 0,
                totalRevenue: 0
            };
            
            livs.forEach(l => {
                stats.status[l.statut] = (stats.status[l.statut] || 0) + 1;
                if (l.paiements && l.paiements.length > 0) stats.hasPaiements++;
                if (l.statut === 'LIVREE') stats.totalRevenue += (l.montant_total || 0);
            });
            
            console.log('Stats Summary:', stats);
            console.log('Sample Livraison (ID: ' + livs[0]._id + '):');
            console.log(JSON.stringify({
                statut: livs[0].statut,
                date_creation: livs[0].date_creation,
                paiements: livs[0].paiements,
                montant_total: livs[0].montant_total
            }, null, 2));
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

test();
