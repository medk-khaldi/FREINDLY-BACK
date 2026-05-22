const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const Produit = require('../models/Produit');
const Format = require('../models/Format');
const Unite = require('../models/Unite');
const { extractWeight } = require('../utils/weightUtils');

const updateWeights = async () => {
  try {
    await connectDB();
    console.log('✅ Connecté à MongoDB');

    // On cherche les produits qui n'ont pas de poids ou qui ont un poids de 0
    const produits = await Produit.find({
      $or: [
        { poids_unitaire: { $exists: false } },
        { poids_unitaire: null },
        { poids_unitaire: 0 }
      ]
    }).populate('format unite');

    console.log(`🔍 Analyse de ${produits.length} produits sans poids...`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const produit of produits) {
      let weight = null;
      let source = '';

      // 1. Tenter l'extraction via le format
      if (produit.format && produit.format.nom) {
        weight = extractWeight(produit.format.nom, produit.unite?.nom);
        if (weight) source = `Basé sur le format: ${produit.format.nom}`;
      }

      // 2. Si échec, tenter l'extraction via le nom du produit
      if (!weight && produit.nom) {
        weight = extractWeight(produit.nom, produit.unite?.nom);
        if (weight) source = `Basé sur le nom: ${produit.nom}`;
      }
      
      if (weight !== null && weight > 0) {
        produit.poids_unitaire = weight;
        produit.poids_estime = true;
        await produit.save();
        console.log(`✅ [${produit.nom}] -> ${weight} kg (${source})`);
        updatedCount++;
      } else {
        const reason = produit.format ? `Impossible d'extraire du format "${produit.format.nom}"` : "Aucun format défini";
        console.log(`⚠️ [${produit.nom}] ${reason} (et rien dans le nom)`);
        skippedCount++;
      }
    }

    console.log('\n--- BILAN ---');
    console.log(`✅ Produits mis à jour : ${updatedCount}`);
    console.log(`⚠️ Produits ignorés/non reconnus : ${skippedCount}`);
    console.log('-------------\n');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur critique lors de la migration:', err);
    process.exit(1);
  }
};

updateWeights();
