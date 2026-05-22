const axios = require('axios');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
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

// Config
const CATEGORIES_TO_SCRAPE = [
  { url: 'https://www.carrefour.tn/boissons.html', rayon: 'Boissons' },
  { url: 'https://www.carrefour.tn/produits-frais/produits-laitiers-oeufs-et-fromages.html', rayon: 'Crèmerie et Produits Laitiers' },
  { url: 'https://www.carrefour.tn/epicerie-sucree.html', rayon: 'Épicerie Sucrée' },
  { url: 'https://www.carrefour.tn/epicerie-salee.html', rayon: 'Épicerie Salée' }
];

async function downloadImage(url, filename) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 10000
    });
    const extension = path.extname(new URL(url).pathname) || '.jpg';
    const filePath = path.join(UPLOADS_DIR, filename + extension);
    await pipeline(response.data, fs.createWriteStream(filePath));
    return `products/${filename}${extension}`;
  } catch (err) {
    console.error(`❌ Error downloading image ${url}:`, err.message);
    return null;
  }
}

async function getOrCreateCategory(name, level, parentId = null) {
  let cat = await CategorieProduit.findOne({ nom: name, niveau: level, parent: parentId });
  if (!cat) {
    cat = new CategorieProduit({
      nom: name,
      niveau: level,
      parent: parentId,
      description: `Automatiquement créé depuis Carrefour - ${name}`
    });
    await cat.save();
    console.log(`✨ Created category: [Level ${level}] ${name}`);
  }
  return cat;
}

async function scrapeCategory(url, rayonName) {
  console.log(`\n🔍 Scraping Category: ${rayonName} (${url})...`);
  try {
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(html);


    // Extraction des produits (Ceci est une estimation, les sélecteurs peuvent varier)
    // D'après le screenshot, on cherche des conteneurs de produits
    const products = [];
    
    // On cherche les scripts qui contiennent potentiellement des données JSON (Initial State)
    let jsonData = null;
    $('script').each((i, el) => {
      const content = $(el).html();
      if (content.includes('INLINED_PAGE_TYPE') || content.includes('products')) {
        // Extraction manuelle ou regex si nécessaire
      }
    });

    // Fallback on DOM parsing if JSON not found
    $('.product-item, .item-root-').each((i, el) => {
      const name = $(el).find('.item-name-, .name').text().trim();
      const priceText = $(el).find('.price-current, .item-price-').text().trim();
      const imageUrl = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
      const brand = $(el).find('.item-brand-, .brand').text().trim() || 'Carrefour';

      if (name && priceText) {
        // Nettoyage du prix: "11DT 500" -> 11.500
        const price = parseFloat(priceText.replace('DT', '.').replace(/\s/g, '')) || 0;
        products.push({ name, price, imageUrl, brand });
      }
    });

    console.log(`📦 Found ${products.length} products visually.`);

    if (products.length === 0) {
      console.log("⚠️ No products found with current selectors. Trying alternative JSON extraction...");
      // Mode fallback: Recherche de scripts de type ld+json
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const json = JSON.parse($(el).html());
          if (json['@type'] === 'ItemList' && json.itemListElement) {
            json.itemListElement.forEach(item => {
              const p = item.item;
              if (p) {
                products.push({
                  name: p.name,
                  price: p.offers?.price || 0,
                  imageUrl: p.image,
                  brand: p.brand?.name || 'Carrefour'
                });
              }
            });
          }
        } catch (e) {}
      });
    }

    // Processing
    const rayon = await getOrCreateCategory(rayonName, 1);
    
    for (const p of products.slice(0, 50)) { // Limiter à 50 par catégorie pour le test
      try {
        // Pour Division et Segment, on utilise des valeurs par défaut basées sur le Rayon si non trouvées
        const division = await getOrCreateCategory(`Général ${rayonName}`, 2, rayon._id);
        const segment = await getOrCreateCategory(`Divers ${rayonName}`, 3, division._id);

        // Gérer la Marque
        let marque = null;
        if (p.brand) {
          marque = await MarqueProduit.findOne({ nom: p.brand });
          if (!marque) {
            marque = new MarqueProduit({ nom: p.brand, description: 'Importé automatiquement de Carrefour' });
            await marque.save();
            console.log(`✨ Created brand: ${p.brand}`);
          }
        }

        const existingP = await Produit.findOne({ nom: p.name });
        if (existingP) {
          console.log(`⏭️ Skipping existing: ${p.name}`);
          continue;
        }

        const localImage = p.imageUrl ? await downloadImage(p.imageUrl, `product_${Date.now()}_${Math.floor(Math.random()*1000)}`) : null;

        const newProduit = new Produit({
          nom: p.name,
          marque: marque ? marque._id : null,
          categorie: segment._id,
          prix_reference: p.price,
          image: localImage,
          description: `Importé depuis Carrefour - ${rayonName}`,
          code_barre: `CF_${Math.floor(Math.random()*1000000000)}`, // Dummy barcode if missing
          statut: 'actif'
        });

        await newProduit.save();
        console.log(`✅ Imported: ${p.name} (${p.price} DT)`);
      } catch (err) {
        console.error(`❌ Error importing product ${p.name}:`, err.message);
      }
    }


  } catch (err) {
    console.error(`❌ Error scraping ${url}:`, err.message);
  }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("🚀 Connected to MongoDB");


  for (const cat of CATEGORIES_TO_SCRAPE) {
    await scrapeCategory(cat.url, cat.rayon);
  }

  await mongoose.disconnect();
  console.log("\n🏁 Scraping finished.");
}

run();
