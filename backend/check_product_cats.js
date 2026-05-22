const mongoose = require('mongoose');
require('dotenv').config();
const Product = require('./models/Produit');
const Categorie = require('./models/CategorieProduit');

async function checkProductCats() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const products = await Product.find().populate('categorie');
    console.log(`📊 Total products: ${products.length}`);

    const categoriesMap = new Map();
    products.forEach(p => {
      if (p.categorie) {
        const id = p.categorie._id.toString();
        const existing = categoriesMap.get(id) || { nom: p.categorie.nom, count: 0 };
        existing.count++;
        categoriesMap.set(id, existing);
      } else {
        const count = categoriesMap.get('NONE') || 0;
        categoriesMap.set('NONE', count + 1);
      }
    });

    console.log("\n🔍 Analyzing categories used by products:");
    for (const [id, info] of categoriesMap.entries()) {
      if (id === 'NONE') {
        console.log(`- [NONE]: ${info} products have no category assigned.`);
        continue;
      }
      
      const dbCat = await Categorie.findOne({ _id: id }).setOptions({ withDeleted: true });
      if (!dbCat) {
        console.log(`❌ NOT FOUND: Category '${info.nom}' (ID: ${id}) used by ${info.count} products is MISSING from DB!`);
      } else if (dbCat.isDeleted) {
        console.log(`⚠️ DELETED: Category '${dbCat.nom}' (ID: ${id}) used by ${info.count} products is SOFT-DELETED!`);
      } else {
        // Active
        const parent = dbCat.parent ? await Categorie.findById(dbCat.parent).setOptions({ withDeleted: true }) : null;
        if (dbCat.parent && !parent) {
          console.log(`⚠️ ORPHAN PARENT: Category '${dbCat.nom}' (ID: ${id}) used by ${info.count} products has a missing parent ID: ${dbCat.parent}`);
        } else if (parent && parent.isDeleted) {
           console.log(`⚠️ DELETED PARENT: Category '${dbCat.nom}' (ID: ${id}) used by ${info.count} products has a DELETED parent: '${parent.nom}'`);
        } else {
           console.log(`✅ OK: '${dbCat.nom}' (ID: ${id}) used by ${info.count} products.`);
        }
      }
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkProductCats();
