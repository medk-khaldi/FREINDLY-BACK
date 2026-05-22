
const mongoose = require('mongoose');
const Livraison = require('./models/Livraison');
const Commande = require('./models/Commande');
require('dotenv').config();

async function check341() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const cmd = await Commande.findOne({ numero_commande: 341 });
        if (!cmd) {
            console.log('Command 341 not found');
            return;
        }
        console.log('Command 341 ID:', cmd._id);

        const livraisons = await Livraison.find({ commande: cmd._id });
        console.log(`Found ${livraisons.length} livraisons`);

        livraisons.forEach(l => {
            console.log('--- Livraison ---');
            console.log('ID:', l._id);
            console.log('Statut:', l.statut);
            console.log('Montant Total:', l.montant_total);
            console.log('Montant Payé:', l.montant_paye);
            console.log('Statut Paiement:', l.statut_paiement);
            console.log('Paiements:', l.paiements);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.connection.close();
    }
}

check341();
