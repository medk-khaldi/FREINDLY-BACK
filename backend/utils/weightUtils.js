/**
 * Utility to handle weight calculations from product formats and units.
 */

/**
 * Extracts a numerical weight in KG from a format string.
 * Handles "1.5L", "0.33L", "500ml", "2kg", etc.
 * @param {string} formatName - The name of the format (e.g., "1.5L")
 * @param {string} unitName - The name of the unit (e.g., "Litre", "Kilogramme")
 * @returns {number|null} - Weight in kg or null if not found
 */
exports.extractWeight = (formatName, unitName) => {
  if (!formatName) return null;

  const name = formatName.toLowerCase().replace(',', '.'); // standardize decimal separator
  
  // 1. Check for Kilograms (kg)
  const kgMatch = name.match(/(\d+\.?\d*)\s*kg/);
  if (kgMatch) return parseFloat(kgMatch[1]);

  // 2. Check for Grams (g)
  const gMatch = name.match(/(\d+\.?\d*)\s*g(?![\w])/);
  if (gMatch) return parseFloat(gMatch[1]) / 1000;

  // 3. Check for Liters (L) - Assume 1L = 1kg for beverages
  const lMatch = name.match(/(\d+\.?\d*)\s*l(?![\w])/);
  if (lMatch) return parseFloat(lMatch[1]);

  // 4. Check for Milliliters (ml or cl)
  const mlMatch = name.match(/(\d+\.?\d*)\s*ml/);
  if (mlMatch) return parseFloat(mlMatch[1]) / 1000;

  const clMatch = name.match(/(\d+\.?\d*)\s*cl/);
  if (clMatch) return parseFloat(clMatch[1]) / 100;

  // 5. If no pattern matched, check if unit is kg or L and if there's a standalone number
  const standaloneMatch = name.match(/^(\d+\.?\d*)$/);
  if (standaloneMatch) {
    const val = parseFloat(standaloneMatch[1]);
    if (unitName && (unitName.toLowerCase().includes('kg') || unitName.toLowerCase().includes('kilogramme'))) {
      return val;
    }
    if (unitName && (unitName.toLowerCase().includes('l') || unitName.toLowerCase().includes('litre'))) {
      return val;
    }
  }

  return null;
};

/**
 * Calculates the total weight of a list of items.
 * @param {Array} items - List of items with { produit: { poids_unitaire }, quantite }
 * @param {string} quantityField - The field name for quantity (default 'quantite')
 * @returns {number} - Total weight in kg
 */
exports.calculateItemsWeight = (items, quantityField = 'quantite') => {
  if (!items || !Array.isArray(items)) return 0;
  
  return items.reduce((total, item) => {
    const poids = (item.produit && item.produit.poids_unitaire) ? item.produit.poids_unitaire : 0;
    const qte = item[quantityField] || 0;
    return total + (poids * qte);
  }, 0);
};
