const mongoose = require('mongoose');
require('dotenv').config();
const CategorieProduit = require('./models/CategorieProduit');

async function trimNames() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const cats = await CategorieProduit.find().setOptions({ withDeleted: true });
    
    let count = 0;
    for (const cat of cats) {
      const trimmed = cat.nom.trim();
      if (cat.nom !== trimmed) {
        console.log(`✂️ Trimming: '${cat.nom}' -> '${trimmed}'`);
        cat.nom = trimmed;
        await cat.save();
        count++;
      }
    }
    
    console.log(`\n✅ Finished. Trimmed ${count} categories.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

trimNames();
