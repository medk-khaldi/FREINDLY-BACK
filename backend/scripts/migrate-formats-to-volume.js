const mongoose = require('mongoose');
require('dotenv').config();

const Format = require('../models/Format');

async function migrateFormats() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');

    // Trouver tous les formats
    const formats = await Format.find();
    console.log(`\n📋 ${formats.length} format(s) trouvé(s)\n`);

    let updated = 0;
    for (const format of formats) {
      // Si le format a une propriété 'description' (ancien modèle)
      if (format.description !== undefined) {
        console.log(`🔄 Migration du format: ${format.nom}`);
        console.log(`   Description: ${format.description || 'vide'}`);
        
        // Copier description vers volume si volume n'existe pas
        if (!format.volume && format.description) {
          format.volume = format.description;
          console.log(`   ✅ Volume défini: ${format.volume}`);
        }
        
        // Supprimer l'ancienne propriété description
        format.description = undefined;
        await format.save();
        updated++;
      } else {
        console.log(`✓ Format déjà à jour: ${format.nom} (volume: ${format.volume || 'non défini'})`);
      }
    }

    console.log(`\n✅ Migration terminée: ${updated} format(s) mis à jour`);
    
    await mongoose.connection.close();
    console.log('✅ Connexion fermée');
  } catch (err) {
    console.error('❌ Erreur:', err);
    process.exit(1);
  }
}

migrateFormats();
