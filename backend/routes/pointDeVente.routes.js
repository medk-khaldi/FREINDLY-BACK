const express = require('express');
const router = express.Router();
const pointDeVenteController = require('../controllers/pointDeVente.controller');

// Créer un point de vente
router.post('/', pointDeVenteController.create);

// Récupérer tous les points de vente
router.get('/', pointDeVenteController.getAll);

// Récupérer un point de vente par ID
router.get('/:id', pointDeVenteController.getById);

// Mettre à jour un point de vente
router.put('/:id', pointDeVenteController.update);

// Désactiver un point de vente (au lieu de supprimer)
router.delete('/:id', pointDeVenteController.delete);

// Réactiver un point de vente
router.patch('/:id/reactivate', pointDeVenteController.reactivate);

const auth = require("../middleware/auth.middleware");
const { authorizeRoles } = require("../middleware/role.middleware");

// Inscriptions marketplace
router.get('/inscriptions/en-attente', auth, authorizeRoles("admin", "responsableEntrepot"), pointDeVenteController.getInscriptionsEnAttente);
router.patch('/:id/approuver', auth, authorizeRoles("admin", "responsableEntrepot"), pointDeVenteController.approuverInscription);
router.patch('/:id/rejeter', auth, authorizeRoles("admin", "responsableEntrepot"), pointDeVenteController.rejeterInscription);

module.exports = router;
