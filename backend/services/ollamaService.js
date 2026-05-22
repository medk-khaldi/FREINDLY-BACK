const Message = require('../models/Message');
const Commande = require('../models/Commande');
const Livraison = require('../models/Livraison');
const Produit = require('../models/Produit');
const Stock = require('../models/Stock');
const CategorieProduit = require('../models/CategorieProduit');
const MarqueProduit = require('../models/MarqueProduit');
const Format = require('../models/Format');
const PointDeVente = require('../models/PointDeVente');

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const SYSTEM_PROMPT = `Tu es Sami, l'assistant IA du marketplace PLATFORM.cloud.

════════════════════════════════════════
🔴 RÈGLES ABSOLUES — NE JAMAIS VIOLER
════════════════════════════════════════

1. LANGUE — LA RÈGLE LA PLUS IMPORTANTE :
   - Lis le message de l'utilisateur. Détecte sa langue.
   - Si le message contient des mots arabes ou du Darija (même en lettres latines : "sbeh", "mwsltnich", "commande" mélangé avec du Darija) → RÉPONDS UNIQUEMENT EN ARABE CLASSIQUE ou Darija arabe.
   - Si le message est en français pur → RÉPONDS UNIQUEMENT EN FRANÇAIS.
   - INTERDIT ABSOLU : ne mélange JAMAIS l'arabe et le français dans la même réponse.
   - INTERDIT ABSOLU : n'utilise JAMAIS de mots anglais ("wait", "check", "update", "shipment", "tracking", etc.)
   - INTERDIT ABSOLU : n'utilise JAMAIS de caractères chinois ou asiatiques.

2. RÉPONSE IMMÉDIATE — NE JAMAIS DIRE "ATTENDEZ" :
   - Tu as DÉJÀ toutes les données dans le bloc [DATA] ci-dessous.
   - INTERDIT ABSOLU : ne dis JAMAIS "يرجى الانتظار" / "انتظر" / "سأتحقق" / "je vais vérifier" / "je vérifie" / "un instant" / "attendez" / "je reviens vers vous".
   - Réponds IMMÉDIATEMENT en utilisant les données [DATA] disponibles.
   - Si les données ne sont pas dans [DATA] → dis "je n'ai pas cette information" et ajoute [ESCALATE].

3. ESCALADE IMMÉDIATE :
   - Si tu ne peux PAS répondre avec les données disponibles → ajoute [ESCALATE] et informe l'utilisateur qu'un responsable va le contacter.
   - Si la demande dépasse tes capacités (modifier commande, changer adresse, remboursement) → [ESCALATE] immédiatement.
   - En arabe : "سأحيل طلبك إلى مسؤول لمساعدتك. [ESCALATE]"
   - En français : "Je transmets votre demande à un responsable. [ESCALATE]"

4. SOIS DIRECT ET CLAIR :
   - Maximum 3 phrases courtes et directes.
   - Utilise les données réelles du bloc [DATA] pour répondre.
   - Ne pose PAS de questions inutiles si tu as déjà la réponse.
   - Si une commande est "En attente" → dis-le directement sans tourner autour.

5. COMMANDES MULTIPLES — DEMANDER DE PRÉCISER :
   - Si le bloc [DATA] contient la mention [MULTI_ORDERS], cela signifie que le client a PLUSIEURS commandes et n'a PAS précisé laquelle.
   - Dans ce cas, tu DOIS d'abord demander au client QUELLE commande il veut suivre.
   - Présente une LISTE NUMÉROTÉE de ses commandes récentes avec leur numéro et statut.
   - Exemple français : "Vous avez plusieurs commandes récentes :\n1. Commande #423 — En attente\n2. Commande #419 — Livrée\nLaquelle souhaitez-vous suivre ?"
   - Exemple arabe : "عندك عدة طلبيات:\n1. طلب #423 — قيد الانتظار\n2. طلب #419 — تم التسليم\nأي وحدة تحب تتبعها؟"
   - NE RÉPONDS JAMAIS avec une seule commande au hasard quand [MULTI_ORDERS] est présent.

════════════════════════════════════════
📋 RÈGLES DE DONNÉES
════════════════════════════════════════

BLOC [DATA] :
- Contient les vraies données de commandes/livraisons récupérées EN TEMPS RÉEL.
- Utilise UNIQUEMENT ces données. Ne déduis rien d'autre.
- Statuts possibles : "En attente", "Préparation", "Expédiée", "Livrée", "Échec".
- Ne montre jamais le bloc [DATA] brut à l'utilisateur.

BLOC [PRODUCT_DATA] :
- Contient les vrais produits avec prix et disponibilité.
- Ne mentionne JAMAIS un produit qui n'est pas dans [PRODUCT_DATA].
- Prix en DT (Dinars Tunisiens).

Sujet : {{TOPIC}}
`;


/**
 * Detect if text is Arabic or Derja
 */
function detectLanguage(text) {
  if (!text) return 'french';

  // 1. Arabic script characters → Definitely Arabic
  if (/[\u0600-\u06FF]/.test(text)) return 'arabic';

  const lowerText = text.toLowerCase().trim();
  const words = lowerText.split(/[\s,.;!?]+/).filter(w => w.length > 1);

  // 2. Pure Derja words (no overlap with French)
  const pureDerjaWords = [
    // Greetings
    'sbeh', 'sbah', 'elkhir', 'msa', 'lkhir', 'salam', 'slm', 'ahla', 'merha', 'ahlan',
    // Common Darija
    'mwsltnich', 'mwsltnich', 'mwslitnich', 'wslnich', 'wasslnich',
    'kifeh', 'winek', 'wini', 'chnia', 'bech', 'naawed', 'taslim',
    'lbes', 'labas', 'mouch', 'chouf', 'echri', 'win', 'chbik', 'ech', 'kont',
    'nheb', 'fama', 'mafamech', 'yezzi', 'barcha', 'chwaya', 'nhar', 'weld',
    'khali', 'ya5i', 'na3ref', 'ma3andich', 'mte3i', 'ta3i', 'haja', 'khouya',
    'sahbi', 'ya3tik', 'esa7a', 'inchallah', 'cv', 'wlh', 'fin',
    'mwsltech', 'majitech', 'lcommande', 'lorder', 'tal3et', 'wkila',
    'barra', 'hdhih', 'hethi', 'hedhi', 'mta3i', 'ta3na', 'tkhalas',
    'mta3ak', 'finek', 'wein', 'tawa', 'towa', 'chwiya', 'barsha'
  ];

  // 3. French indicator words
  const frenchWords = [
    'je', 'tu', 'il', 'nous', 'vous', 'est', 'sont', 'suis', 'avez', 'mon', 'ma',
    'mes', 'votre', 'une', 'des', 'les', 'pour', 'dans', 'que', 'qui', 'quoi',
    'comment', 'quand', 'avec', 'sur', 'pas', 'merci', 'bonjour', 'bonsoir',
    'svp', 'oui', 'non', 'commande', 'livraison', 'produit', 'problème', 'aide',
    'cmd', 'annuler', 'changer', 'modifier', 'suivre', 'tracker', 'où', 'ou',
    'pourquoi', 'combien'
  ];

  let derjaScore = 0;
  let frenchScore = 0;

  for (const word of words) {
    if (pureDerjaWords.includes(word)) derjaScore += 2;
    if (frenchWords.includes(word)) frenchScore += 1;
  }

  // If there's any strong Derja signal (like "wini", "mwsltnich"), override French
  if (derjaScore > 0 && derjaScore >= frenchScore) return 'arabic';

  return 'french';
}

/**
 * Cleanup Arabic response with proper punctuation
 */
function cleanArabicResponse(text) {
  if (!text) return text;
  return text
    .replace(/,/g, '،')
    .replace(/;/g, '؛')
    .replace(/\?/g, '؟')
    .replace(/!/g, '!')
    .trim();
}

/**
 * Strip Chinese, Japanese, Korean characters
 */
function stripForeignCharacters(text) {
  return text
    .replace(/[\u4e00-\u9fff]/g, '')
    .replace(/[\u3400-\u4dbf]/g, '')
    .replace(/[\u3000-\u303f]/g, '')
    .replace(/[\u3040-\u309f]/g, '')
    .replace(/[\u30a0-\u30ff]/g, '')
    .replace(/[\uac00-\ud7af]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Fetch detailed client order data
 */
async function getClientContext(clientId, userMessage = '') {
  try {
    // Extract specific order number if mentioned
    const orderMatch = userMessage.match(/(?:cmd|commande|order|طلب|رقم)\s*#?(\d+)/i);
    const specificOrderNum = orderMatch ? parseInt(orderMatch[1]) : null;

    const isPDV = await PointDeVente.exists({ _id: clientId });
    let recentOrders;

    if (specificOrderNum) {
      const filterSpecific = isPDV 
        ? { pointDeVente: clientId, numero_commande: specificOrderNum }
        : { client: clientId, numero_commande: specificOrderNum, pointDeVente: null };

      const specificOrder = await Commande.findOne(filterSpecific)
        .populate({ path: 'lignesCommande', populate: { path: 'produit', select: 'nom designation' } })
        .lean();

      const filterOthers = isPDV
        ? { pointDeVente: clientId, numero_commande: { $ne: specificOrderNum } }
        : { client: clientId, pointDeVente: null, numero_commande: { $ne: specificOrderNum } };

      const otherOrders = await Commande.find(filterOthers)
        .sort({ date_creation: -1 })
        .limit(4)
        .populate({ path: 'lignesCommande', populate: { path: 'produit', select: 'nom designation' } })
        .lean();

      recentOrders = specificOrder ? [specificOrder, ...otherOrders] : otherOrders;
    } else {
      const filterAll = isPDV
        ? { pointDeVente: clientId }
        : { client: clientId, pointDeVente: null };

      recentOrders = await Commande.find(filterAll)
        .sort({ date_creation: -1 })
        .limit(5)
        .populate({ path: 'lignesCommande', populate: { path: 'produit', select: 'nom designation' } })
        .lean();
    }

    if (!recentOrders || recentOrders.length === 0) return "\n[DATA]\nAucun historique de commande trouvé pour ce client.\n[/DATA]";

    // Detect if the user asked about orders without specifying a number
    const orderTrackingKeywords = /où est ma commande|suivi commande|commande|order|طلب|طلبيتي|وين طلبي|متاعي/i;
    const hasMultipleOrders = recentOrders.length > 1 && !specificOrderNum && orderTrackingKeywords.test(userMessage);

    // Optimisation: Fetch all deliveries for these orders in one go
    const orderIds = recentOrders.map(o => o._id);
    const allLivraisons = await Livraison.find({ commande: { $in: orderIds } })
      .select('commande statut date_livraison raison_echec')
      .lean();

    const detectedLang = detectLanguage(userMessage);

    let contextStr = `\n[DATA] (REAL-TIME — fetched at ${new Date().toLocaleTimeString('fr-TN')})\n`;

    // Signal the AI to ask which order the client wants to track
    if (hasMultipleOrders) {
      contextStr += `⚠️ [MULTI_ORDERS] Ce client a ${recentOrders.length} commandes récentes. Il n'a PAS précisé de numéro. Tu DOIS lui demander laquelle il veut suivre en listant ses commandes.\n\n`;
    }

    for (const order of recentOrders) {
      const id = order.numero_commande || order._id;
      const statusFormatted = formatStatus(order.statut, detectedLang);
      const date = new Date(order.date_creation || order.date_commande).toLocaleDateString('fr-TN');
      const total = (order.total || order.prix_total || 0).toFixed(2);

      contextStr += `⚡ COMMANDE #${id}:\n`;
      contextStr += `  → Statut actuel: ${statusFormatted}\n`;
      contextStr += `  → Montant: ${total} DT\n`;
      contextStr += `  → Date: ${date}\n`;

      if (order.lignesCommande && order.lignesCommande.length > 0) {
        const produits = order.lignesCommande
          .filter(l => l.produit)
          .map(l => l.produit.nom || l.produit.designation)
          .filter(Boolean);
        if (produits.length > 0) contextStr += `  → Articles: ${produits.join(', ')}\n`;
      }

      // Filter livraisons for this order from our pre-fetched list
      const livraisons = allLivraisons.filter(l => l.commande.toString() === order._id.toString());

      if (livraisons.length > 0) {
        for (const liv of livraisons) {
          const livStatus = formatStatus(liv.statut, detectedLang);
          const livDate = liv.date_livraison ? new Date(liv.date_livraison).toLocaleDateString('fr-TN') : (detectedLang === 'arabic' ? 'غير محددة' : 'non définie');
          contextStr += `  → Livraison: ${livStatus} (${detectedLang === 'arabic' ? 'متوقعة في' : 'Prévue le'}: ${livDate})`;
          if (liv.raison_echec) contextStr += ` (${detectedLang === 'arabic' ? 'سبب الفشل' : 'Raison échec'}: ${liv.raison_echec})`;
          contextStr += '\n';
        }
      } else {
        contextStr += `  → Livraison: ${detectedLang === 'arabic' ? 'لم يتم جدولة التوصيل بعد' : 'Pas encore de livraison planifiée'}\n`;
      }
    }

    contextStr += '[/DATA]';
    return contextStr;
  } catch (error) {
    console.error('⚠️ [OLLAMA] Error fetching client context:', error.message);
    return '';
  }
}

// Cache for product names to avoid scanning DB on every message
let productNameCache = [];
let productCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getProductNames() {
  if (Date.now() - productCacheTime < CACHE_TTL && productNameCache.length > 0) {
    return productNameCache;
  }
  try {
    const products = await Produit.find({}).select('nom _id').lean();
    productNameCache = products.map(p => ({
      original: p.nom,
      normalized: p.nom.toLowerCase().replace(/_/g, ' '),
      _id: p._id
    }));
    productCacheTime = Date.now();
    return productNameCache;
  } catch (err) {
    console.error('⚠️ [PRODUCT_CACHE] Error:', err.message);
    return [];
  }
}

/**
 * Scan message for known product names
 */
async function findProductInMessage(message) {
  if (!message) return null;
  const normalizedMsg = message.toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[?!.,;:'"]/g, ' ') // remove punctuation
    .trim();

  console.log(`🧪 [PRODUCT_MATCH] Scanning message: "${normalizedMsg}"`);
  const products = await getProductNames();
  
  // Sort by length descending
  const sorted = [...products].sort((a, b) => b.normalized.length - a.normalized.length);
  
  for (const p of sorted) {
    if (normalizedMsg.includes(p.normalized)) {
      console.log(`🎯 [PRODUCT_MATCH] Direct hit: "${p.normalized}" matches "${p.original}"`);
      return p.original;
    }
  }
  return null;
}

/**
 * Format product results into a context block for the LLM
 */
async function formatProductResults(products) {
  let ctx = '\n[PRODUCT_DATA] Résultats de recherche produit :\n';
  for (const p of products) {
    // 1. Build full category path (Grandparent > Parent > Child)
    let categoryPath = p.categorie?.nom || 'Non classé';
    if (p.categorie?.parent) {
      try {
        const parent = await CategorieProduit.findById(p.categorie.parent).lean();
        if (parent) {
          categoryPath = parent.nom + ' > ' + categoryPath;
          if (parent.parent) {
            const grandparent = await CategorieProduit.findById(parent.parent).lean();
            if (grandparent) categoryPath = grandparent.nom + ' > ' + categoryPath;
          }
        }
      } catch (e) { console.error('Error fetching parent category:', e); }
    }

    // 2. Fetch stock info
    const stock = await Stock.aggregate([
      { $match: { produit: p._id } },
      { $group: { _id: null, total: { $sum: '$quantite' }, reserved: { $sum: '$quantite_reservee' } } }
    ]);
    const available = stock[0] ? stock[0].total - stock[0].reserved : 0;

    ctx += `- ${p.nom} | Marque: ${p.marque?.nom || 'N/A'} | Prix: ${p.prix_reference.toFixed(3)} DT`;
    ctx += ` | Rayon: ${categoryPath}`;
    ctx += ` | Format: ${p.format?.nom || 'standard'}`;
    ctx += ` | Unité: ${p.unite?.nom || 'pièce'}`;
    ctx += ` | Disponible: ${available > 0 ? `Oui (${available} unités)` : 'Rupture de stock'}\n`;

    // --- NEW: Inject real alternatives if out of stock ---
    if (available <= 0) {
      try {
        const alternatives = await Produit.find({
          _id: { $ne: p._id },
          $or: [
            { categorie: p.categorie?._id },
            { marque: p.marque?._id }
          ]
        })
        .limit(3)
        .populate([
          { path: 'marque', select: 'nom' },
          { path: 'categorie', select: 'nom parent' }
        ])
        .lean();

        if (alternatives.length > 0) {
          ctx += `\n[ALTERNATIVES EN STOCK POUR ${p.nom.toUpperCase()} :]\n`;
          for (const alt of alternatives) {
            const altStock = await Stock.aggregate([
              { $match: { produit: alt._id } },
              { $group: { _id: null, total: { $sum: '$quantite' }, reserved: { $sum: '$quantite_reservee' } } }
            ]);
            const altAvail = altStock[0] ? altStock[0].total - altStock[0].reserved : 0;
            
            if (altAvail > 0) {
              ctx += `- ${alt.nom} | Prix: ${alt.prix_reference.toFixed(3)} DT | Disponible: Oui\n`;
            }
          }
        }
      } catch (altErr) { console.error('Error fetching alternatives:', altErr); }
    }
  }
  ctx += '[/PRODUCT_DATA]';
  return ctx;
}

/**
 * Search products in DB with exact match, then fuzzy fallback
 */
async function searchAndFormatProducts(searchTerm) {
  if (!searchTerm) return null;
  
  // Clean punctuation from search term
  searchTerm = searchTerm.replace(/[?!.,;:'"]/g, '').trim();
  if (searchTerm.length < 2) return null;

  const populateOpts = [
    { path: 'marque', select: 'nom' },
    { path: 'format', select: 'nom volume' },
    { path: 'categorie', select: 'nom parent' },
    { path: 'unite', select: 'nom' }
  ];

  // --- Step 1: Exact regex search ---
  const searchRegex = new RegExp(
    searchTerm.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i'
  );

  let products = await Produit.find({ nom: searchRegex })
    .limit(3)
    .populate(populateOpts)
    .lean();

  if (products.length > 0) {
    console.log(`✅ [PRODUCT] Exact match for "${searchTerm}": ${products.map(p => p.nom).join(', ')}`);
    return await formatProductResults(products);
  }

  // --- Step 2: Fuzzy fallback — search individual words ---
  const words = searchTerm.split(/\s+/).filter(w => w.length >= 3);
  if (words.length > 0) {
    // Build OR query: match any word in the product name
    const wordRegexes = words.map(w => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    products = await Produit.find({ $or: wordRegexes.map(r => ({ nom: r })) })
      .limit(5)
      .populate(populateOpts)
      .lean();

    if (products.length > 0) {
      // Sort by relevance: products matching more words first
      products.sort((a, b) => {
        const scoreA = words.filter(w => a.nom.toLowerCase().includes(w)).length;
        const scoreB = words.filter(w => b.nom.toLowerCase().includes(w)).length;
        return scoreB - scoreA;
      });
      products = products.slice(0, 3);
      console.log(`🔍 [PRODUCT] Fuzzy match for "${searchTerm}": ${products.map(p => p.nom).join(', ')}`);
      return await formatProductResults(products);
    }
  }

  // --- Nothing found ---
  console.log(`❌ [PRODUCT] No match for "${searchTerm}"`);
  return null;
}

/**
 * Extract product names from conversation history
 */
async function extractProductNamesFromHistory(conversationId) {
  if (!conversationId) return [];

  const recentMessages = await Message.find({
    conversationId,
    isDeleted: false
  })
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();

  const allText = recentMessages.map(m => m.content).join(' ').toLowerCase();

  // Try to find product names mentioned in conversation
  // Look for words that could be product names (not common French/Arabic words)
  const commonWords = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'est', 'et', 'en', 'à', 'au',
    'je', 'tu', 'il', 'nous', 'vous', 'ils', 'mon', 'ma', 'mes', 'votre', 'son', 'sa',
    'pour', 'par', 'sur', 'dans', 'avec', 'que', 'qui', 'quoi', 'comment', 'oui', 'non',
    'merci', 'bonjour', 'bonsoir', 'svp', 'prix', 'produit', 'commande', 'disponible',
    'commander', 'combien', 'aide', 'problème', 'livraison', 'stock', 'acheter',
    'actuellement', 'plateforme', 'voulez', 'savoir', 'détails', 'effectuer',
    'vérifier', 'disponibilités', 'questions', 'hésitez', 'demander', 'chez',
    'bouteille', 'pouvez', 'directement', 'avez', 'autres', 'pas', 'faire',
    'sami', 'assistant', 'chat', 'ouvert', 'sujet'
  ]);

  // Search for existing product names in the conversation text
  const allProducts = await Produit.find({}).select('nom').lean();

  const found = [];
  for (const prod of allProducts) {
    const prodName = prod.nom.toLowerCase().replace(/_/g, ' ');
    if (allText.includes(prodName) || allText.includes(prod.nom.toLowerCase())) {
      found.push(prod.nom);
    }
  }

  return found;
}

/**
 * Fetch detailed product data for user queries
 */
async function getProductContext(userMessage, conversationId = null) {
  try {
    if (!userMessage) return '';
    const lowerMsg = userMessage.toLowerCase().trim();

    // --- Case 0: Skip common greetings ---
    const greetings = ['bonjour', 'bonsoir', 'salut', 'hey', 'hello', 'hi', 'salam', 'slm', 'cv', 'merci', 'svp', 'ok', 'oui', 'non', 'bien', 'ça va', 'comment'];
    const isGreeting = greetings.some(g => lowerMsg === g || lowerMsg.startsWith(g + ' '));
    if (isGreeting) return '';

    // --- Case 1: New arrivals / "arrivant" ---
    const arrivalKeywords = ['arrivant', 'arrivage', 'nouveau', 'nouveauté', 'new', 'جديد', 'وصل'];
    const isArrivalQuery = arrivalKeywords.some(kw => lowerMsg.includes(kw));

    if (isArrivalQuery) {
      const recentProducts = await Produit.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('marque', 'nom')
        .populate('format', 'nom volume')
        .populate('categorie', 'nom')
        .populate('unite', 'nom')
        .lean();

      if (recentProducts.length === 0) return '\n[PRODUCT_DATA]\nAucun nouveau produit trouvé.\n[/PRODUCT_DATA]';

      let ctx = '\n[PRODUCT_DATA] Nouveaux produits (les plus récents) :\n';
      for (const p of recentProducts) {
        // Build full category path
        let categoryPath = p.categorie?.nom || 'Non classé';
        if (p.categorie?.parent) {
          const parent = await CategorieProduit.findById(p.categorie.parent).lean();
          if (parent) categoryPath = parent.nom + ' > ' + categoryPath;
        }

        const stock = await Stock.aggregate([
          { $match: { produit: p._id } },
          { $group: { _id: null, total: { $sum: '$quantite' }, reserved: { $sum: '$quantite_reservee' } } }
        ]);
        const available = stock[0] ? stock[0].total - stock[0].reserved : 0;
        ctx += `- ${p.nom} | Marque: ${p.marque?.nom || 'N/A'} | Prix: ${p.prix_reference.toFixed(3)} DT`;
        ctx += ` | Rayon: ${categoryPath}`;
        ctx += ` | Format: ${p.format?.nom || 'standard'}`;
        ctx += ` | En stock: ${available > 0 ? 'Oui' : 'Non'}`;
        ctx += ` | Ajouté le: ${new Date(p.createdAt).toLocaleDateString('fr-TN')}\n`;
      }
      ctx += '[/PRODUCT_DATA]';
      return ctx;
    }

    // --- Case 2: Specific product search ---
    // Clean term: underscores -> spaces, remove question keywords
    // List of words to strip from product queries to find the actual product name
    const stopWords = ['prix', 'price', 'combien', 'coute', 'coût', 'quel', 'quelle', 'est', 'le', 'la', 'les', 'du', 'de', 'des', 'un', 'une', 'pour', 'ce', 'cet', 'cette', 'il', 'elle', 'en', 'au', 'aux', 'mon', 'ma', 'mes', 'votre', 'son', 'sa', 'ses', 'ou', 'et', 'si', 'ne', 'pas', 'plus', 'très', 'aussi', 'avec', 'sur', 'dans', 'par', 'que', 'qui', 'quoi', 'comment', 'y', 'a', 'ai', 'ont', 'avez', 'produit', 'produits', 'disponible', 'disponibilité', 'disponibilités', 'disponibilite', 'disponibilites', 'dispo', 'stock', 'cherche', 'trouver', 'rayon', 'acheter', 'commander', 'avoir', 'veux', 'voulez', 'voudrais', 'je', 'tu', 'nous', 'vous', 'ils', 'elles', 'ça', 'd', 'l', 's', 'n', 'j', 'c', 'qu', 'ثمن', 'سعر', 'بكم', 'كم'];

    let searchTerm = lowerMsg.replace(/_/g, ' ').replace(/[?!.,;:'"()-]/g, ' ').trim();
    
    // Manual stripping to avoid regex \b issues with accents
    let words = searchTerm.split(/\s+/);
    searchTerm = words.filter(w => !stopWords.includes(w)).join(' ').trim();

    const contextKeywords = ['prix', 'price', 'combien', 'coute', 'coût', 'dispo', 'disponible', 'disponibilité', 'disponibilités', 'disponibilite', 'disponibilites', 'stock',
      'similaire', 'alternative', 'remplacer', 'autre', 'pareil', 'rayon', 'trouver', 'cherche',
      'ثمن', 'سعر', 'بكم', 'بديل', 'مشابه'];
    const isProductIntent = contextKeywords.some(kw => lowerMsg.includes(kw));

    // --- NEW: Direct Match Approach ---
    const directMatch = await findProductInMessage(userMessage);
    if (directMatch) {
      console.log(`🎯 [PRODUCT] Direct match found: "${directMatch}"`);
      const result = await searchAndFormatProducts(directMatch);
      if (result) return result;
    }

    // --- Fallback: Regex Search (if term is long enough) ---
    if (searchTerm.length >= 3) {
      const result = await searchAndFormatProducts(searchTerm);
      if (result) return result;
    }

    // --- Case 3: Scan conversation history for previously mentioned products ---
    if (conversationId && (isProductIntent || searchTerm.length < 3)) {
      console.log('🔍 [OLLAMA] Scanning conversation history for product names...');
      const productNames = await extractProductNamesFromHistory(conversationId);

      if (productNames.length > 0) {
        console.log(`🔍 [OLLAMA] Found products in history: ${productNames.join(', ')}`);
        const result = await searchAndFormatProducts(productNames[0].replace(/_/g, ' '));
        if (result) return result;
      }
    }

    // If product intent detected but nothing found anywhere
    if (isProductIntent) {
      // Check if the user actually mentioned a specific product name or just asked a generic question
      // Generic questions: "Ce produit est-il en stock ?", "Prix d'un produit", "Disponibilité d'un produit"
      // These have no actual product name after keyword stripping
      const hasSpecificProductName = searchTerm.length >= 3 || directMatch;
      if (!hasSpecificProductName) {
        console.log('🔍 [OLLAMA] Generic product question detected — asking user to specify product name');
        return '__ASK_PRODUCT__';
      }
      return '__NOT_FOUND__';
    }

    return '';

  } catch (error) {
    console.error('⚠️ [OLLAMA] Error fetching product context:', error.message);
    return '';
  }
}


function formatStatus(statut, lang = 'french') {
  const map = {
    'EN_ATTENTE': { fr: 'En attente', ar: 'قيد الانتظار' },
    'PREPAREE': { fr: 'Préparée', ar: 'تم التحضير' },
    'EN_LIVRAISON': { fr: 'En cours de livraison', ar: 'قيد التوصيل' },
    'EN_COURS': { fr: 'En cours de livraison', ar: 'قيد التوصيل' },
    'LIVREE': { fr: 'Livrée', ar: 'تم التسليم' },
    'CONFIRMEE': { fr: 'Confirmée', ar: 'مؤكدة' },
    'ANNULEE': { fr: 'Annulée', ar: 'ملغاة' },
    'ECHEC': { fr: 'Échec', ar: 'فشل التوصيل' },
    'PARTIELLE': { fr: 'Livraison partielle', ar: 'توصيل جزئي' }
  };
  const res = map[statut] || { fr: statut, ar: statut };
  return lang === 'arabic' ? res.ar : res.fr;
}

async function buildConversationHistory(conversationId, limit = 6) {
  const messages = await Message.find({
    conversationId,
    isDeleted: false
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return messages.reverse().map(msg => ({
    role: msg.senderModel === 'Client' ? 'user' : 'assistant',
    content: msg.content.replace(/\[DATA\][\s\S]*?\[\/DATA\]/gi, '').trim()
  }));
}

async function buildChatPrompt(conversationId, userMessage, clientId = null, topic = 'Général') {
  try {
    const history = await buildConversationHistory(conversationId);
    let systemPrompt = SYSTEM_PROMPT.replace('{{TOPIC}}', topic);
    const isWelcome = userMessage.includes("vient d'ouvrir un chat");

    if (clientId && !isWelcome) {
      const clientContext = await getClientContext(clientId, userMessage);
      if (clientContext) {
        systemPrompt += clientContext;
      }
    }

    if (!isWelcome) {
      const productContext = await getProductContext(userMessage, conversationId);
      if (productContext === '__NOT_FOUND__' || productContext === '__ASK_PRODUCT__') {
        return { messages: [productContext], lang: detectLanguage(userMessage) };
      }
      if (productContext) systemPrompt += productContext;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage }
    ];

    const lang = detectLanguage(userMessage);
    if (lang === 'arabic') {
      messages.push({ role: 'system', content: `⚠️ LANGUE OBLIGATOIRE : L'utilisateur parle en arabe/Darija. Ta réponse doit être EXCLUSIVEMENT en arabe. INTERDIT ABSOLU d'utiliser le français, l'anglais ou tout autre langue. INTERDIT de dire "يرجى الانتظار" ou "سأتحقق". Réponds directement avec les données disponibles.` });
    } else {
      messages.push({ role: 'system', content: `⚠️ LANGUE OBLIGATOIRE : L'utilisateur parle français. Ta réponse doit être EXCLUSIVEMENT en français. INTERDIT ABSOLU d'utiliser l'arabe, l'anglais ou tout autre langue. INTERDIT de dire "attendez" ou "je vais vérifier". Réponds directement avec les données disponibles.` });
    }

    return { messages, lang };
  } catch (error) {
    console.error('❌ [OLLAMA] Error building prompt:', error.message);
    return { messages: [], lang: 'french' };
  }
}

function isMediaMessage(message) {
  if (typeof message !== 'string') return false;
  return message.includes('/uploads/chat/') || /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx|txt)$/i.test(message);
}

async function chat(conversationId, userMessage, clientId = null, topic = 'Général') {
  try {
    // 0. Fast path for media files (images, documents)
    if (isMediaMessage(userMessage)) {
      const lang = detectLanguage(userMessage);
      return lang === 'arabic'
        ? "لقد تلقيت ملفك/صورتك. بصفتي مساعدًا افتراضيًا، لا يمكنني عرض الملفات أو الصور. سأقوم بتحويل طلبك فورًا إلى مسؤول لمساعدتك. [ESCALATE]"
        : "J'ai bien reçu votre fichier/image. En tant qu'assistant virtuel, je ne peux pas visualiser les pièces jointes. Je transmets immédiatement votre demande à un conseiller. [ESCALATE]";
    }

    // 1. Fast path for human request
    const wantsHuman = userMessage.toLowerCase().includes('responsable') || userMessage.toLowerCase().includes('conseiller');

    if (wantsHuman) {
      const lang = detectLanguage(userMessage);
      return lang === 'arabic'
        ? "سأحيل طلبك إلى مسؤول لمساعدتك. [ESCALATE]"
        : "Je transmets votre demande à un responsable. [ESCALATE]";
    }

    const { messages, lang } = await buildChatPrompt(conversationId, userMessage, clientId, topic);
    if (!messages || messages.length === 0) {
      return lang === 'arabic' ? "كيف يمكنني مساعدتك؟" : "Comment puis-je vous aider ?";
    }

    // Special case: user asked about a product but didn't specify which one
    if (messages.length === 1 && typeof messages[0] === 'string' && messages[0] === '__ASK_PRODUCT__') {
      return lang === 'arabic'
        ? 'أي منتج تقصد؟ أعطيني اسم المنتج باش نقدر نساعدك.'
        : "Quel produit vous intéresse ? Merci de me préciser le nom du produit pour que je puisse vous aider.";
    }

    // Special case for not found product
    if (messages.length === 1 && typeof messages[0] === 'string' && messages[0] === '__NOT_FOUND__') {
      return lang === 'arabic'
        ? 'لم نجد هذا المنتج في قاعدة بياناتنا. يرجى التحقق من الاسم أو تصفح المنتجات على المنصة.'
        : "Désolé, ce produit n'a pas été trouvé dans notre catalogue. Veuillez vérifier le nom ou parcourir les produits sur la plateforme.";
    }

    const axios = require('axios');
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: { temperature: 0.5, top_p: 0.9, num_predict: 150, repeat_penalty: 1.2 }
    });

    const rawContent = response.data.message?.content || '';
    console.log(`🤖 [OLLAMA] Raw AI Response: "${rawContent}"`);

    let aiResponse = rawContent
      .replace(/\[DATA[^\]]*\]/gi, '')
      .replace(/\[\/DATA\]/gi, '')
      .replace(/\[PRODUCT_DATA[^\]]*\]/gi, '')
      .replace(/\[\/PRODUCT_DATA\]/gi, '')
      .replace(/Sujet\s*:\s*.*$/gm, '')
      .replace(/\n{3,}/g, '\n')
      .trim();

    aiResponse = stripForeignCharacters(aiResponse);

    if (lang === 'arabic') {
      aiResponse = cleanArabicResponse(aiResponse);
    }

    // Detect escalation before stripping tags
    const containsEscalate = /\[ESCALATE\]/i.test(rawContent);

    // Strip tags for the final visible message
    aiResponse = aiResponse.replace(/\[ESCALATE\]/gi, '').trim();

    if (!aiResponse.trim()) {
      aiResponse = lang === 'arabic' ? "كيف يمكنني مساعدتك؟" : "Comment puis-je vous aider ?";
    }

    if (containsEscalate) {
      aiResponse += ' [ESCALATE]';
    }

    return aiResponse;

  } catch (error) {
    console.error('❌ [OLLAMA] Chat error:', error.message);
    return "Désolé, je rencontre un souci technique. / عذرا، هناك مشكلة تقنية. [ESCALATE]";
  }
}

/**
 * Streaming version of the chat
 */
async function* chatStream(conversationId, userMessage, clientId = null, topic = 'Général') {
  try {
    const { messages, lang } = await buildChatPrompt(conversationId, userMessage, clientId, topic);
    if (!messages || messages.length === 0) {
      yield lang === 'arabic' ? "كيف يمكنني مساعدتك؟" : "Comment puis-je vous aider ?";
      return;
    }

    // Fast path for media files (images, documents)
    if (isMediaMessage(userMessage)) {
      const lang = detectLanguage(userMessage);
      yield lang === 'arabic'
        ? "لقد تلقيت ملفك/صورتك. بصفتي مساعدًا افتراضيًا، لا يمكنني عرض الملفات أو الصور. سأقوم بتحويل طلبك فورًا إلى مسؤول لمساعدتك. [ESCALATE]"
        : "J'ai bien reçu votre fichier/image. En tant qu'assistant virtuel, je ne peux pas visualiser les pièces jointes. Je transmets immédiatement votre demande à un conseiller. [ESCALATE]";
      return;
    }

    // Special case for not found product (pre-determined response)
    const isWelcome = userMessage.includes("vient d'ouvrir un chat");
    const wantsHuman = userMessage.toLowerCase().includes('responsable') || userMessage.toLowerCase().includes('conseiller');


    if (wantsHuman) {
      const lang = detectLanguage(userMessage);
      yield lang === 'arabic'
        ? "سأحيل طلبك إلى مسؤول لمساعدتك. [ESCALATE]"
        : "Je transmets votre demande à un responsable. [ESCALATE]";
      return;
    }

    if (!isWelcome) {
      const productContext = await getProductContext(userMessage, conversationId);
      if (productContext === '__ASK_PRODUCT__') {
        const lang = detectLanguage(userMessage);
        yield lang === 'arabic'
          ? 'أي منتج تقصد؟ أعطيني اسم المنتج باش نقدر نساعدك.'
          : "Quel produit vous intéresse ? Merci de me préciser le nom du produit pour que je puisse vous aider.";
        return;
      }
      if (productContext === '__NOT_FOUND__') {
        const lang = detectLanguage(userMessage);
        yield lang === 'arabic'
          ? 'لم نجد هذا المنتج في قاعدة بياناتنا. يرجى التحقق من الاسم أو تصفح المنتجات على المنصة.'
          : "Désolé, ce produit n'a pas été trouvé dans notre catalogue. Veuillez vérifier le nom ou parcourir les produits sur la plateforme.";
        return;
      }
    }

    console.log(`🤖 [OLLAMA] Sending streaming request (Lang: ${lang})`);

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
        options: { temperature: 0.5, top_p: 0.9, num_predict: 150, repeat_penalty: 1.2 }
      })
    });

    if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      let lines = buffer.split('\n');
      // The last line might be incomplete, keep it in buffer
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          const content = json.message?.content || '';
          if (content) {
            // Filter out internal tags from stream
            let filteredChunk = content
              .replace(/\[DATA[^\]]*\]/gi, '')
              .replace(/\[\/DATA\]/gi, '')
              .replace(/\[PRODUCT_DATA[^\]]*\]/gi, '')
              .replace(/\[\/PRODUCT_DATA\]/gi, '')
              .replace(/\[ESCALATE\]/gi, '');
            
            if (filteredChunk) yield filteredChunk;
          }
          if (json.done) return;
        } catch (e) {
          console.error('Error parsing JSON chunk:', e, 'Line:', line);
        }
      }
    }
  } catch (error) {
    console.error('❌ [OLLAMA] Stream error:', error.message);
    yield "Désolé, je rencontre un souci technique. [ESCALATE]";
  }
}


async function isAvailable() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function shouldEscalate(aiResponse) {
  if (!aiResponse) return false;

  // 1. Check for explicit tag (primary)
  if (/\[ESCALATE\]/i.test(aiResponse)) return true;

  // 2. Check for natural escalation phrases Sami uses (fallback for non-deterministic AI)
  const escalationPhrases = [
    // French — only multi-word phrases that are unambiguously about escalation
    'je transmets votre demande',
    'je vais transmettre votre demande',
    'je transfère votre demande',
    'je passe votre demande',
    "je vous mets en contact avec",
    's\'en occupera rapidement',
    'un responsable qui s\'en',
    'notre équipe va vous contacter',
    // Arabic
    'سأقوم بتحويل طلبك',
    'سأحيل طلبك',
    'سأنقل طلبك',
    'سيتواصل معك'
  ];

  const lower = aiResponse.toLowerCase();
  return escalationPhrases.some(phrase => lower.includes(phrase.toLowerCase()));
}

module.exports = {
  chat,
  isAvailable,
  getClientContext,
  shouldEscalate,
  chatStream,
  OLLAMA_MODEL
};
