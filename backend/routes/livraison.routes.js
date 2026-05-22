const express = require("express");
const router = express.Router();

const LivraisonController = require("../controllers/livraison.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");
router.use(optionalAuth);

router.get("/", LivraisonController.lister);
router.get("/chauffeurs", LivraisonController.listerPourChauffeurs); // ✅ NOUVELLE ROUTE
router.get("/commandes-preparees", LivraisonController.getCommandesPreparees);
router.get("/diagnostic", LivraisonController.diagnosticCommandes);
router.post("/initialiser-quantites", LivraisonController.initialiserQuantiteRestante);
router.get("/:id", LivraisonController.getById);
router.post("/:commandeId", LivraisonController.creerLivraison);
router.post("/avec-selection/:commandeId", LivraisonController.creerLivraisonAvecSelection);
router.post("/depuis-commande/:commandeId", LivraisonController.creerDepuisCommandePreparee);
router.put("/:livraisonId/statut", LivraisonController.changerStatutLivraison);
router.post("/:livraisonId/produit-echec", LivraisonController.marquerProduitEnEchec);
router.get("/:livraisonId/facture", LivraisonController.getFactureLivraison);
router.post("/:livraisonId/liberer-stock", LivraisonController.libererStockLivraisonAnnulee);
router.post("/:id/split", LivraisonController.splitLivraison);
router.delete("/:id", LivraisonController.supprimerLivraison);

module.exports = router;
