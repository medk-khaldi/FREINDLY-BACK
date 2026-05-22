const mongoose = require('mongoose');
const DB_URI = 'mongodb+srv://louay_benali:rDmBFugpa3efXYH7@cluster0.tk1av5b.mongodb.net/Projet_pfe';
const Conversation = require('./models/Conversation');

async function run() {
  console.log('Connecting to database...');
  await mongoose.connect(DB_URI);
  console.log('Connected!');

  const supportConvs = await Conversation.find({ type: 'support' }).lean();
  console.log(`Total support conversations found: ${supportConvs.length}`);

  supportConvs.forEach(conv => {
    console.log(`\n- Conversation ID: ${conv._id}`);
    console.log(`  Client: ${conv.metadata?.clientUsername} (${conv.metadata?.clientEmail})`);
    console.log(`  Status: ${conv.metadata?.status}`);
    console.log(`  Rating:`, JSON.stringify(conv.metadata?.rating, null, 2));
  });

  await mongoose.connection.close();
}

run();
