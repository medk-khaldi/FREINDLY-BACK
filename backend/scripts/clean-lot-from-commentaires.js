/**
 * Script pour nettoyer les informations de lot des commentaires
 * Les informations de lot sont maintenant uniquement dans lot_info
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const MouvementStock = require('../models/MouvementStock');

async function cleanLotFromCommentaires() {
  try {
    console.log('🔄 Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB\n');

    // Récupérer tous les mouvements avec des commentaires contenant des informations de lot
    const mouvements = await MouvementStock.find({ 
      commentaire: { 
        $exists: true, 
        $regex: /\[.*\]/ 
      } 
    });

    console.log(`📊 ${mouvements.length} mouvements trouvés avec des informations de lot dans les commentaires\n`);

    let updated = 0;
    let skipped = 0;

    for (const mouvement of mouvements) {
      const oldCommentaire = mouvement.commentaire;
      
      // Supprimer tout ce qui est entre crochets (y compris les crochets)
      const newCommentaire = oldCommentaire.replace(/\s*\[.*?\]\s*/g, '').trim();
      
      if (newCommentaire !== oldCommentaire) {
        mouvement.commentaire = newCommentaire;
        await mouvement.save();
        updated++;
        console.log(`✅ Nettoyé:`);
        console.log(`   Avant: "${oldCommentaire}"`);
        console.log(`   Après: "${newCommentaire}"\n`);
      } else {
        skipped++;
      }
    }

    console.log('📊 Résumé du nettoyage:');
    console.log(`   ✅ Nettoyés: ${updated}`);
    console.log(`   ⏭️  Ignorés: ${skipped}`);
    console.log(`   📝 Total: ${mouvements.length}`);

  } catch (error) {
    console.error('❌ Erreur lors du nettoyage:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Déconnecté de MongoDB');
  }
}

// Exécuter le nettoyage
cleanLotFromCommentaires();
