const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const Livraison = require('./models/Livraison');
const Facture = require('./models/Facture');
const Commande = require('./models/Commande');
const LigneCommande = require('./models/LigneCommande');
const Produit = require('./models/Produit');
const Lot = require('./models/Lot');

async function fixLivraisonTotals() {
    try {
        const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
        await mongoose.connect(uri);
        console.log('✅ Connecté à MongoDB');

        const livraisons = await Livraison.find({}).populate('facture');
        console.log(`📊 ${livraisons.length} livraisons à vérifier.`);

        let count = 0;
        for (const livraison of livraisons) {
            let total = 0;
            
            const commandePeuplee = await Commande.findById(livraison.commande)
                .populate({
                    path: 'lignesCommande',
                    populate: { path: 'lot' }
                });

            if (commandePeuplee && commandePeuplee.lignesCommande) {
                for (const ligneLiv of (livraison.lignesLivraison || [])) {
                    // Ignorer les lignes en échec pour le calcul du montant valide
                    if (ligneLiv.statut_produit === 'ECHEC') {
                        continue;
                    }

                    const lc = commandePeuplee.lignesCommande.find(l => 
                        l.produit.toString() === (ligneLiv.produit._id || ligneLiv.produit).toString()
                    );
                    if (lc) {
                        let qteFacturation = ligneLiv.quantite || 0;
                        if (lc.lot && lc.lot.quantite_unitaire) {
                            qteFacturation = qteFacturation / lc.lot.quantite_unitaire;
                        }
                        total += qteFacturation * (lc.prix_unitaire || 0);
                    }
                }
            }

            if (total > 0 && Math.abs(total - (livraison.montant_total || 0)) > 0.1) {
                const ancienMontant = livraison.montant_total;
                await Livraison.updateOne({ _id: livraison._id }, { montant_total: total });
                
                if (livraison.facture) {
                    await Facture.updateOne({ _id: livraison.facture._id || livraison.facture }, { montant_total: total });
                }
                
                count++;
                console.log(`✅ Livraison ${livraison._id} corrigée: ${ancienMontant} -> ${total.toFixed(3)} DT`);
            }
        }

        console.log(`🎉 Fin du script. ${count} livraisons corrigées.`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur:', error);
        process.exit(1);
    }
}

fixLivraisonTotals();
