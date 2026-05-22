const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream/promises');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Models
const Produit = require('../models/Produit');
const CategorieProduit = require('../models/CategorieProduit');
const MarqueProduit = require('../models/MarqueProduit');

const UPLOADS_DIR = path.join(__dirname, '../uploads/products');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

async function downloadImage(url, filename) {
  if (!url || !url.startsWith('http')) return null;
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 10000
    });
    const extension = '.jpg'; // Par défaut pour Carrefour
    const fileNameWithExt = `${filename}${extension}`;
    const filePath = path.join(UPLOADS_DIR, fileNameWithExt);
    await pipeline(response.data, fs.createWriteStream(filePath));
    return `products/${fileNameWithExt}`;
  } catch (err) {
    console.error(`❌ Error downloading image ${url}:`, err.message);
    return null;
  }
}

async function getOrCreateCategory(name, parentId = null) {
  let cat = await CategorieProduit.findOne({ nom: name });
  if (!cat) {
    cat = new CategorieProduit({
      nom: name,
      parent: parentId,
      description: `Automatiquement créé depuis l'import Carrefour`
    });
    await cat.save();
    console.log(`✨ Created category: ${name}`);
  } else if (parentId && cat.parent?.toString() !== parentId.toString()) {
    // Si la catégorie existe mais n'a pas le bon parent, on pourrait le mettre à jour
    // ou simplement l'utiliser telle quelle. Ici on l'utilise.
    console.log(`ℹ️ Category exists: ${name} (using existing)`);
  }
  return cat;
}


async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🚀 Connected to MongoDB");

    const fileName = process.argv[2];
    const defaultDivision = process.argv[3];
    const defaultSegment = process.argv[4];

    if (!fileName) {
      console.error("❌ Usage: node importCarrefour.js <filename.json> <DivisionName> <SegmentName>");
      process.exit(1);
    }

    const dataPath = path.join(__dirname, '..', fileName);
    if (!fs.existsSync(dataPath)) {
      console.error(`❌ File ${fileName} not found at ${dataPath}!`);
      process.exit(1);
    }

    const { rayon: rayonName, products } = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    console.log(`📦 Found ${products.length} products to process in Rayon: ${rayonName}`);

    // Create Hierarchy
    const rayon = await getOrCreateCategory(rayonName);
    
    for (const p of products) {
      try {
        let divisionName = defaultDivision || "Boissons";
        let segmentName = defaultSegment || "Autres";

        const division = await getOrCreateCategory(divisionName, rayon._id);
        const segment = await getOrCreateCategory(segmentName, division._id);

        // Gérer la Marque
        let marque = null;
        if (p.brand) {
          const brandName = p.brand.trim();
          marque = await MarqueProduit.findOne({ nom: { $regex: new RegExp(`^${brandName}$`, 'i') } });
          if (!marque) {
            marque = new MarqueProduit({ nom: brandName, description: 'Marque importée de Carrefour' });
            await marque.save();
            console.log(`✨ Created brand: ${brandName}`);
          }
        }

        // Télécharger l'image
        const imagePath = await downloadImage(p.imageUrl, `product_${Date.now()}_${Math.floor(Math.random()*1000)}`);

        // Upsert Produit
        const cleanName = p.name.split('\n')[0].trim();
        let produit = await Produit.findOne({ nom: cleanName });

        if (produit) {
          console.log(`🔄 Updating existing: ${cleanName}`);
          produit.prix_reference = parseFloat(p.price) || 0;
          if (imagePath) produit.image = imagePath;
          produit.marque = marque ? marque._id : produit.marque;
          produit.categorie = segment._id;
        } else {
          produit = new Produit({
            nom: cleanName,
            marque: marque ? marque._id : null,
            categorie: segment._id,
            prix_reference: parseFloat(p.price) || 0,
            image: imagePath,
            description: p.name.replace('\n', ' - '),
            code_barre: `CF_${Math.floor(Math.random()*1000000000)}`,
            statut: 'actif'
          });
          console.log(`✅ Importing new: ${cleanName}`);
        }

        await produit.save();
      } catch (err) {
        console.error(`❌ Error importing ${p.name}:`, err.message);
      }
    }


    console.log("\n🏁 Import finished successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  }
}

run();
