const mongoose = require('mongoose');
require('dotenv').config();
const CategorieProduit = require('./models/CategorieProduit');

async function listAll() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const cats = await CategorieProduit.find({ isDeleted: false }).populate('parent', 'nom');
    console.log(`--- Total Active Categories: ${cats.length} ---`);
    cats.forEach(c => {
      console.log(`[${c.nom}] -> Parent: ${c.parent ? c.parent.nom : 'ROOT'}`);
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

listAll();
