const Client = require('../models/Client');
const PointDeVente = require('../models/PointDeVente');
const GlobalConfig = require('../models/GlobalConfig');

const DEFAULTS = {
  pointsParDT: 10,
  pointsParAvis: 50,
  bonusInscription: 100,
  valeurPoint: 0.01,
  seuilSilver: 1000,
  seuilGold: 5000,
  multiplicateurSilver: 1.5,
  multiplicateurGold: 2.0,
  minPointsToUse: 500
};

async function getPointsConfig() {
  try {
    const config = await GlobalConfig.findOne({ key: 'LOYALTY_CONFIG' });
    return config?.value || DEFAULTS;
  } catch (error) {
    console.error('Erreur lecture LOYALTY_CONFIG:', error);
    return DEFAULTS;
  }
}

function getMultiplier(niveau, config) {
  if (niveau === 'GOLD') return config.multiplicateurGold || 2.0;
  if (niveau === 'SILVER') return config.multiplicateurSilver || 1.5;
  return 1.0;
}

function calculateLevel(totalGagne, config) {
  if (totalGagne >= (config.seuilGold || 5000)) return 'GOLD';
  if (totalGagne >= (config.seuilSilver || 1000)) return 'SILVER';
  return 'BRONZE';
}

async function earnPoints(clientId, basePoints, description) {
  try {
    let client = await Client.findById(clientId);
    let isPdv = false;
    
    if (!client) {
      client = await PointDeVente.findById(clientId);
      if (!client) return null;
      isPdv = true;
    }

    const config = await getPointsConfig();
    const multiplier = getMultiplier(client.niveau, config);
    const finalPoints = Math.round(basePoints * multiplier);

    if (finalPoints <= 0 && description !== 'Initialisation') return null;

    client.pointsFidelite = (client.pointsFidelite || 0) + finalPoints;
    
    if (!client.historiquePoints) client.historiquePoints = [];
    client.historiquePoints.push({
      type: 'GAIN',
      points: finalPoints,
      description: description,
      date: new Date()
    });

    // Recalculer le niveau basé sur le total cumulé des GAIN
    const totalGagne = client.historiquePoints
      .filter(h => h.type === 'GAIN')
      .reduce((sum, h) => sum + (h.points || 0), 0);
    
    const newLevel = calculateLevel(totalGagne, config);
    if (newLevel !== client.niveau) {
      const oldLevel = client.niveau;
      client.niveau = newLevel;
      client.historiquePoints.push({
        type: 'GAIN',
        points: 0,
        description: `🎉 Félicitations ! Vous êtes passé de ${oldLevel} à ${newLevel}`,
        date: new Date()
      });
    }

    await client.save();
    return { pointsGagnes: finalPoints, nouveauSolde: client.pointsFidelite, niveau: client.niveau };
  } catch (error) {
    console.error('Erreur earnPoints:', error);
    throw error;
  }
}

async function spendPoints(clientId, points, description) {
  try {
    let client = await Client.findById(clientId);
    if (!client) {
      client = await PointDeVente.findById(clientId);
      if (!client) return { success: false, message: 'Utilisateur introuvable' };
    }
    
    const config = await getPointsConfig();
    const minPoints = config.minPointsToUse || 500;
    
    if (points < minPoints) {
      return { success: false, message: `Vous devez utiliser au moins ${minPoints} points.` };
    }

    if ((client.pointsFidelite || 0) < points) {
      return { success: false, message: 'Solde de points insuffisant' };
    }

    const reduction = points * (config.valeurPoint || 0.01);

    client.pointsFidelite -= points;
    
    if (!client.historiquePoints) client.historiquePoints = [];
    client.historiquePoints.push({
      type: 'UTILISATION',
      points: points,
      description: description,
      date: new Date()
    });

    await client.save();
    return { 
      success: true, 
      reduction,
      nouveauSolde: client.pointsFidelite 
    };
  } catch (error) {
    console.error('Erreur spendPoints:', error);
    throw error;
  }
}

module.exports = { earnPoints, spendPoints, getPointsConfig };
