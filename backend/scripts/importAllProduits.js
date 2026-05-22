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
    const extension = '.jpg'; 
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
      description: `Automatiquement créé depuis l'import de produits`
    });
    await cat.save();
    console.log(`✨ Created category: ${name}`);
  }
  return cat;
}

const PRODUIT_DIR = path.join(__dirname, '../produit');

// Files that were added recently (should be imported LAST)
const NEW_FILES = [
  'Jus.json',
  'Sirops.json',
  'Energétiques.json',
  'Eaux Minérales.json',
  'Boissons Gazeuses.json',
  'Eaux Gazeifiées.json'
];

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🚀 Connected to MongoDB");

    const allFiles = fs.readdirSync(PRODUIT_DIR).filter(f => f.endsWith('.json'));
    
    // Split into existing and new
    const existingFiles = allFiles.filter(f => !NEW_FILES.includes(f));
    const newFiles = allFiles.filter(f => NEW_FILES.includes(f));

    // Order: Existing first, then new
    const filesToProcess = [...existingFiles, ...newFiles];

    console.log(`📂 Found ${filesToProcess.length} files to process.`);

    for (const fileName of filesToProcess) {
      const dataPath = path.join(PRODUIT_DIR, fileName);
      const categoryNameFromFile = fileName.replace('.json', '');
      
      console.log(`\n📄 Processing file: ${fileName} (Category: ${categoryNameFromFile})`);
      
      const fileContent = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const rayonName = fileContent.rayon || "Autres";
      const products = fileContent.products || [];

      console.log(`📦 Found ${products.length} products in Rayon: ${rayonName}`);

      // Create Hierarchy: Rayon -> Division (Category Name) -> Segment (Default "Général" or similar)
      const rayon = await getOrCreateCategory(rayonName);
      const division = await getOrCreateCategory(categoryNameFromFile, rayon._id);
      
      for (const p of products) {
        try {
          // Gérer la Marque
          let marque = null;
          if (p.brand) {
            const brandName = p.brand.trim();
            marque = await MarqueProduit.findOne({ nom: { $regex: new RegExp(`^${brandName}$`, 'i') } });
            if (!marque) {
              marque = new MarqueProduit({ nom: brandName, description: 'Marque importée' });
              await marque.save();
              console.log(`✨ Created brand: ${brandName}`);
            }
          }

          // Check if product already exists (by name)
          let produit = await Produit.findOne({ nom: p.name.trim() });

          if (produit) {
            console.log(`🔄 Skipping/Updating existing: ${p.name}`);
            // Update only if needed, or skip to save time
            continue; 
          }

          // Télécharger l'image (optionnel: on peut sauter si on veut aller vite)
          const imagePath = await downloadImage(p.imageUrl, `product_${Date.now()}_${Math.floor(Math.random()*1000)}`);

          produit = new Produit({
            nom: p.name.trim(),
            marque: marque ? marque._id : null,
            categorie: division._id,
            prix_reference: parseFloat(p.price) || 0,
            image: imagePath,
            description: p.name,
            code_barre: `IMP_${Math.floor(Math.random()*1000000000)}`,
            statut: 'actif'
          });

          await produit.save();
          console.log(`✅ Imported: ${p.name}`);
        } catch (err) {
          console.error(`❌ Error importing ${p.name}:`, err.message);
        }
      }
    }

    console.log("\n🏁 All imports finished!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  }
}

run();
