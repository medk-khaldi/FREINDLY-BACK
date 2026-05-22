const express = require('express');
const router = express.Router();
const factureController = require('../controllers/facture.controller');
const auth = require('../middleware/auth.middleware');
const { authorizeRoles } = require('../middleware/role.middleware');

// Toutes les routes sont protégées
router.use(auth);

// Lister les factures (Accessible par Admin et Responsable)
router.get('/', authorizeRoles('admin', 'responsable', 'responsableEntrepot'), factureController.listerFactures);

// Récupérer une facture par ID
router.get('/:id', authorizeRoles('admin', 'responsable', 'responsableEntrepot'), factureController.getFactureById);

// Compléter un paiement (Uniquement Responsable, car Admin est superviseur ici)
router.post('/:livraisonId/completer', authorizeRoles('responsable', 'responsableEntrepot'), factureController.completerPaiement);

// Modifier un paiement (Responsable)
router.put('/:livraisonId/paiements/:paiementId', authorizeRoles('responsable', 'responsableEntrepot'), factureController.modifierPaiement);

module.exports = router;
