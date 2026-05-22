const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Facture = require('./models/Facture');
const Livraison = require('./models/Livraison');
const Commande = require('./models/Commande');
const PointDeVente = require('./models/PointDeVente');
const Produit = require('./models/Produit');
const controller = require('./controllers/facture.controller');

async function testFactureById() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/pfe_cloud");
        console.log('Connected to MongoDB');

        const livraison = await Livraison.findOne({ statut: { $in: ['LIVREE', 'PARTIELLE'] } });
        if (!livraison) {
            console.log('No eligible livraison found in DB');
            return;
        }

        console.log('Testing ID:', livraison._id);
        
        const req = { params: { id: livraison._id.toString() } };
        const res = {
            status: function(code) {
                console.log('STATUS:', code);
                return this;
            },
            json: function(data) {
                console.log('JSON RESULT:', JSON.stringify(data, null, 2));
            }
        };

        await controller.getFactureById(req, res);

    } catch (err) {
        console.error('TEST ERROR:', err);
    } finally {
        await mongoose.disconnect();
    }
}

testFactureById();
