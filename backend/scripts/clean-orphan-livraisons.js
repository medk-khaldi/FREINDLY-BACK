/**
 * Script pour nettoyer les livraisons orphelines
 * (livraisons qui référencent des commandes supprimées)
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });

const Livraison = require('../models/Livraison');
const Commande = require('../models/Commande');

async function cleanOrphanLivraisons() {
  try {
    // Connexion à la base de données
    const dbUri = process.env.MONGO_URI || 'mongodb://localhost:27017/gestion_stock';
    await mongoose.connect(dbUri);
    console.log('✅ Connecté à MongoDB');

    // Récupérer toutes les livraisons
    const livraisons = await Livraison.find();
    console.log(`\n📦 ${livraisons.length} livraisons trouvées\n`);

    let livraisonsOrphelines = [];

    for (const livraison of livraisons) {
      if (!livraison.commande) {
        console.log(`⚠️ Livraison ${livraison._id} n'a pas de commande`);
        livraisonsOrphelines.push(livraison._id);
        continue;
      }

      // Vérifier si la commande existe
      const commande = await Commande.findById(livraison.commande);
      
      if (!commande) {
        console.log(`❌ Livraison ${livraison._id} référence une commande inexistante: ${livraison.commande}`);
        livraisonsOrphelines.push(livraison._id);
      }
    }

    console.log(`\n📊 ${livraisonsOrphelines.length} livraisons orphelines trouvées`);

    if (livraisonsOrphelines.length > 0) {
      const confirmation = process.argv[2] === '--confirm';
      
      if (confirmation) {
        // Supprimer les livraisons orphelines
        const result = await Livraison.deleteMany({ _id: { $in: livraisonsOrphelines } });
        console.log(`✅ ${result.deletedCount} livraisons orphelines supprimées`);
      } else {
        console.log('\n⚠️ Pour supprimer ces livraisons, exécutez:');
        console.log('   node clean-orphan-livraisons.js --confirm');
      }
    } else {
      console.log('✅ Aucune livraison orpheline trouvée');
    }

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Déconnecté de MongoDB');
  }
}

// Exécuter le script
cleanOrphanLivraisons();
