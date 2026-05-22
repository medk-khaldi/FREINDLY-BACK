const mongoose = require('mongoose');
require('dotenv').config();

async function removeUniqueIndex() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('formats');

    // Lister tous les index
    const indexes = await collection.indexes();
    console.log('\n📋 Index existants:');
    indexes.forEach(index => {
      console.log(`  - ${index.name}:`, index.key);
    });

    // Supprimer l'index unique sur 'nom' s'il existe
    try {
      await collection.dropIndex('nom_1');
      console.log('\n✅ Index unique "nom_1" supprimé avec succès');
    } catch (err) {
      if (err.code === 27) {
        console.log('\n⚠️  Index "nom_1" n\'existe pas (déjà supprimé ou jamais créé)');
      } else {
        throw err;
      }
    }

    // Vérifier les index après suppression
    const indexesAfter = await collection.indexes();
    console.log('\n📋 Index après suppression:');
    indexesAfter.forEach(index => {
      console.log(`  - ${index.name}:`, index.key);
    });

    await mongoose.connection.close();
    console.log('\n✅ Connexion fermée');
    console.log('\n🎉 Vous pouvez maintenant créer des formats avec le même nom mais des volumes différents !');
  } catch (err) {
    console.error('❌ Erreur:', err);
    process.exit(1);
  }
}

removeUniqueIndex();
