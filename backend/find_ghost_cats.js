const mongoose = require('mongoose');
require('dotenv').config();
const CategorieProduit = require('./models/CategorieProduit');

async function findGhostCategories() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const allActive = await CategorieProduit.find({ isDeleted: false });
    
    // Build tree in memory similar to backend
    const buildTree = (parentId = null) => {
      return allActive
        .filter(cat => {
          const catParentId = cat.parent ? cat.parent.toString() : null;
          const targetParentId = parentId ? parentId.toString() : null;
          return catParentId === targetParentId;
        })
        .map(cat => ({
          _id: cat._id.toString(),
          nom: cat.nom,
          subcategories: buildTree(cat._id)
        }));
    };

    const tree = buildTree(null);
    
    // Flatten the tree to get all reachable IDs
    const reachableIds = new Set();
    const flatten = (items) => {
      items.forEach(i => {
        reachableIds.add(i._id);
        flatten(i.subcategories);
      });
    };
    flatten(tree);

    console.log(`📊 Total Active Categories in DB: ${allActive.length}`);
    console.log(`🌲 Total Reachable Categories in Tree: ${reachableIds.size}`);

    const ghostCategories = allActive.filter(c => !reachableIds.has(c._id.toString()));

    if (ghostCategories.length > 0) {
      console.log(`\n👻 Found ${ghostCategories.length} GHOST categories (Active but not in Tree):`);
      ghostCategories.forEach(c => {
        console.log(`- [${c.nom}] (ID: ${c._id}) -> Parent ID: ${c.parent || 'null'}`);
      });
      console.log("\n💡 Possible reasons: Their parent is deleted or they are root categories but the tree logic misses them?");
    } else {
      console.log("\n✨ No ghost categories found. Everything in DB is in the Tree.");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

findGhostCategories();
