const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

// Connect to DB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/pfe_platforme').then(() => {
  console.log('✅ Connecté à MongoDB');
  runMigration();
}).catch(err => {
  console.error('❌ Erreur de connexion:', err);
  process.exit(1);
});

async function runMigration() {
  try {
    const Commande = require('./models/Commande');
    const Livraison = require('./models/Livraison');
    const Voyage = require('./models/Voyage');
    
    // Import models needed by populate
    require('./models/LigneCommande');
    require('./models/Produit');
    require('./models/Lot');

    console.log('⏳ Récupération de toutes les commandes...');
    const commandes = await Commande.find().populate('lignesCommande');
    console.log(`📊 ${commandes.length} commandes trouvées.`);

    let updatedCount = 0;

    for (const commande of commandes) {
      const commandeId = commande._id;
      const livraisons = await Livraison.find({ commande: commandeId });

      const quantiteTotaleCommandee = (commande.lignesCommande || []).reduce(
        (sum, ligne) => sum + (ligne.quantite || 0), 0
      );
      
      const quantiteRestante = (commande.lignesCommande || []).reduce(
        (sum, ligne) => sum + (ligne.quantite_restante || 0), 0
      );

      const quantiteLivree = quantiteTotaleCommandee - quantiteRestante;

      const livraisonsLivrees = livraisons.filter(l => l.statut === "LIVREE").length;
      const livraisonsEchec = livraisons.filter(l => l.statut === "ECHEC").length;
      const livraisonsEnCours = livraisons.filter(l => l.statut === "EN_COURS").length;
      const livraisonsEnAttente = livraisons.filter(l => l.statut === "EN_ATTENTE").length;
      const livraisonsAnnulees = livraisons.filter(l => l.statut === "ANNULEE").length;

      const livraisonsActives = livraisons.filter(l => l.statut !== "ANNULEE");
      const totalActives = livraisonsActives.length;

      let voyageEnCours = false;
      let voyageTermine = false;
      
      const voyageIds = [...new Set(livraisonsActives.map(l => l.voyage?.toString()).filter(Boolean))];
      if (voyageIds.length > 0) {
        const voyages = await Voyage.find({ _id: { $in: voyageIds } });
        const voyageMap = new Map(voyages.map(v => [v._id.toString(), v]));
        
        for (const livraison of livraisonsActives) {
          if (livraison.voyage) {
            const voyage = voyageMap.get(livraison.voyage.toString());
            if (voyage) {
              if (voyage.statut === "EN_COURS") {
                voyageEnCours = true;
              } else if (voyage.statut === "TERMINE") {
                voyageTermine = true;
              }
            }
          }
        }
      }

      // 🔄 NOUVELLE LOGIQUE: Basée sur le statut des livraisons actives
      const pourcentage = totalActives > 0
        ? Math.round((livraisonsLivrees / totalActives) * 100)
        : 0;

      let nouveauStatut = commande.statut;
      let pourcentageLivraison = null;

      // 🛡️ SÉCURITÉ: Statuts finaux/avancés ne peuvent jamais régresser
      const STATUTS_PRIORITE = {
        'EN_ATTENTE': 1, 'PREPAREE': 2, 'EN_LIVRAISON': 3,
        'LIVREE': 4, 'ECHEC': 4, 'CONFIRMEE': 5, 'ANNULEE': 6
      };
      const prioriteActuelle = STATUTS_PRIORITE[commande.statut] || 0;

      if (commande.statut === 'CONFIRMEE' || commande.statut === 'ANNULEE') {
        continue; // Passer à la commande suivante
      }

      if (totalActives === 0) {
        nouveauStatut = commande.statut; 
        pourcentageLivraison = null;
      } else if (voyageEnCours || livraisonsEnCours > 0) {
        nouveauStatut = "EN_LIVRAISON";
        if (pourcentage > 0) pourcentageLivraison = pourcentage;
      } else if (livraisonsEnAttente > 0 && livraisonsLivrees === 0 && livraisonsEchec === 0) {
        // Uniquement des livraisons en attente, rien de livré encore
        if (STATUTS_PRIORITE[commande.statut] <= STATUTS_PRIORITE['EN_ATTENTE']) {
          nouveauStatut = "EN_ATTENTE";
        } else {
          nouveauStatut = commande.statut; // Garder PREPAREE, etc.
        }
        if (pourcentage > 0) pourcentageLivraison = pourcentage;
      } else if (livraisonsEnAttente > 0 && livraisonsLivrees > 0) {
        // Livraisons mixtes = déjà une partie livrée
        nouveauStatut = "LIVREE";
        pourcentageLivraison = pourcentage;
      } else {
        // Toutes les livraisons actives sont terminées (LIVREE ou ECHEC)
        if (livraisonsLivrees > 0 && livraisonsEchec === 0) {
          nouveauStatut = "LIVREE";
          pourcentageLivraison = 100;
        } else if (livraisonsEchec > 0 && livraisonsLivrees === 0) {
          nouveauStatut = "ECHEC";
          pourcentageLivraison = null;
        } else if (livraisonsLivrees > 0 && livraisonsEchec > 0) {
          nouveauStatut = "LIVREE";
          pourcentageLivraison = pourcentage;
        } else {
          nouveauStatut = commande.statut;
        }
      }

      // ⚠️ GARDE-FOU FINAL: Jamais rétrograder un statut avancé
      if ((STATUTS_PRIORITE[nouveauStatut] || 0) < prioriteActuelle) {
        nouveauStatut = commande.statut;
      }


      const statutChanged = nouveauStatut !== commande.statut;
      const pctChanged = (pourcentageLivraison || undefined) !== (commande.pourcentage_livraison || undefined);

      if (statutChanged || pctChanged) {
        console.log(`🔄 CMD: ${commande._id} | Statut: ${commande.statut} → ${nouveauStatut} | Pct: ${commande.pourcentage_livraison || 'null'} → ${pourcentageLivraison || 'null'}`);
        
        commande.statut = nouveauStatut;
        if (pourcentageLivraison !== null) {
          commande.pourcentage_livraison = pourcentageLivraison;
        } else {
          commande.pourcentage_livraison = undefined; // unset
        }
        
        await commande.save();
        updatedCount++;
      }
    }

    console.log(`🎉 Migration terminée. ${updatedCount} commandes mises à jour.`);
    process.exit(0);

  } catch (err) {
    console.error('❌ Erreur pendant la migration:', err);
    process.exit(1);
  }
}
