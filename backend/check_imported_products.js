const mongoose = require('mongoose');
require('dotenv').config();
const Product = require('./models/Produit');
const Categorie = require('./models/CategorieProduit'); // Register model

async function checkImported() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const products = await Product.find({ marque: { $exists: true } }).sort({ createdAt: -1 }).limit(10).populate('categorie');
    console.log(JSON.stringify(products, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkImported();
