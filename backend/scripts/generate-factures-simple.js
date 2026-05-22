/**
 * Script simple pour générer des factures avec montant fixe
 * Usage: node backend/scripts/generate-factures-simple.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Livraison = require('../models/Livraison');
const Facture = require('../models/Facture');
const Commande = require('../models/Commande');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connexion MongoDB établie');
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error);
    process.exit(1);
  }
}

async function generateSimpleInvoices() {
  try {
    console.log('🎯 GÉNÉRATION SIMPLE DE FACTURES');
    console.log('=' .repeat(50));

    // Récupérer les 10 dernières livraisons
    const livraisons = await Livraison.find({})
      .populate('commande')
      .sort({ date_creation: -1 })
      .limit(10);

    console.log(`📦 ${livraisons.length} livraisons trouvées\n`);

    let compteurs = { creees: 0, existantes: 0, erreurs: 0 };

    for (let i = 0; i < livraisons.length; i++) {
      const livraison = livraisons[i];
      const numero = i + 1;
      
      try {
        console.log(`[${numero}/10] 📋 Livraison ${livraison._id}`);

        // Vérifier si facture existe déjà
        const factureExistante = await Facture.findOne({ livraison: livraison._id });
        
        if (factureExistante) {
          console.log(`   ⚠️ Facture déjà existante`);
          compteurs.existantes++;
          continue;
        }

        // Montant fixe pour test (basé sur le nombre de lignes)
        const nombreLignes = livraison.lignesLivraison?.length || 1;
        const montantTotal = nombreLignes * 50; // 50€ par ligne

        // Déterminer statut selon état livraison
        let statut = 'PROFORMA';
        if (livraison.statut === 'LIVREE') {
          statut = 'EN_ATTENTE';
        } else if (livraison.statut === 'ANNULEE') {
          statut = 'ANNULEE';
        }

        // Créer facture
        const facture = new Facture({
          livraison: livraison._id,
          commande: livraison.commande._id,
          montant_total: montantTotal,
          statut: statut,
          date_creation: livraison.date_creation,
          date_echeance: new Date(livraison.date_creation.getTime() + 30 * 24 * 60 * 60 * 1000)
        });

        await facture.save();

        // Lier facture à livraison
        livraison.facture = facture._id;
        await livraison.save();

        // Affichage des détails
        const livraisonId = await livraison.getIdFormate();
        const factureId = facture.getIdFormate();
        
        console.log(`   ✅ Facture créée:`);
        console.log(`      📄 ID: ${factureId}`);
        console.log(`      💰 Montant: ${montantTotal.toFixed(2)}€`);
        console.log(`      📊 Statut: ${statut}`);
        console.log(`      📦 Lignes: ${nombreLignes}`);
        
        compteurs.creees++;

      } catch (error) {
        console.log(`   ❌ Erreur: ${error.message}`);
        compteurs.erreurs++;
      }

      console.log('');
    }

    // Résumé final
    console.log('📊 RÉSUMÉ FINAL');
    console.log('=' .repeat(30));
    console.log(`✅ Factures créées: ${compteurs.creees}`);
    console.log(`⚠️ Factures existantes: ${compteurs.existantes}`);
    console.log(`❌ Erreurs: ${compteurs.erreurs}`);
    console.log(`📦 Total traité: ${livraisons.length}`);

    // Afficher les factures créées
    if (compteurs.creees > 0) {
      console.log('\n📋 FACTURES CRÉÉES:');
      console.log('-' .repeat(40));
      
      const facturesRecentes = await Facture.find({})
        .populate('livraison')
        .populate('commande')
        .sort({ date_creation: -1 })
        .limit(compteurs.creees);

      for (const facture of facturesRecentes) {
        const factureId = facture.getIdFormate();
        
        console.log(`📄 ${factureId}`);
        console.log(`   💰 ${facture.montant_total.toFixed(2)}€`);
        console.log(`   📊 ${facture.statut}`);
        console.log(`   📅 ${facture.date_creation.toLocaleDateString('fr-FR')}`);
        console.log('');
      }
    }

  } catch (error) {
    console.error('❌ Erreur générale:', error);
  }
}

async function main() {
  console.log('🚀 SCRIPT SIMPLE DE GÉNÉRATION DE FACTURES');
  console.log(`📅 Démarré le: ${new Date().toLocaleString('fr-FR')}\n`);
  
  await connectDB();
  await generateSimpleInvoices();
  await mongoose.disconnect();
  
  console.log('🔚 Script terminé avec succès!');
}

// Exécution
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Erreur fatale:', error);
    process.exit(1);
  });
}

module.exports = { generateSimpleInvoices };