/**
 * Script de migration pour générer des factures pour les 10 dernières livraisons existantes
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Livraison = require('../models/Livraison');
const Facture = require('../models/Facture');
const Produit = require('../models/Produit');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connexion MongoDB établie');
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error);
    process.exit(1);
  }
}

async function generateFacturesForLatestDeliveries() {
  try {
    console.log('🔍 Recherche des 10 dernières livraisons...');

    // Trouver les 10 dernières livraisons (triées par date de création décroissante)
    const latestLivraisons = await Livraison.find({})
      .populate('lignesLivraison.produit')
      .populate('commande')
      .sort({ date_creation: -1 })
      .limit(10);

    console.log(`📦 ${latestLivraisons.length} livraisons trouvées`);

    if (latestLivraisons.length === 0) {
      console.log('⚠️ Aucune livraison trouvée dans la base de données');
      return;
    }

    let facturesCreees = 0;
    let facturesExistantes = 0;
    let erreurs = 0;

    for (const livraison of latestLivraisons) {
      try {
        console.log(`\n📋 Traitement livraison ${livraison._id}...`);

        // Vérifier si une facture existe déjà
        const factureExistante = await Facture.findOne({ livraison: livraison._id });
        
        if (factureExistante) {
          console.log(`⚠️ Facture déjà existante pour livraison ${livraison._id}`);
          facturesExistantes++;
          continue;
        }

        // Calculer le montant total
        let montantTotal = 0;
        
        for (const ligne of livraison.lignesLivraison) {
          if (ligne.produit && ligne.produit.prix_unitaire) {
            montantTotal += ligne.quantite * ligne.produit.prix_unitaire;
          } else {
            console.warn(`⚠️ Produit sans prix pour livraison ${livraison._id}, ligne:`, ligne);
          }
        }

        // Déterminer le statut de la facture selon l'état de la livraison
        let statutFacture = 'PROFORMA';
        if (livraison.statut === 'LIVREE') {
          statutFacture = 'EN_ATTENTE';
        } else if (livraison.statut === 'ANNULEE') {
          statutFacture = 'ANNULEE';
        }

        // Créer la facture
        const nouvelleFacture = new Facture({
          livraison: livraison._id,
          commande: livraison.commande._id,
          montant_total: montantTotal,
          statut: statutFacture,
          date_creation: livraison.date_creation,
          date_echeance: new Date(livraison.date_creation.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 jours après création
        });

        await nouvelleFacture.save();

        // Mettre à jour la livraison avec la référence de la facture
        await Livraison.findByIdAndUpdate(livraison._id, {
          facture: nouvelleFacture._id
        });

        const livraisonIdFormate = await livraison.getIdFormate();
        const factureIdFormate = await nouvelleFacture.getIdFormate();
        
        console.log(`✅ Facture créée:`);
        console.log(`   📦 Livraison: ${livraisonIdFormate}`);
        console.log(`   📄 Facture: ${factureIdFormate}`);
        console.log(`   💰 Montant: ${montantTotal.toFixed(2)}€`);
        console.log(`   📊 Statut: ${statutFacture}`);
        console.log(`   📅 Date: ${livraison.date_creation.toLocaleDateString('fr-FR')}`);
        
        facturesCreees++;

      } catch (error) {
        console.error(`❌ Erreur pour livraison ${livraison._id}:`, error.message);
        erreurs++;
      }
    }

    console.log('\n📊 Résumé de la génération:');
    console.log(`✅ Factures créées: ${facturesCreees}`);
    console.log(`⚠️ Factures déjà existantes: ${facturesExistantes}`);
    console.log(`❌ Erreurs: ${erreurs}`);
    console.log(`📦 Total traité: ${latestLivraisons.length}`);

    // Afficher un aperçu des factures créées
    if (facturesCreees > 0) {
      console.log('\n📋 Aperçu des factures créées:');
      const facturesCreated = await Facture.find({})
        .populate('livraison')
        .populate('commande')
        .sort({ date_creation: -1 })
        .limit(facturesCreees);

      for (const facture of facturesCreated) {
        const factureId = await facture.getIdFormate();
        console.log(`   📄 ${factureId} - ${facture.montant_total.toFixed(2)}€ - ${facture.statut}`);
      }
    }

  } catch (error) {
    console.error('❌ Erreur générale:', error);
  }
}

async function main() {
  console.log('🚀 Démarrage du script de génération de factures pour les 10 dernières livraisons');
  console.log('📅 Date:', new Date().toLocaleString('fr-FR'));
  
  await connectDB();
  await generateFacturesForLatestDeliveries();
  await mongoose.disconnect();
  
  console.log('\n🔚 Script terminé');
}

// Exécuter le script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { generateFacturesForLatestDeliveries };