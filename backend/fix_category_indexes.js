const mongoose = require('mongoose');
require('dotenv').config();
const CategorieProduit = require('./models/CategorieProduit');

async function fixIndexes() {
  try {
    console.log("🔄 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected.");

    const collection = mongoose.connection.collection('categorieproduits');

    console.log("🔍 Checking current indexes...");
    const indexes = await collection.indexes();
    console.log("Current indexes:", indexes.map(i => i.name));

    // Drop old nom_1 if it exists
    if (indexes.find(i => i.name === 'nom_1')) {
      console.log("🗑️ Dropping old index 'nom_1'...");
      await collection.dropIndex('nom_1');
      console.log("✅ Old index dropped.");
    }

    console.log("🏗️ Re-syncing indexes from model...");
    await CategorieProduit.syncIndexes();
    
    const finalIndexes = await collection.indexes();
    console.log("🚀 Final indexes:", finalIndexes.map(i => i.name));

    console.log("\n✨ Fix completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error fixing indexes:", err);
    process.exit(1);
  }
}

fixIndexes();
