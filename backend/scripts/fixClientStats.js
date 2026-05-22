const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Client = require('../models/Client');
const Commande = require('../models/Commande');

const fixClientStats = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pfe-platform');
    console.log('✅ Connecté à MongoDB');

    const clients = await Client.find();
    console.log(`🔍 Traitement de ${clients.length} clients...`);

    for (const client of clients) {
      // Trouver toutes les commandes de ce client (exclure les annulées si possible, mais ici on va tout compter pour correspondre à "Total Commandes")
      const commandes = await Commande.find({ client: client._id, statut: { $ne: 'ANNULEE' } });
      
      const totalDepense = commandes.reduce((sum, cmd) => sum + (cmd.total || 0), 0);
      const nombreCommandes = commandes.length;
      
      client.totalDepense = totalDepense;
      client.nombreCommandes = nombreCommandes;
      
      if (commandes.length > 0) {
        // Trier par date pour trouver la dernière commande
        const lastCmd = commandes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        client.derniereCommande = lastCmd.createdAt;
      }

      await client.save();
      console.log(`✅ Stats mises à jour pour ${client.nom} ${client.prenom}: ${nombreCommandes} cmd(s), ${totalDepense} DT`);
    }

    console.log('🚀 Opération terminée avec succès !');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
};

fixClientStats();
