/**
 * Utilitaire de formatage des IDs pour le backend
 * Génère des identifiants cohérents et lisibles pour toutes les entités
 */

// Préfixes pour chaque type d'entité
const ID_PREFIXES = {
  commande: 'CMD',
  livraison: 'LIV',
  voyage: 'VOY',
  chauffeur: 'CHF',
  camion: 'CAM',
  stock: 'STK',
  produit: 'PRD',
  pointDeVente: 'PDV',
  entrepot: 'ENT',
  lot: 'LOT',
  facture: 'FAC',
  retour: 'RET',
  user: 'USR'
};

/**
 * Convertit un ID MongoDB en numéro simple
 * Utilise les 4 derniers caractères hex comme nombre (même formule que codeUtils)
 * @param {string} id - L'ID MongoDB complet
 * @returns {number} - Un numéro entre 0 et 9999
 */
const mongoIdToNumber = (id) => {
  if (!id) return 0;
  const idStr = id.toString();
  // Prendre les 4 derniers caractères hex
  const hex = idStr.slice(-4);
  // Convertir hex en décimal
  const num = parseInt(hex, 16);
  // Prendre les 4 derniers chiffres
  const decimalStr = num.toString();
  const code = parseInt(decimalStr.slice(-4));
  return code;
};

/**
 * Formate un ID MongoDB en identifiant professionnel simple
 * @param {string} id - L'ID MongoDB complet
 * @param {string} type - Le type d'entité (commande, livraison, etc.)
 * @returns {string} - L'ID formaté (ex: "CMD-1234")
 */
const formatId = (id, type = 'commande') => {
  if (!id) return 'N/A';
  
  const prefix = ID_PREFIXES[type] || 'ID';
  const num = mongoIdToNumber(id);
  
  // Formater avec padding de 4 chiffres
  const paddedNum = num.toString().padStart(4, '0');
  
  return `${prefix}-${paddedNum}`;
};

/**
 * Formate un ID pour l'affichage dans un badge/chip (version courte)
 * @param {string} id - L'ID MongoDB complet
 * @param {string} type - Le type d'entité
 * @returns {string} - L'ID formaté court avec # (ex: "#CMD-1234")
 */
const formatIdBadge = (id, type = 'commande') => {
  if (!id) return 'N/A';
  
  const prefix = ID_PREFIXES[type] || 'ID';
  const num = mongoIdToNumber(id);
  
  // Formater avec padding de 4 chiffres
  const paddedNum = num.toString().padStart(4, '0');
  
  return `#${prefix}-${paddedNum}`;
};

module.exports = {
  formatId,
  formatIdBadge,
  ID_PREFIXES
};
