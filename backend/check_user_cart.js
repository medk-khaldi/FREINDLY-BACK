const mongoose = require('mongoose');
require('dotenv').config();
require('./models/Client');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Client = mongoose.model('Client');
  const user = await Client.findOne({ $or: [{ nom: /mmari/i }, { prenom: /islem/i }] }).lean();
  
  if (user) {
    console.log(`=== USER: ${user.prenom} ${user.nom} ===`);
    console.log('Panier items:');
    if (user.panier) {
      user.panier.forEach((item, i) => {
        console.log(`\nItem ${i+1}:`);
        console.log(`  nom: ${item.nom}`);
        console.log(`  produitId: ${item.produitId}`);
        console.log(`  cartItemId: ${item.cartItemId}`);
        console.log(`  quantite: ${item.quantite}`);
        console.log(`  selectedLot: ${JSON.stringify(item.selectedLot)}`);
      });
    }
  } else {
    console.log('User not found');
  }

  await mongoose.disconnect();
}).catch(e => { console.error(e); process.exit(1); });
