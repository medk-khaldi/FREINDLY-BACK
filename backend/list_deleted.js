const mongoose = require('mongoose');
require('dotenv').config();
const CategorieProduit = require('./models/CategorieProduit');

async function listDeleted() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const all = await CategorieProduit.find().setOptions({ withDeleted: true });
    const deleted = all.filter(c => c.isDeleted);
    console.log(`🗑️ Total deleted categories: ${deleted.length}`);
    deleted.forEach(c => {
      console.log(`- [${c.nom}] (ID: ${c._id})`);
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

listDeleted();
