const mongoose = require('mongoose');
require('dotenv').config();
const CategorieProduit = require('./models/CategorieProduit');

async function checkHanging() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const cats = await CategorieProduit.find({ isDeleted: false }).populate('parent', 'nom');
    
    console.log("🔍 Checking for hanging categories (Root categories that aren't main Rayons)...");
    
    const knownRayons = ["Boissons", "Crèmerie et Produits Laitiers", "Épicerie Sucrée", "Épicerie Salée"];
    
    const rootCats = cats.filter(c => !c.parent);
    
    rootCats.forEach(rc => {
      if (!knownRayons.includes(rc.nom)) {
        console.log(`⚠️ HANGING ROOT: [${rc.nom}] (ID: ${rc._id})`);
        const children = cats.filter(c => c.parent && c.parent._id.toString() === rc._id.toString());
        if (children.length > 0) {
          console.log(`   └─ Has ${children.length} children: ${children.map(c => c.nom).join(', ')}`);
        }
      }
    });

    console.log("\n🔍 Checking for disconnected levels (Missing links)...");
    cats.forEach(c => {
      if (c.parent) {
        const parent = cats.find(p => p._id.toString() === c.parent._id.toString());
        if (!parent) {
          console.log(`❌ DISCONNECTED: [${c.nom}] has parent ID ${c.parent._id} which is NOT in active list!`);
        }
      }
    });

    console.log("\n🏁 Check complete.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkHanging();
