const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const User = require('../models/Utilisateur');

async function testQuery() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const users = await User.find({}).limit(5);
    console.log('Users found:', users.length);
    users.forEach(u => console.log(`- ${u.username} (Email: ${u.email}, isDeleted: ${u.isDeleted})`));

    const specificUser = await User.findOne({ email: 'superviseur@platform.com' });
    console.log('Superviseur found:', specificUser ? 'Yes' : 'No');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testQuery();
