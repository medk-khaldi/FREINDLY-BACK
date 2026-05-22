/**
 * Script de démonstration pour configurer les factures
 * 1. Vérifie l'état actuel
 * 2. Génère des factures pour les 10 dernières livraisons
 * 3. Affiche un résumé final
 * 
 * Usage: node backend/scripts/setup-factures-demo.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { checkLivraisonsFactures } = require('./check-livraisons-factures');
const { generateInvoicesForLatest10 } = require('./generate-invoices-latest-10');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connexion MongoDB établie');
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error);
    process.exit(1);
  }
}

async function setupFacturesDemo() {
  try {
    console.log('🎯 CONFIGURATION DÉMONSTRATION FACTURES');
    console.log('=' .repeat(60));
    console.log('Ce script va:');
    console.log('1. 🔍 Vérifier l\'état actuel des livraisons et factures');
    console.log('2. 📄 Générer des factures pour les 10 dernières livraisons');
    console.log('3. 📊 Afficher un résumé final');
    console.log('');

    // Étape 1: Vérification initiale
    console.log('🔍 ÉTAPE 1: VÉRIFICATION INITIALE');
    console.log('=' .repeat(40));
    await checkLivraisonsFactures();

    console.log('\n⏳ Pause de 2 secondes...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Étape 2: Génération des factures
    console.log('📄 ÉTAPE 2: GÉNÉRATION DES FACTURES');
    console.log('=' .repeat(40));
    await generateInvoicesForLatest10();

    console.log('\n⏳ Pause de 2 secondes...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Étape 3: Vérification finale
    console.log('📊 ÉTAPE 3: VÉRIFICATION FINALE');
    console.log('=' .repeat(40));
    await checkLivraisonsFactures();

    // Résumé final avec instructions
    console.log('\n🎉 CONFIGURATION TERMINÉE AVEC SUCCÈS!');
    console.log('=' .repeat(50));
    console.log('');
    console.log('📋 PROCHAINES ÉTAPES:');
    console.log('1. 🚀 Démarrer le serveur backend: npm start');
    console.log('2. 🌐 Démarrer le frontend: npm start');
    console.log('3. 👤 Se connecter en tant que responsable');
    console.log('4. 📄 Aller dans l\'onglet "Factures" du dashboard');
    console.log('5. 🔍 Vérifier que les factures sont bien affichées');
    console.log('');
    console.log('📱 POUR LES CHAUFFEURS:');
    console.log('1. 👤 Se connecter en tant que chauffeur');
    console.log('2. 📦 Voir les livraisons avec leurs factures');
    console.log('3. 📄 Tester le téléchargement PDF des factures');
    console.log('');
    console.log('🔧 ENDPOINTS API DISPONIBLES:');
    console.log('- GET /api/factures - Liste des factures');
    console.log('- GET /api/factures/:id - Détails d\'une facture');
    console.log('- GET /api/factures/:id/pdf - PDF d\'une facture');
    console.log('- GET /api/livraisons/:id/facture - Facture d\'une livraison');
    console.log('- PUT /api/factures/:id/statut - Changer statut facture');

  } catch (error) {
    console.error('❌ Erreur lors de la configuration:', error);
    throw error;
  }
}

async function main() {
  console.log('🚀 SCRIPT DE CONFIGURATION DÉMONSTRATION');
  console.log(`📅 Démarré le: ${new Date().toLocaleString('fr-FR')}`);
  console.log(`🎯 Objectif: Configurer les factures pour démonstration\n`);
  
  await connectDB();
  await setupFacturesDemo();
  await mongoose.disconnect();
  
  console.log('\n🔚 Configuration terminée avec succès!');
  console.log('🎉 Le système de facturation est prêt à être testé!');
}

// Exécution
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Erreur fatale:', error);
    process.exit(1);
  });
}

module.exports = { setupFacturesDemo };