const router = require("express").Router();
const controller = require("../controllers/produit.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");
const { uploadProduct } = require("../middleware/upload.middleware");
const upload = uploadProduct; // Conserver le nom variable pour éviter de changer tous les appels

// 🔹 Créer un produit (avec upload d'image optionnel)
// Le body doit inclure les références aux ids : categorie, unite, marque
router.post("/", upload.single('image'), controller.create);

// 🔹 Lister tous les produits
router.get("/", optionalAuth, controller.getAll);

// 🔹 Récupérer les meilleures ventes
router.get("/top-sellers", optionalAuth, controller.getTopSellers);

// 🔹 Suggestions de recherche
router.get("/suggestions", optionalAuth, controller.searchSuggestions);

// 🔹 Valider les produits du panier (rafraîchir prix/stock)
router.post("/validate-cart", controller.validateCart);

// 🔹 Récupérer un produit par code (interne ou EAN) — AVANT /:id pour éviter conflit
router.get("/code/:code", controller.getByCode);

// 🔹 Récupérer un produit par id
router.get("/:id", optionalAuth, controller.getById);

// 🔹 Mettre à jour la catégorie de plusieurs produits
router.put("/bulk-category", controller.bulkUpdateCategory);

// 🔹 Mettre à jour la visibilité sur le marketplace de plusieurs produits
router.put("/bulk-marketplace-visibility", controller.bulkUpdateMarketplaceVisibility);

// 🔹 Supprimer plusieurs produits en vrac
router.delete("/bulk-delete", controller.bulkDelete);

// 🔹 Mettre à jour plusieurs produits en vrac
router.put("/bulk-update", controller.bulkUpdate);

// 🔹 Modifier un produit (avec upload d'image optionnel)
router.put("/:id", upload.single('image'), controller.update);

// 🔹 Supprimer un produit
router.delete("/:id", controller.delete);

// 🔹 Restaurer un produit
router.patch("/:id/restore", controller.restore);

module.exports = router;
