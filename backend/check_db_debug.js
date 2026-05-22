const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Produit = require('./models/Produit');
const StockConsolide = require('./models/StockConsolide');

async function checkDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');
    
    const productCount = await Produit.countDocuments({ isDeleted: { $ne: true } });
    console.log(`Visible Products: ${productCount}`);
    
    const stockCount = await StockConsolide.countDocuments();
    console.log(`StockConsolide records: ${stockCount}`);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkDB();
