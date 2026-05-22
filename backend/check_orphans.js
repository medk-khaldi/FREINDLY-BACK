const mongoose = require('mongoose');
require('dotenv').config();
const CategorieProduit = require('./models/CategorieProduit');

async function checkOrphans() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🚀 Connected to MongoDB");

    // Fetch ALL categories including deleted ones to find orphans
    const all = await CategorieProduit.find().setOptions({ withDeleted: true });
    console.log(`📊 Total categories in DB: ${all.length}`);

    const active = all.filter(c => !c.isDeleted);
    console.log(`✅ Active categories: ${active.length}`);

    const deleted = all.filter(c => c.isDeleted);
    console.log(`🗑️ Deleted categories: ${deleted.length}`);

    const orphans = [];
    for (const cat of active) {
      if (cat.parent) {
        const parent = all.find(p => p._id.toString() === cat.parent.toString());
        if (!parent) {
          orphans.push({ cat, reason: "Parent missing from DB" });
        } else if (parent.isDeleted) {
          orphans.push({ cat, reason: `Parent '${parent.nom}' is DELETED` });
        }
      }
    }

    if (orphans.length > 0) {
      console.log(`\n❌ Found ${orphans.length} orphaned active categories:`);
      orphans.forEach(o => {
        console.log(`- [${o.cat.nom}] (ID: ${o.cat._id}) -> ${o.reason}`);
      });
      console.log("\n💡 Recommendation: Set their parent to 'null' or restore their parent.");
    } else {
      console.log("\n✨ No orphaned active categories found.");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkOrphans();
