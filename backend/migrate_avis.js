const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Avis = require('./models/Avis');

async function run() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected!');

    // Update all Avis documents that do not have userModel set
    const result = await Avis.updateMany(
      { userModel: { $exists: false } },
      { $set: { userModel: 'Client' } }
    );

    console.log(`Updated ${result.modifiedCount} legacy reviews successfully.`);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
