const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Client = require('./models/Client');

const DB_URI = 'mongodb+srv://louay_benali:rDmBFugpa3efXYH7@cluster0.tk1av5b.mongodb.net/Projet_pfe';

async function run() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(DB_URI);
  console.log('✅ Connected successfully!');

  const email = 'slayem@gmail.com';
  const newPassword = 'password123';

  console.log(`\n🔍 Searching for user ${email}...`);
  const user = await Client.findOne({ email });
  if (!user) {
    console.log('❌ User not found!');
    await mongoose.connection.close();
    return;
  }

  console.log('✅ User found! Hashing new password...');
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  console.log('💾 Saving new password to DB...');
  user.password = hashedPassword;
  await user.save();
  console.log(`🎉 Password for ${email} has been successfully reset to "${newPassword}"!`);

  await mongoose.connection.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
