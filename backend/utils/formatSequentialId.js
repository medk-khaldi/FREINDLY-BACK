/**
 * Utilitaire pour formater les IDs séquentiels
 * Gère automatiquement les nombres au-delà de 9999
 */

/**
 * Formate un numéro séquentiel avec padding intelligent
 * - 1-9999: 4 chiffres (0001-9999)
 * - 10000+: Nombre de chiffres nécessaire (10000, 10001, etc.)
 * 
 * @param {number} numero - Le numéro séquentiel
 * @param {number} minDigits - Nombre minimum de chiffres (défaut: 4)
 * @returns {string} - Le numéro formaté
 */
function formatNumero(numero, minDigits = 4) {
  if (!numero || numero < 1) return '0'.repeat(minDigits);
  
  const numeroStr = numero.toString();
  
  // Si le numéro a moins de chiffres que le minimum, ajouter des zéros
  if (numeroStr.length < minDigits) {
    return numeroStr.padStart(minDigits, '0');
  }
  
  // Sinon, retourner le numéro tel quel
  return numeroStr;
}

/**
 * Formate un ID séquentiel complet avec préfixe
 * 
 * @param {string} prefix - Le préfixe (CMD, VOY, etc.)
 * @param {number} numero - Le numéro séquentiel
 * @param {number} minDigits - Nombre minimum de chiffres (défaut: 4)
 * @returns {string} - L'ID formaté (ex: "CMD-0001" ou "CMD-10000")
 */
function formatSequentialId(prefix, numero, minDigits = 4) {
  if (!prefix) return 'N/A';
  if (!numero || numero < 1) return `${prefix}-${'0'.repeat(minDigits)}`;
  
  const numeroFormate = formatNumero(numero, minDigits);
  return `${prefix}-${numeroFormate}`;
}

/**
 * Formate un ID de livraison (format spécial: LIV-{commande}-{livraison})
 * 
 * @param {number} numeroCommande - Le numéro de la commande
 * @param {number} numeroLivraison - Le numéro de la livraison
 * @returns {string} - L'ID formaté (ex: "LIV-0001-01" ou "LIV-10000-01")
 */
function formatLivraisonId(numeroCommande, numeroLivraison) {
  if (!numeroCommande || !numeroLivraison) return 'LIV-N/A';
  
  const cmdFormate = formatNumero(numeroCommande, 4);
  const livFormate = formatNumero(numeroLivraison, 2);
  
  return `LIV-${cmdFormate}-${livFormate}`;
}

/**
 * Exemples d'utilisation et tests
 */
function testFormatting() {
  console.log('Tests de formatage des IDs séquentiels:\n');
  
  console.log('Commandes:');
  console.log(`  1 → ${formatSequentialId('CMD', 1)}`);
  console.log(`  999 → ${formatSequentialId('CMD', 999)}`);
  console.log(`  9999 → ${formatSequentialId('CMD', 9999)}`);
  console.log(`  10000 → ${formatSequentialId('CMD', 10000)}`);
  console.log(`  99999 → ${formatSequentialId('CMD', 99999)}`);
  console.log(`  100000 → ${formatSequentialId('CMD', 100000)}`);
  
  console.log('\nLivraisons:');
  console.log(`  CMD 1, LIV 1 → ${formatLivraisonId(1, 1)}`);
  console.log(`  CMD 9999, LIV 99 → ${formatLivraisonId(9999, 99)}`);
  console.log(`  CMD 10000, LIV 1 → ${formatLivraisonId(10000, 1)}`);
  console.log(`  CMD 10000, LIV 100 → ${formatLivraisonId(10000, 100)}`);
}

module.exports = {
  formatNumero,
  formatSequentialId,
  formatLivraisonId,
  testFormatting
};
