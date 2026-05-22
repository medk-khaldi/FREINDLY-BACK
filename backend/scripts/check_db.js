const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Produit = require('../models/Produit');

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const p = await Produit.findOne({ nom: /Eau minérale Délice/ });
  console.log("🔍 Sample Product in DB:");
  console.log(JSON.stringify(p, null, 2));
  process.exit(0);
}

check();
