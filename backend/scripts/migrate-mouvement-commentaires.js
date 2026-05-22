/**
 * Script de migration pour mettre à jour les commentaires des mouvements de stock
 * Convertit les IDs MongoDB bruts en format professionnel
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const MouvementStock = require('../models/MouvementStock');
const Livraison = require('../models/Livraison');
const Commande = require('../models/Commande');
const Retour = require('../models/Retour');
const Voyage = require('../models/Voyage');
const { formatIdBadge } = require('../utils/idFormatter');

async function migrateCommentaires() {
  try {
    console.log('🔄 Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB\n');

    // Récupérer tous les mouvements avec des commentaires
    const mouvements = await MouvementStock.find({ 
      commentaire: { $exists: true, $ne: null, $ne: '' } 
    }).populate('reference');

    console.log(`📊 ${mouvements.length} mouvements trouvés avec des commentaires\n`);

    let updated = 0;
    let skipped = 0;

    for (const mouvement of mouvements) {
      let newCommentaire = mouvement.commentaire;
      let modified = false;

      // Pattern pour détecter les IDs MongoDB (24 caractères hexadécimaux)
      const mongoIdPattern = /#([0-9a-f]{24})/gi;
      
      // Remplacer les IDs de voyage
      if (mouvement.commentaire.includes('voyage #')) {
        newCommentaire = newCommentaire.replace(
          /voyage #([0-9a-f]{24})/gi,
          (match, id) => {
            modified = true;
            return `voyage ${formatIdBadge(id, 'voyage')}`;
          }
        );
      }

      // Remplacer les IDs de commande
      if (mouvement.commentaire.includes('commande #')) {
        newCommentaire = newCommentaire.replace(
          /commande #([0-9a-f]{24})/gi,
          (match, id) => {
            modified = true;
            return `commande ${formatIdBadge(id, 'commande')}`;
          }
        );
      }

      // Remplacer les IDs de livraison
      if (mouvement.commentaire.match(/^Livraison #([0-9a-f]{24})/i)) {
        newCommentaire = newCommentaire.replace(
          /^Livraison #([0-9a-f]{24})/i,
          (match, id) => {
            modified = true;
            return `Livraison ${formatIdBadge(id, 'livraison')}`;
          }
        );
      }

      // Remplacer les IDs de ligne commande dans les retours
      if (mouvement.commentaire.includes('Ligne commande #')) {
        newCommentaire = newCommentaire.replace(
          /Ligne commande #([0-9a-f]{24})/gi,
          (match, id) => {
            modified = true;
            // Pour les lignes de commande, on essaie de récupérer l'ID de la commande
            // depuis la référence si c'est un retour
            if (mouvement.reference_type === 'Retour' && mouvement.reference) {
              return 'Retour produit';
            }
            return `Ligne commande ${formatIdBadge(id, 'commande')}`;
          }
        );
      }

      if (modified) {
        mouvement.commentaire = newCommentaire;
        await mouvement.save();
        updated++;
        console.log(`✅ Mis à jour: "${mouvement.commentaire.substring(0, 50)}..."`);
      } else {
        skipped++;
      }
    }

    console.log('\n📊 Résumé de la migration:');
    console.log(`   ✅ Mis à jour: ${updated}`);
    console.log(`   ⏭️  Ignorés: ${skipped}`);
    console.log(`   📝 Total: ${mouvements.length}`);

  } catch (error) {
    console.error('❌ Erreur lors de la migration:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Déconnecté de MongoDB');
  }
}

// Exécuter la migration
migrateCommentaires();
