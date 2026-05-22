const mongoose = require('mongoose');
require('dotenv').config();
require('./models/Produit');
require('./models/Lot');
require('./models/LigneCommande');
require('./models/Commande');
require('./models/Livraison');
require('./models/Facture');
require('./models/Client');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Produit = mongoose.model('Produit');
  const Client = mongoose.model('Client');

  const lban = await Produit.findOne({ nom: /lban/i }).populate('lots').lean();
  console.log('=== LBAN lots from product.lots (populated) ===');
  for (const lot of lban.lots) {
    console.log(`  _id: ${lot._id}, nom: ${lot.nom}, qte: ${lot.quantite_unitaire}`);
  }

  // Check what selectedLot looks like in client carts
  const clients = await Client.find({ 'panier.0': { $exists: true } }).lean();
  for (const c of clients) {
    const lbanItems = c.panier.filter(p => {
      const id = (p.produitId || '').toString();
      return id === lban._id.toString();
    });
    if (lbanItems.length > 0) {
      console.log(`\n=== CLIENT: ${c.prenom} ${c.nom} ===`);
      for (const item of lbanItems) {
        console.log(`  cartItemId: ${item.cartItemId}`);
        console.log(`  selectedLot: ${JSON.stringify(item.selectedLot)}`);
        console.log(`  quantite: ${item.quantite}`);
      }
    }
  }

  // Check: what does the frontend actually send? Let me look at a cart item from localStorage perspective
  // The key question: does selectedLot._id match any of the lot IDs?
  console.log('\n=== LOT ID CHECK ===');
  const lotIds = lban.lots.map(l => l._id.toString());
  console.log('Valid lot IDs:', lotIds);

  await mongoose.disconnect();
}).catch(e => { console.error(e); process.exit(1); });
