const mongoose = require('mongoose');
require('dotenv').config();
const Product = require('./models/Produit');
const Categorie = require('./models/CategorieProduit');

async function rescueFullChain() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🚀 Connected to MongoDB");

    const products = await Product.find({}, 'categorie');
    const usedCatIds = [...new Set(products.map(p => p.categorie ? p.categorie.toString() : null).filter(id => id))];
    
    console.log(`📊 Checking ${usedCatIds.length} categories used by products...`);

    const restoreRecursive = async (id) => {
      const cat = await Categorie.findOne({ _id: id }).setOptions({ withDeleted: true });
      if (!cat) return;

      if (cat.isDeleted) {
        console.log(`✨ Restoring: [${cat.nom}] (ID: ${cat._id})`);
        await cat.restore();
      }

      if (cat.parent) {
        await restoreRecursive(cat.parent);
      }
    };

    for (const id of usedCatIds) {
      await restoreRecursive(id);
    }

    console.log(`\n✅ Finished! All parent chains for used categories have been restored.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

rescueFullChain();
