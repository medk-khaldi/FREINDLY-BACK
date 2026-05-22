const Voyage = require("../models/Voyage");
const Camion = require("../models/Camion");
const Chauffeur = require("../models/Chauffeur");
const Livraison = require("../models/Livraison");
const Stock = require("../models/Stock");
const StockConsolide = require("../models/StockConsolide");
const Commande = require("../models/Commande");
const { enregistrerMouvement } = require("./mouvement.controller");
const { formatIdBadge } = require("../utils/idFormatter");
const { createDeliveryNotification, createVoyageNotification, notifyAllResponsables, notifyAllAdmins } = require("./notification.controller");
const orderEmitter = require("../services/orderEvents");


/**
 * Helper: calcule les temps dynamiques (buffer chargement + escales)
 * Formules: 
 * - Buffer chargement = 10 + (poids_total * 3.5 / 250) min (3.5 min pour chaque 250kg)
 * - Escale livraison = 8 + (poids_livraison * 3.5 / 250) min (3.5 min pour chaque 250kg)
 */
async function calculerTempsVoyage(voyageData, livraisonsArray = null) {
  const Produit = require('../models/Produit');
  
  let livs = livraisonsArray;
  if (!livs && voyageData.livraisons && voyageData.livraisons.length > 0) {
    livs = await Livraison.find({ _id: { $in: voyageData.livraisons } }).lean();
  }
  
  if (!livs || livs.length === 0) {
    return { buffer_chargement: 10, temps_escales: 0, poids_total: 0 };
  }

  const allProductIds = [...new Set(livs.flatMap(liv => (liv.lignesLivraison || []).map(l => l.produit)))];
  const prods = await Produit.find({ _id: { $in: allProductIds } }).select('poids_unitaire').lean();
  const prodMap = new Map(prods.map(p => [p._id.toString(), p]));

  let poidsTotalVoyage = 0;
  let tempsEscalesTotal = 0;

  for (const liv of livs) {
    // Utiliser le poids total déjà calculé sur la livraison si disponible
    const poidsLivraison = liv.poids_total || 0;
    poidsTotalVoyage += poidsLivraison;
    // Règle métier : 3.5 minutes pour chaque tranche de 250 kg de marchandise
    tempsEscalesTotal += Math.ceil(8 + (poidsLivraison * 3.5 / 250));
  }

  return {
    // Règle métier : 3.5 minutes pour chaque tranche de 250 kg de marchandise
    buffer_chargement: Math.ceil(10 + (poidsTotalVoyage * 3.5 / 250)),
    temps_escales: tempsEscalesTotal,
    poids_total: poidsTotalVoyage
  };
}

/**
 * Helper: charge les livraisons d'un SEUL voyage (utilisé pour create/update/detail)
 * Fait 1 seul Livraison.find() avec un populate combiné - PAS de boucle await séquentielle
 */
async function populateLivraisonsForVoyage(voyage) {
  if (!voyage.livraisons || voyage.livraisons.length === 0) {
    return voyage;
  }

  const Produit = require('../models/Produit');
  const Lot = require('../models/Lot');

  const livraisonsIds = voyage.livraisons.map(l => l._id || l);

  const livraisons = await Livraison.find({ _id: { $in: livraisonsIds } })
    .populate({
      path: 'commande',
      populate: [
        { path: 'pointDeVente' },
        { path: 'client' },
        {
          path: 'lignesCommande',
          populate: [
            { path: 'produit' },
            { path: 'lot' }
          ]
        }
      ]
    })
    .lean();

  // ✅ OPTIMISATION: Batch populate produits et lots (évite N+1 queries)
  // Collecter tous les IDs en une seule passe
  const produitIds = [];
  const lotIds = [];
  for (const livraison of livraisons) {
    for (const ligne of (livraison.lignesLivraison || [])) {
      if (ligne.produit && !ligne.produit.nom) produitIds.push(ligne.produit);
      if (ligne.lot && !ligne.lot.nom) lotIds.push(ligne.lot);
    }
  }

  // Charger tous les produits/lots manquants en 2 requêtes max (au lieu de N×M)
  const [produits, lots] = await Promise.all([
    produitIds.length > 0 ? Produit.find({ _id: { $in: produitIds } }).select('nom reference image').lean() : [],
    lotIds.length > 0 ? Lot.find({ _id: { $in: lotIds } }).lean() : []
  ]);

  const produitMap = new Map(produits.map(p => [p._id.toString(), p]));
  const lotMap = new Map(lots.map(l => [l._id.toString(), l]));

  // Attacher les données sans requête supplémentaire
  for (const livraison of livraisons) {
    for (const ligne of (livraison.lignesLivraison || [])) {
      if (ligne.produit && !ligne.produit.nom) {
        ligne.produit = produitMap.get(ligne.produit.toString()) || ligne.produit;
      }
      if (ligne.lot && !ligne.lot.nom) {
        ligne.lot = lotMap.get(ligne.lot.toString()) || ligne.lot;
      }
    }
  }

  const voyageObj = voyage.toObject ? voyage.toObject() : { ...voyage };
  voyageObj.livraisons = livraisons;
  return voyageObj;
}


/**
 * Helper: distribue des livraisons (déjà chargées en batch) aux voyages correspondants.
 * Utilisé uniquement par exports.lister pour éviter les N+1 queries.
 * @param {Array} voyages  - tableau de documents Mongoose (toObject() déjà appelé)
 * @param {Array} livraisons - toutes les livraisons chargées en une seule requête
 */
function attachLivraisonsToVoyages(voyages, livraisons) {
  // Construire un Map voyageId → [livraisons]
  const byVoyage = new Map();
  for (const l of livraisons) {
    const vid = l.voyage ? l.voyage.toString() : null;
    if (vid) {
      if (!byVoyage.has(vid)) byVoyage.set(vid, []);
      byVoyage.get(vid).push(l);
    }
  }

  return voyages.map(v => {
    const vObj = v.toObject ? v.toObject() : { ...v };
    vObj.livraisons = byVoyage.get(vObj._id.toString()) || [];
    return vObj;
  });
}


exports.creer = async (req, res) => {
  try {
    const { getDepotCentral } = require("../utils/depotUtils");
    const depot = await getDepotCentral();
    const { camion, chauffeur, commandes, livraisons, date_depart, date_arrivee_prevue, responsable } = req.body;
    if (!camion || !chauffeur) {
      return res.status(400).json({ message: "camion et chauffeur requis" });
    }

    // ✅ Validation 1: Date d'arrivée doit être après date de départ
    if (date_depart && date_arrivee_prevue) {
      const depart = new Date(date_depart);
      const arrivee = new Date(date_arrivee_prevue);
      if (arrivee <= depart) {
        return res.status(400).json({ message: "La date d'arrivée prévue doit être après la date de départ" });
      }
    }

    const camionExists = await Camion.findById(camion);
    const chauffeurExists = await Chauffeur.findById(chauffeur);
    if (!camionExists) return res.status(404).json({ message: "Camion introuvable" });
    if (!chauffeurExists) return res.status(404).json({ message: "Chauffeur introuvable" });

    // ✅ NOUVEAU: Calculer les buffers et temps d'escales
    const { buffer_chargement, temps_escales, poids_total } = await calculerTempsVoyage({ livraisons });

    // ✅ Validation: Capacité STRICTE (100%)
    if (poids_total > camionExists.capacite) {
      return res.status(400).json({ 
        message: `Surcharge détectée: le poids total (${poids_total.toFixed(2)} kg) dépasse la capacité du camion (${camionExists.capacite} kg)` 
      });
    }

    // ✅ Validation: Conflits de dates avec cascade
    if (date_depart && date_arrivee_prevue) {
      const nouveauDepart = new Date(date_depart);
      const nouvelleArriveeSaisie = new Date(date_arrivee_prevue);
      
      // Un voyage occupe le camion de [départ - buffer] jusqu'à [arrivée réelle]
      // L'arrivée est désormais ajustée par le frontend pour inclure les escales.
      const debutOccupation = new Date(nouveauDepart.getTime() - (buffer_chargement * 60000));
      const finOccupation = nouvelleArriveeSaisie;

      const voyagesExistants = await Voyage.find({
        $or: [{ camion: camion }, { chauffeur: chauffeur }],
        statut: { $in: ['EN_ATTENTE', 'PLANIFIE', 'EN_COURS'] },
        date_depart: { $exists: true },
        date_arrivee_prevue: { $exists: true }
      });

      for (const v of voyagesExistants) {
        // Pour chaque voyage existant, on calcule aussi son occupation réelle (avec ses propres buffers)
        const tempsV = await calculerTempsVoyage(v);
        const vDepart = new Date(v.date_depart);
        const vArriveeSaisie = new Date(v.date_arrivee_prevue);
        
        const vDebutOcc = new Date(vDepart.getTime() - (tempsV.buffer_chargement * 60000));
        const vFinOcc = vArriveeSaisie;

        // Chevauchement
        if (debutOccupation < vFinOcc && finOccupation > vDebutOcc) {
          const typeConflit = v.camion.toString() === camion.toString() ? "camion" : "chauffeur";
          const departPossible = new Date(vFinOcc.getTime() + (buffer_chargement * 60000));
          const timeStr = departPossible.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          const vFinStr = vFinOcc.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          return res.status(400).json({ 
            message: `Conflit: ce ${typeConflit} est occupé jusqu'à ${vFinStr} (retour entrepôt). Compte tenu du temps de chargement nécessaire (${buffer_chargement} min) de ce nouveau voyage, le départ n'est possible qu'à partir de ${timeStr}.` 
          });
        }
      }
    }

    // ✅ Validation: Vérifier que les livraisons sont EN_ATTENTE et non assignées
    let stops = [];
    if (livraisons && livraisons.length > 0) {
      const listLivraisons = await Livraison.find({ _id: { $in: livraisons } })
        .populate({
          path: 'commande',
          populate: [
            { path: 'pointDeVente' },
            { path: 'client' }
          ]
        });

      for (const livraison of listLivraisons) {
        if (livraison.statut !== 'EN_ATTENTE') {
          return res.status(400).json({ message: `La livraison ${livraison._id} doit être en attente pour être assignée (statut actuel: ${livraison.statut})` });
        }
        if (livraison.voyage) {
          return res.status(400).json({ message: `La livraison ${livraison._id} est déjà assignée à un autre voyage` });
        }

        // Extraire les informations du point de livraison
        let nom = "Client";
        let adresse = "Adresse inconnue";
        let latitude = undefined;
        let longitude = undefined;

        if (livraison.commande) {
          if (livraison.commande.adresse_livraison) {
            const addr = livraison.commande.adresse_livraison;
            if (addr.latitude && addr.longitude) {
              latitude = addr.latitude;
              longitude = addr.longitude;
            }
            if (addr.rue) {
              adresse = addr.rue;
            }
          }

          if (livraison.commande.pointDeVente) {
            nom = livraison.commande.pointDeVente.nom;
            if (!adresse || adresse === "Adresse inconnue") {
              adresse = livraison.commande.pointDeVente.adresse;
            }
            if (!latitude || !longitude) {
              latitude = livraison.commande.pointDeVente.latitude;
              longitude = livraison.commande.pointDeVente.longitude;
            }
          } else if (livraison.commande.client) {
            const addr = livraison.commande.adresse_livraison;
            if (addr) {
              nom = `${addr.prenom || ''} ${addr.nom || ''}`.trim() || livraison.commande.client.nom || "Client";
              if (!adresse || adresse === "Adresse inconnue") {
                const components = [addr.rue, addr.localite, addr.delegation, addr.gouvernorat]
                  .map(c => c?.trim())
                  .filter(Boolean);
                adresse = components.length > 0 ? components.join(', ') : (livraison.commande.client.adresse || "Adresse inconnue");
              }
            } else {
              nom = livraison.commande.client.nom || "Client";
              adresse = livraison.commande.client.adresse || "Adresse inconnue";
            }
            if (!latitude || !longitude) {
              latitude = livraison.commande.client.latitude;
              longitude = livraison.commande.client.longitude;
            }
          }
        }

        // Fallback ultime s'il n'y a toujours pas de coordonnées valides
        if (!latitude || !longitude) {
          latitude = depot.latitude;
          longitude = depot.longitude;
        }

        stops.push({
          livraison: livraison._id,
          nom,
          adresse,
          latitude,
          longitude,
          statut: 'EN_ATTENTE'
        });
      }
    }

    // Heuristique locale d'optimisation (TSP)
    const { optimizeStopsOrder } = require("../services/routeOptimizer");
    const optimizedStops = optimizeStopsOrder(depot, stops);

    const voyage = await Voyage.create({
      camion,
      chauffeur,
      commandes: commandes || [],
      livraisons: livraisons || [],
      responsable: responsable || undefined,
      cree_par: req.user?.id || undefined,
      date_depart: date_depart ? new Date(date_depart) : undefined,
      date_arrivee_prevue: date_arrivee_prevue ? new Date(date_arrivee_prevue) : undefined,
      statut: "EN_ATTENTE",
      stops: optimizedStops
    });

    // Assigner le voyage aux livraisons
    if (livraisons && livraisons.length > 0) {
      await Livraison.updateMany(
        { _id: { $in: livraisons } },
        { voyage: voyage._id }
      );
    }

    // Initialiser les ETAs réelles via OpenRouteService
    const { initializeVoyageETAs } = require("../services/etaService");
    try {
      await initializeVoyageETAs(voyage._id, depot);
    } catch (etaErr) {
      console.error("⚠️ [ETA FAILED] Impossible d'initialiser les ETAs avec ORS:", etaErr.message);
      // Poursuivre silencieusement pour éviter de bloquer la création du voyage en cas de panne de l'API
    }

    let v = await Voyage.findById(voyage._id)
      .populate({ path: "camion", options: { withDeleted: true } })
      .populate({ 
        path: "chauffeur", 
        options: { withDeleted: true },
        populate: { path: "utilisateur", options: { withDeleted: true } } 
      })
      .populate("responsable");

    // Populer les livraisons avec toutes les données
    v = await populateLivraisonsForVoyage(v);

    // 📢 Créer une notification pour le chauffeur
    try {
      if (v.chauffeur && v.chauffeur.utilisateur) {
        await createVoyageNotification(
          v.chauffeur.utilisateur._id,
          v,
          'VOYAGE_ASSIGNED'
        );
      }
    } catch (notifErr) {
      console.error("❌ Erreur création notifications voyage:", notifErr);
      // Ne pas faire échouer la création pour une erreur de notification
    }

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('voyage_created', {
        timestamp: new Date()
      });
      // ✅ Real-time: Notifier aussi le chauffeur assigné
      if (v.chauffeur && v.chauffeur.utilisateur) {
        dashboardIo.to(`user_${v.chauffeur.utilisateur._id || v.chauffeur.utilisateur}`).emit('voyage_created', {
          timestamp: new Date()
        });
        dashboardIo.to(`user_${v.chauffeur.utilisateur._id || v.chauffeur.utilisateur}`).emit('voyage_assigned', {
          timestamp: new Date(),
          voyageId: v._id
        });
      }
    }

    res.status(201).json(v);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.lister = async (req, res) => {
  try {
    // ✅ OPTIMISATION: Filtre optionnel par chauffeur via query param ?chauffeurId=xxx
    // Permet au dashboard chauffeur de ne charger que SES voyages (évite de récupérer toute la collection)
    const filter = {};
    if (req.query.chauffeurId) {
      // Récupérer le Chauffeur document à partir de l'utilisateur ID
      // ✅ FIX: Inclure les chauffeurs supprimés/restaurés pour retrouver tout l'historique
      const chauffeur = await Chauffeur.findOne({ utilisateur: req.query.chauffeurId }).setOptions({ withDeleted: true }).lean();
      if (chauffeur) {
        filter.chauffeur = chauffeur._id;
      } else {
        // Essayer directement comme ObjectId chauffeur (si c'est déjà l'_id du chauffeur)
        filter.chauffeur = req.query.chauffeurId;
      }
    }

    const voyages = await Voyage.find(filter)
      .populate({ path: "camion", options: { withDeleted: true } })
      .populate({ 
        path: "chauffeur", 
        options: { withDeleted: true },
        populate: { path: "utilisateur", select: "username email role", options: { withDeleted: true } } 
      })
      .populate({ path: "cree_par", select: "username email", options: { withDeleted: true } })
      .populate({ path: "annule_par", select: "username email", options: { withDeleted: true } })
      .populate({ path: "livraisons", select: "statut _id" })  // Populate seulement le statut des livraisons
      .sort({ numero_voyage: -1 })
      .lean();   // ← .lean() retourne des objets JS purs, plus rapide que des docs Mongoose

    res.json(voyages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};




exports.getById = async (req, res) => {
  try {
    let voyage = await Voyage.findById(req.params.id)
      .populate({ path: "camion", options: { withDeleted: true } })
      .populate({ 
        path: "chauffeur", 
        options: { withDeleted: true },
        populate: { path: "utilisateur", options: { withDeleted: true } } 
      })
      .populate({ path: "responsable", options: { withDeleted: true } })
      .populate({ path: "cree_par", select: "username email", options: { withDeleted: true } })
      .populate({ path: "annule_par", select: "username email", options: { withDeleted: true } })
      .populate("commandes");

    if (!voyage) return res.status(404).json({ message: "Voyage introuvable" });

    // Populer les livraisons avec toutes les données
    voyage = await populateLivraisonsForVoyage(voyage);

    res.json(voyage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Associer une livraison à un voyage (par le responsable)
 */
exports.associerLivraison = async (req, res) => {
  try {
    const { voyageId, livraisonId } = req.params;

    const voyage = await Voyage.findById(voyageId);
    const livraison = await Livraison.findById(livraisonId);
    if (!voyage) return res.status(404).json({ message: "Voyage introuvable" });
    if (!livraison) return res.status(404).json({ message: "Livraison introuvable" });

    // ✅ Validation: Ne pas assigner de livraison à un voyage EN_COURS ou TERMINE
    if (voyage.statut === "EN_COURS") {
      return res.status(400).json({ message: "Impossible d'assigner une livraison à un voyage en cours" });
    }
    if (voyage.statut === "TERMINE") {
      return res.status(400).json({ message: "Impossible d'assigner une livraison à un voyage terminé" });
    }

    // ✅ Validation: Vérifier que la livraison n'est pas déjà assignée à un autre voyage
    if (livraison.voyage && livraison.voyage.toString() !== voyageId) {
      return res.status(400).json({ message: "Cette livraison est déjà assignée à un autre voyage" });
    }

    // ✅ Validation: Vérifier que la livraison est EN_ATTENTE (pas annulée)
    if (livraison.statut !== 'EN_ATTENTE') {
      return res.status(400).json({ message: "Seules les livraisons en attente peuvent être assignées à un voyage" });
    }

    if (!voyage.livraisons) voyage.livraisons = [];
    if (voyage.livraisons.some(id => id.toString() === livraisonId)) {
      return res.status(400).json({ message: "Livraison déjà associée à ce voyage" });
    }

    voyage.livraisons.push(livraison._id);
    await voyage.save();

    livraison.voyage = voyage._id;
    await livraison.save();

    // 📢 Créer une notification pour le chauffeur si le voyage a un chauffeur assigné
    try {
      if (voyage.chauffeur) {
        // Populate le chauffeur pour obtenir l'utilisateur
        const voyageWithChauffeur = await Voyage.findById(voyageId)
          .populate({ path: "chauffeur", populate: { path: "utilisateur" } });
        
        if (voyageWithChauffeur.chauffeur && voyageWithChauffeur.chauffeur.utilisateur) {
          // Populate la livraison avec les données nécessaires pour la notification
          const livraisonWithData = await Livraison.findById(livraisonId)
            .populate({
              path: 'commande',
              populate: { path: 'pointDeVente' }
            });

          await createDeliveryNotification(
            voyageWithChauffeur.chauffeur.utilisateur._id,
            livraisonWithData,
            'NEW_DELIVERY'
          );
        }
      }
    } catch (notifErr) {
      console.error("❌ Erreur création notification association livraison:", notifErr);
      // Ne pas faire échouer l'association pour une erreur de notification
    }

    let v = await Voyage.findById(voyageId)
      .populate({ path: "camion", options: { withDeleted: true } })
      .populate({ 
        path: "chauffeur", 
        options: { withDeleted: true },
        populate: { path: "utilisateur", options: { withDeleted: true } } 
      })
      .populate("commandes");

    // Populer les livraisons avec toutes les données
    v = await populateLivraisonsForVoyage(v);

    res.json({ message: "Livraison associée au voyage", voyage: v });

    // ✅ Real-time: Notifier le chauffeur que son voyage a été mis à jour
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo && v.chauffeur && v.chauffeur.utilisateur) {
      dashboardIo.to(`user_${v.chauffeur.utilisateur._id || v.chauffeur.utilisateur}`).emit('voyage_updated', {
        timestamp: new Date()
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Démarrer un voyage
 */
exports.demarrer = async (req, res) => {
  try {
    const voyage = await Voyage.findById(req.params.id).populate('livraisons').populate('chauffeur').populate('camion');
    if (!voyage) return res.status(404).json({ message: "Voyage introuvable" });

    if (voyage.statut !== "EN_ATTENTE") {
      return res.status(400).json({ message: "Le voyage ne peut être démarré (statut: " + voyage.statut + ")" });
    }

    // ✅ Validation 1: Le voyage doit avoir au moins une livraison non-annulée
    if (!voyage.livraisons || voyage.livraisons.length === 0) {
      return res.status(400).json({ message: "Impossible de démarrer un voyage sans livraison assignée" });
    }
    
    // Vérifier qu'il y a au moins une livraison non-annulée
    const livraisonsNonAnnulees = voyage.livraisons.filter(liv => liv.statut !== 'ANNULEE');
    if (livraisonsNonAnnulees.length === 0) {
      return res.status(400).json({ message: "Impossible de démarrer un voyage : toutes les livraisons sont annulées" });
    }

    // ✅ Validation 2: Le chauffeur ne doit pas avoir d'autre voyage EN_COURS
    const voyagesEnCoursChauffeur = await Voyage.find({
      chauffeur: voyage.chauffeur._id,
      statut: 'EN_COURS',
      _id: { $ne: voyage._id }
    });
    if (voyagesEnCoursChauffeur.length > 0) {
      return res.status(400).json({ message: "Ce chauffeur a déjà un voyage en cours" });
    }

    // ✅ Validation 3: Le camion ne doit pas avoir d'autre voyage EN_COURS
    const voyagesEnCoursCamion = await Voyage.find({
      camion: voyage.camion._id,
      statut: 'EN_COURS',
      _id: { $ne: voyage._id }
    });
    if (voyagesEnCoursCamion.length > 0) {
      return res.status(400).json({ message: "Ce camion est déjà utilisé dans un autre voyage en cours" });
    }

    voyage.statut = "EN_COURS";
    voyage.date_depart_reelle = new Date(); // Date réelle de départ
    await voyage.save();

    // 🚚 Changer le statut du camion à EN_COURS
    await Camion.findByIdAndUpdate(voyage.camion._id, { statut: 'EN_COURS' });
    console.log(`🚛 Camion ${voyage.camion._id} passé en EN_COURS`);

    // 📢 Notifier les responsables et admins que le chauffeur a démarré
    try {
      const voyageForNotif = await Voyage.findById(voyage._id)
        .populate({ path: 'chauffeur', populate: { path: 'utilisateur', select: 'username' } });
      const chauffeurName = voyageForNotif?.chauffeur?.utilisateur?.username || 'Un chauffeur';
      const notifTitle = '🚛 Voyage démarré';
      const notifMsg = `${chauffeurName} a démarré son voyage`;
      const notifData = { voyageId: voyage._id };
      await Promise.all([
        notifyAllResponsables('VOYAGE_STARTED', notifTitle, notifMsg, notifData),
        notifyAllAdmins('VOYAGE_STARTED', notifTitle, notifMsg, notifData)
      ]);
    } catch (notifErr) {
      console.error('❌ Erreur notification VOYAGE_STARTED:', notifErr);
    }

    // 🚚 Changer automatiquement le statut des livraisons associées à EN_COURS (sauf les annulées)
    await Livraison.updateMany(
      { 
        _id: { $in: voyage.livraisons },
        statut: { $ne: "ANNULEE" }  // Exclure les livraisons annulées
      },
      { statut: "EN_COURS" }
    );

    // 🔁 Mettre à jour le statut des commandes associées aux livraisons (sauf annulées)
    for (const livraisonId of voyage.livraisons) {
      const livraison = await Livraison.findById(livraisonId);
      if (livraison && livraison.statut !== 'ANNULEE' && livraison.commande) {
        const commande = await Commande.findById(livraison.commande).populate("lignesCommande");
        
        if (commande) {
          // Récupérer toutes les livraisons de cette commande (sauf annulées)
          const toutesLivraisons = await Livraison.find({ 
            commande: livraison.commande,
            statut: { $ne: "ANNULEE" }
          });
          
          // 🚀 UTILISER LA NOUVELLE LOGIQUE INTELLIGENTE
          const { calculerStatutCommande } = require('./commande.controller');
          const statutInfo = await calculerStatutCommande(commande._id);
          
          if (statutInfo && statutInfo.statut !== commande.statut) {
            const ancienStatut = commande.statut;
            commande.statut = statutInfo.statut;
            if (statutInfo.pourcentageLivraison) {
              commande.pourcentage_livraison = statutInfo.pourcentageLivraison;
            }
            await commande.save();

            // 📧 Notification Email
            orderEmitter.emit('order_status_changed', { 
              commandeId: commande._id, 
              oldStatus: ancienStatut, 
              newStatus: statutInfo.statut, 
              source: 'SYSTEME',
              commentaire: `Voyage démarré - Passage en livraison`
            });
          } else {
            // Statut déjà correct
          }
        }
      }
    }

    let v = await Voyage.findById(voyage._id)
      .populate({ path: "camion", options: { withDeleted: true } })
      .populate({ 
        path: "chauffeur", 
        options: { withDeleted: true },
        populate: { path: "utilisateur", options: { withDeleted: true } } 
      })
      .populate("responsable");

    // Populer les livraisons avec toutes les données
    v = await populateLivraisonsForVoyage(v);

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('voyage_started', {
        _id: voyage._id,
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('delivery_status_changed', {
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('order_status_changed', {
        timestamp: new Date()
      });
    }

    res.json({ message: "Voyage démarré", voyage: v });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Terminer un voyage
 */
exports.terminer = async (req, res) => {
  try {
    const voyage = await Voyage.findById(req.params.id)
      .populate('livraisons')
      .populate({ path: 'chauffeur', populate: { path: 'utilisateur' } });
    if (!voyage) return res.status(404).json({ message: "Voyage introuvable" });

    if (voyage.statut !== "EN_COURS") {
      return res.status(400).json({ message: "Le voyage ne peut être terminé (statut: " + voyage.statut + ")" });
    }

    voyage.statut = "TERMINE";
    voyage.date_arrivee_reelle = new Date(); // Date réelle d'arrivée
    await voyage.save();

    // 📢 Notifier les responsables et admins que le chauffeur est retourné
    try {
      const chauffeurName = voyage.chauffeur?.utilisateur?.username || 'Un chauffeur';
      const notifTitle = '✅ Voyage terminé';
      const notifMsg = `${chauffeurName} a terminé son voyage et est retourné`;
      const notifData = { voyageId: voyage._id };
      await Promise.all([
        notifyAllResponsables('VOYAGE_FINISHED', notifTitle, notifMsg, notifData),
        notifyAllAdmins('VOYAGE_FINISHED', notifTitle, notifMsg, notifData)
      ]);
    } catch (notifErr) {
      console.error('❌ Erreur notification VOYAGE_FINISHED:', notifErr);
    }

    // 🚚 Remettre le statut du camion à DISPONIBLE
    await Camion.findByIdAndUpdate(voyage.camion, { statut: 'DISPONIBLE' });
    console.log(`🚛 Camion ${voyage.camion} remis à DISPONIBLE`);

    // 📍 Arrêter automatiquement le tracking GPS pour ce chauffeur (Via Socket.IO dans la nouvelle version)
    // Le serveur Socket.IO gérera la déconnexion et le marquage hors-ligne.

    // 🚚 NOUVEAU: Traitement en deux passes pour gérer correctement le déstockage
    
    // PASSE 1: Marquer toutes les livraisons EN_COURS comme LIVREE
    console.log('🔄 PASSE 1: Marquage des livraisons EN_COURS comme LIVREE...');
    for (const livraisonId of voyage.livraisons) {
      const livraison = await Livraison.findById(livraisonId);
      
      if (livraison && livraison.statut === 'EN_COURS') {
        console.log(`🔄 Changement statut EN_COURS → LIVREE pour livraison ${livraison._id}`);
        livraison.statut = "LIVREE";
        livraison.date_livraison = new Date();
        await livraison.save();
      }
    }
    
    // PASSE 2: Déstockage de toutes les livraisons LIVREE qui n'ont pas encore été déstockées
    const commandesAMettreAJour = new Set();
    
    for (const livraisonId of voyage.livraisons) {
      const livraison = await Livraison.findById(livraisonId).populate({
        path: 'commande',
        populate: { path: 'lignesCommande', populate: 'lot' }
      });

      // ✅ CORRECTION: Traiter seulement les livraisons LIVREE qui n'ont pas encore été déstockées
      if (livraison && livraison.statut === 'LIVREE' && !livraison.destockage_effectue) {
        commandesAMettreAJour.add(livraison.commande._id.toString());

        // Enregistrer UN SEUL mouvement SORTIE par ligne de livraison
        for (const ligne of livraison.lignesLivraison) {
          
          // Info lot
          const ligneCmd = livraison.commande?.lignesCommande?.find(lc =>
            lc.produit.toString() === ligne.produit.toString()
          );
          const lot = ligneCmd?.lot;

          // Calculer les informations de lot pour la quantité totale de la ligne
          // Utiliser l'ID formaté du voyage (nouveau système)
          const voyageIdFormate = voyage.id_formate || `VOY-${voyage.numero_voyage?.toString().padStart(4, '0') || '????'}`;
          let commentaire = `Livraison via voyage ${voyageIdFormate}`;
          let lotInfo = null;
          
          if (lot) {
            const nbLots = Math.floor(ligne.quantite / lot.quantite_unitaire);
            const resteLots = ligne.quantite % lot.quantite_unitaire;
            
            // Stocker les informations de lot structurées pour la quantité totale
            lotInfo = {
              lot_id: lot._id,
              nom_lot: lot.nom,
              quantite_unitaire: lot.quantite_unitaire,
              nombre_lots: nbLots,
              reste_unites: resteLots
            };
          }

          // Mettre à jour le stock consolidé (déstockage)
          const stockConsolide = await StockConsolide.findOne({ produit: ligne.produit });
          if (stockConsolide) {
            // Vérifier qu'il y a assez de stock réservé
            if (stockConsolide.quantite_reservee >= ligne.quantite) {
              // Déduire de la quantité totale et réservée (consommation lors de livraison)
              stockConsolide.quantite_totale -= ligne.quantite;   // Consommer le stock physique
              stockConsolide.quantite_reservee -= ligne.quantite; // Libérer la réservation
              // quantite_disponible reste inchangée car: nouveau_total - nouveau_reserve = (total-qty) - (reserve-qty) = total - reserve
              stockConsolide.date_mise_a_jour = new Date();
              await stockConsolide.save();
            } else {
              console.warn(`⚠️ Stock réservé insuffisant: ${stockConsolide.quantite_reservee} < ${ligne.quantite}`);
              // Libérer ce qui est disponible
              const aLiberer = Math.min(stockConsolide.quantite_reservee, ligne.quantite);
              if (aLiberer > 0) {
                // Libération partielle du stock réservé
                stockConsolide.quantite_totale -= aLiberer;   // Consommer le stock physique
                stockConsolide.quantite_reservee -= aLiberer; // Libérer la réservation
                // quantite_disponible reste inchangée car: nouveau_total - nouveau_reserve = (total-qty) - (reserve-qty) = total - reserve
                stockConsolide.date_mise_a_jour = new Date();
                await stockConsolide.save();
                console.log(`⚠️ Libération partielle: ${aLiberer} unités sur ${ligne.quantite} demandées`);
              }
            }
          }

          // Déduire aussi des stocks individuels (pour cohérence)
          const stocks = await Stock.find({ produit: ligne.produit, quantite: { $gt: 0 } });
          let reste = ligne.quantite;
          
          for (const stock of stocks) {
            if (reste <= 0) break;
            
            const aDeduire = Math.min(stock.quantite, reste);
            if (aDeduire <= 0) continue;

            // Déduire du stock individuel
            stock.quantite -= aDeduire;
            stock.date_mise_a_jour = new Date();
            await stock.save();

            reste -= aDeduire;
          }

          if (reste > 0) {
            console.error(`❌ Stock insuffisant pour livraison ${livraisonId}: ${reste} unités manquantes`);
          }

          // Créer UN SEUL mouvement pour toute la ligne de livraison
          // Utiliser le premier stock pour la référence du mouvement
          const premierStock = stocks[0];
          if (premierStock) {
            const MouvementStock = require("../models/MouvementStock");
            const mouvement = new MouvementStock({
              stock: premierStock._id,
              type: "SORTIE",
              quantite: ligne.quantite,
              utilisateur: req.user?.id,
              reference: livraison._id,
              reference_type: "Livraison",
              commentaire: commentaire,
              lot_info: lotInfo,
              date_mouvement: new Date()
            });
            await mouvement.save();
          }
        }

        // Marquer que le déstockage a été effectué pour cette livraison
        livraison.destockage_effectue = true;
        await livraison.save();
        commandesAMettreAJour.add(livraison.commande._id.toString()); // Toujours ajouter pour mise à jour statut commande
      } else if (livraison && livraison.statut === 'LIVREE' && livraison.destockage_effectue) {
        // Livraison déjà déstockée individuellement, passage à la suivante
        commandesAMettreAJour.add(livraison.commande._id.toString()); // Toujours ajouter pour mise à jour statut commande
      } else if (livraison && livraison.statut !== 'LIVREE') {
        console.log(`⚠️ Livraison ${livraison._id} pas encore LIVREE (statut: ${livraison.statut}), passage à la suivante`);
      }
    }
    
    // PASSE 3: Mise à jour des statuts des commandes concernées
    const { calculerStatutCommande } = require('./commande.controller');
    
    for (const commandeId of commandesAMettreAJour) {
      const commande = await Commande.findById(commandeId).populate("lignesCommande");
      
      if (commande) {
        // 🚀 UTILISER LA NOUVELLE LOGIQUE INTELLIGENTE
        const statutInfo = await calculerStatutCommande(commandeId);
        
        if (statutInfo && statutInfo.statut !== commande.statut) {
          const ancienStatut = commande.statut;
          commande.statut = statutInfo.statut;
          if (statutInfo.pourcentageLivraison) {
            commande.pourcentage_livraison = statutInfo.pourcentageLivraison;
          }
          await commande.save();

          // 📧 Notification Email
          orderEmitter.emit('order_status_changed', { 
            commandeId: commande._id, 
            oldStatus: ancienStatut, 
            newStatus: statutInfo.statut, 
            source: 'SYSTEME',
            commentaire: `Voyage terminé - Mise à jour statut`
          });
        } else {
          // Statut déjà correct
        }
      }
    }

    let v = await Voyage.findById(voyage._id)
      .populate({ path: "camion", options: { withDeleted: true } })
      .populate({ 
        path: "chauffeur", 
        options: { withDeleted: true },
        populate: { path: "utilisateur", options: { withDeleted: true } } 
      })
      .populate("responsable");

    // Populer les livraisons avec toutes les données
    v = await populateLivraisonsForVoyage(v);

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('voyage_finished', {
        _id: voyage._id,
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('delivery_status_changed', {
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('order_status_changed', {
        timestamp: new Date()
      });
    }

    res.json({ message: "Voyage terminé", voyage: v });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Supprimer/Annuler un voyage
 */
exports.supprimer = async (req, res) => {
  try {
    const voyage = await Voyage.findById(req.params.id);
    if (!voyage) return res.status(404).json({ message: "Voyage introuvable" });

    if (voyage.statut === "TERMINE") {
      return res.status(400).json({ message: "Impossible de supprimer un voyage terminé" });
    }

    // ✅ Validation: Impossible d'annuler un voyage EN_COURS
    if (voyage.statut === "EN_COURS") {
      return res.status(400).json({ message: "Impossible d'annuler un voyage en cours. Le voyage doit d'abord être terminé." });
    }

    // Désassigner les livraisons avant d'annuler le voyage
    if (voyage.livraisons && voyage.livraisons.length > 0) {
      await Livraison.updateMany(
        { _id: { $in: voyage.livraisons } },
        { $unset: { voyage: "" } }
      );
    }

    // Marquer comme annulé au lieu de supprimer
    voyage.statut = "ANNULE";
    voyage.annule_par = req.user?.id;
    await voyage.save();

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('voyage_cancelled', {
        _id: voyage._id,
        timestamp: new Date()
      });
      dashboardIo.to('staff').emit('delivery_status_changed', {
        timestamp: new Date()
      });
    }

    res.json({ message: "Voyage annulé" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Modifier un voyage (camion, chauffeur, livraisons)
 */
exports.modifier = async (req, res) => {
  try {
    const { getDepotCentral } = require("../utils/depotUtils");
    const depot = await getDepotCentral();
    const { id } = req.params;
    const { camion, chauffeur, livraisons, date_depart, date_arrivee_prevue } = req.body;

    const voyage = await Voyage.findById(id);
    if (!voyage) return res.status(404).json({ message: "Voyage introuvable" });

    // ✅ Validation: Ne pas modifier un voyage EN_COURS ou TERMINE
    if (voyage.statut === "EN_COURS") {
      return res.status(400).json({ message: "Impossible de modifier un voyage en cours" });
    }
    if (voyage.statut === "TERMINE") {
      return res.status(400).json({ message: "Impossible de modifier un voyage terminé" });
    }

    // Valider le camion si fourni
    if (camion && camion !== voyage.camion.toString()) {
      const camionExists = await Camion.findById(camion);
      if (!camionExists) return res.status(404).json({ message: "Camion introuvable" });

      // ✅ Validation: Vérifier les conflits de dates pour le nouveau camion
      if (voyage.date_depart && voyage.date_arrivee_prevue) {
        const depart = new Date(voyage.date_depart);
        const arrivee = new Date(voyage.date_arrivee_prevue);

        const voyagesExistants = await Voyage.find({
          camion: camion,
          statut: { $in: ['EN_ATTENTE', 'EN_COURS'] },
          _id: { $ne: id }, // Exclure le voyage actuel
          date_depart: { $exists: true },
          date_arrivee_prevue: { $exists: true }
        });

        for (const v of voyagesExistants) {
          const vDepart = new Date(v.date_depart);
          const vArrivee = new Date(v.date_arrivee_prevue);

          if (depart < vArrivee && arrivee > vDepart) {
            return res.status(400).json({ 
              message: `Conflit de dates: ce camion est déjà assigné à un voyage du ${vDepart.toLocaleString('fr-FR')} au ${vArrivee.toLocaleString('fr-FR')}` 
            });
          }
        }
      }
      // ✅ Validation: Vérifier que le camion n'est pas en maintenance
      if (camionExists.statut === 'EN_MAINTENANCE') {
        return res.status(400).json({ message: "Impossible d'assigner un camion en maintenance" });
      }

      // ✅ SUPPRIMÉ: Plus de validation pour les voyages EN_COURS lors de la modification EN_ATTENTE
      // On peut assigner le même camion à plusieurs voyages EN_ATTENTE

      voyage.camion = camion;
    }

    // Valider le chauffeur si fourni
    if (chauffeur && chauffeur !== voyage.chauffeur.toString()) {
      const chauffeurExists = await Chauffeur.findById(chauffeur);
      if (!chauffeurExists) return res.status(404).json({ message: "Chauffeur introuvable" });

      // ✅ Validation: Vérifier les conflits de dates pour le nouveau chauffeur
      if (voyage.date_depart && voyage.date_arrivee_prevue) {
        const depart = new Date(voyage.date_depart);
        const arrivee = new Date(voyage.date_arrivee_prevue);

        const voyagesExistants = await Voyage.find({
          chauffeur: chauffeur,
          statut: { $in: ['EN_ATTENTE', 'EN_COURS'] },
          _id: { $ne: id }, // Exclure le voyage actuel
          date_depart: { $exists: true },
          date_arrivee_prevue: { $exists: true }
        });

        for (const v of voyagesExistants) {
          const vDepart = new Date(v.date_depart);
          const vArrivee = new Date(v.date_arrivee_prevue);

          if (depart < vArrivee && arrivee > vDepart) {
            return res.status(400).json({ 
              message: `Conflit de dates: ce chauffeur a déjà un voyage prévu du ${vDepart.toLocaleString('fr-FR')} au ${vArrivee.toLocaleString('fr-FR')}` 
            });
          }
        }
      }

      voyage.chauffeur = chauffeur;
    }

    // ✅ NOUVEAU: Gérer les livraisons (Désassigner les anciennes, assigner les nouvelles)
    let currentLivraisons = livraisons || voyage.livraisons;
    
    // Calculer les buffers et temps d'escales avec les livraisons finales
    const { buffer_chargement, temps_escales, poids_total } = await calculerTempsVoyage({ livraisons: currentLivraisons });

    const camId = camion || voyage.camion;
    const camExists = await Camion.findById(camId);
    if (!camExists) return res.status(404).json({ message: "Camion introuvable" });

    // ✅ Validation: Capacité STRICTE (100%)
    if (poids_total > camExists.capacite) {
      return res.status(400).json({ 
        message: `Surcharge détectée: le poids total (${poids_total.toFixed(2)} kg) dépasse la capacité du camion (${camExists.capacite} kg)` 
      });
    }

    // ✅ Validation: Conflits de dates avec cascade
    const finalDepart = date_depart ? new Date(date_depart) : voyage.date_depart;
    const finalArriveeSaisie = date_arrivee_prevue ? new Date(date_arrivee_prevue) : voyage.date_arrivee_prevue;
    const finalChauffeur = chauffeur || voyage.chauffeur;

    if (finalDepart && finalArriveeSaisie) {
      const debutOccupation = new Date(finalDepart.getTime() - (buffer_chargement * 60000));
      const finOccupation = finalArriveeSaisie;

      const voyagesExistants = await Voyage.find({
        $or: [{ camion: camId }, { chauffeur: finalChauffeur }],
        statut: { $in: ['EN_ATTENTE', 'PLANIFIE', 'EN_COURS'] },
        _id: { $ne: id }, // Exclure le voyage actuel
        date_depart: { $exists: true },
        date_arrivee_prevue: { $exists: true }
      });

      for (const v of voyagesExistants) {
        const tempsV = await calculerTempsVoyage(v);
        const vDepart = new Date(v.date_depart);
        const vArriveeSaisie = new Date(v.date_arrivee_prevue);
        
        const vDebutOcc = new Date(vDepart.getTime() - (tempsV.buffer_chargement * 60000));
        const vFinOcc = vArriveeSaisie;

        if (debutOccupation < vFinOcc && finOccupation > vDebutOcc) {
          const typeConflit = v.camion.toString() === camId.toString() ? "camion" : "chauffeur";
          const departPossible = new Date(vFinOcc.getTime() + (buffer_chargement * 60000));
          const timeStr = departPossible.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          const vFinStr = vFinOcc.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          return res.status(400).json({ 
            message: `Conflit: ce ${typeConflit} est occupé jusqu'à ${vFinStr} (retour entrepôt). Compte tenu du temps de chargement nécessaire (${buffer_chargement} min) de ce nouveau voyage, le départ n'est possible qu'à partir de ${timeStr}.` 
          });
        }
      }
    }

    // Appliquer les changements
    if (camion) voyage.camion = camion;
    if (chauffeur) voyage.chauffeur = chauffeur;
    if (date_depart) voyage.date_depart = new Date(date_depart);
    if (date_arrivee_prevue) voyage.date_arrivee_prevue = new Date(date_arrivee_prevue);

    if (livraisons) {
      // Désassigner les anciennes livraisons
      if (voyage.livraisons && voyage.livraisons.length > 0) {
        await Livraison.updateMany(
          { _id: { $in: voyage.livraisons } },
          { $unset: { voyage: "" } }
        );
      }
      // Assigner les nouvelles
      if (livraisons.length > 0) {
        await Livraison.updateMany(
          { _id: { $in: livraisons } },
          { voyage: id }
        );
      }
      voyage.livraisons = livraisons;

      // Rebuild stops
      const listLivraisons = await Livraison.find({ _id: { $in: livraisons } })
        .populate({
          path: 'commande',
          populate: [
            { path: 'pointDeVente' },
            { path: 'client' }
          ]
        });

      let newStops = [];
      for (const livraison of listLivraisons) {
        let nom = "Client";
        let adresse = "Adresse inconnue";
        let latitude = undefined;
        let longitude = undefined;

        if (livraison.commande) {
          if (livraison.commande.adresse_livraison) {
            const addr = livraison.commande.adresse_livraison;
            if (addr.latitude && addr.longitude) {
              latitude = addr.latitude;
              longitude = addr.longitude;
            }
            if (addr.rue) {
              adresse = addr.rue;
            }
          }

          if (livraison.commande.pointDeVente) {
            nom = livraison.commande.pointDeVente.nom;
            if (!adresse || adresse === "Adresse inconnue") {
              adresse = livraison.commande.pointDeVente.adresse;
            }
            if (!latitude || !longitude) {
              latitude = livraison.commande.pointDeVente.latitude;
              longitude = livraison.commande.pointDeVente.longitude;
            }
          } else if (livraison.commande.client) {
            const addr = livraison.commande.adresse_livraison;
            if (addr) {
              nom = `${addr.prenom || ''} ${addr.nom || ''}`.trim() || livraison.commande.client.nom || "Client";
              if (!adresse || adresse === "Adresse inconnue") {
                const components = [addr.rue, addr.localite, addr.delegation, addr.gouvernorat]
                  .map(c => c?.trim())
                  .filter(Boolean);
                adresse = components.length > 0 ? components.join(', ') : (livraison.commande.client.adresse || "Adresse inconnue");
              }
            } else {
              nom = livraison.commande.client.nom || "Client";
              adresse = livraison.commande.client.adresse || "Adresse inconnue";
            }
            if (!latitude || !longitude) {
              latitude = livraison.commande.client.latitude;
              longitude = livraison.commande.client.longitude;
            }
          }
        }

        if (!latitude || !longitude) {
          latitude = depot.latitude;
          longitude = depot.longitude;
        }

        newStops.push({
          livraison: livraison._id,
          nom,
          adresse,
          latitude,
          longitude,
          statut: 'EN_ATTENTE'
        });
      }

      const { optimizeStopsOrder } = require("../services/routeOptimizer");
      voyage.stops = optimizeStopsOrder(depot, newStops);
    }

    await voyage.save();

    let v = await Voyage.findById(id)
      .populate("camion")
      .populate({ path: "chauffeur", populate: { path: "utilisateur" } })
      .populate("responsable");

    // Populer les livraisons avec toutes les données
    v = await populateLivraisonsForVoyage(v);

    // 📡 Real-time: Notifier les dashboards staff
    const dashboardIo = req.app.get('io')?.of('/dashboard');
    if (dashboardIo) {
      dashboardIo.to('staff').emit('voyage_updated', {
        _id: id,
        timestamp: new Date()
      });
    }

    res.json({ message: "Voyage modifié avec succès", voyage: v });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Déclarer la sortie d'un voyage (Planifier formellement)
 * Statut: EN_ATTENTE -> PLANIFIE
 */
exports.declarerSortie = async (req, res) => {
  try {
    const { id } = req.params;
    const { date_depart, date_arrivee_prevue } = req.body;

    let voyage = await Voyage.findById(id);
    if (!voyage) return res.status(404).json({ message: "Voyage introuvable" });

    // Validation des dates
    if (!date_depart || !date_arrivee_prevue) {
      return res.status(400).json({ message: "Date de départ et d'arrivée prévue requises" });
    }

    // Ré-utiliser la logique de validation de modifier
    req.body = {
      ...req.body,
      camion: voyage.camion.toString(),
      chauffeur: voyage.chauffeur.toString(),
      livraisons: voyage.livraisons.map(l => l.toString())
    };
    
    // On appelle manuellement la validation de disponibilité (ou on laisse modifier le faire)
    // Mais ici on veut changer le statut en plus.
    
    voyage.date_depart = new Date(date_depart);
    voyage.date_arrivee_prevue = new Date(date_arrivee_prevue);
    voyage.statut = "PLANIFIE";
    
    await voyage.save();
    
    res.json({ message: "Voyage planifié avec succès", voyage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Obtenir la disponibilité de tous les camions pour un créneau donné
 * Prend en compte les buffers de chargement et les escales
 */
exports.getCamionsDisponibilite = async (req, res) => {
  try {
    const { date_depart, date_arrivee_prevue } = req.query;
    if (!date_depart || !date_arrivee_prevue) {
      return res.status(400).json({ message: "Dates requises" });
    }

    const camions = await Camion.find({ statut: { $ne: 'SUPPRIME' } }).lean();
    const nouveauDepart = new Date(date_depart);
    const nouvelleArriveeSaisie = new Date(date_arrivee_prevue);

    const result = [];

    for (const camion of camions) {
      if (camion.statut === 'EN_MAINTENANCE') {
        result.push({ ...camion, disponible: false, raison: "EN_MAINTENANCE" });
        continue;
      }

      // Chercher les voyages actifs de ce camion
      const voyagesActifs = await Voyage.find({
        camion: camion._id,
        statut: { $in: ['EN_ATTENTE', 'PLANIFIE', 'EN_COURS'] },
        date_depart: { $exists: true },
        date_arrivee_prevue: { $exists: true }
      }).lean();

      let estDisponible = true;
      let prochainCreneau = null;

      for (const v of voyagesActifs) {
        const tempsV = await calculerTempsVoyage(v);
        const vDepart = new Date(v.date_depart);
        const vArriveeSaisie = new Date(v.date_arrivee_prevue);
        
        const vDebutOcc = new Date(vDepart.getTime() - (tempsV.buffer_chargement * 60000));
        const vFinOcc = vArriveeSaisie;

        // Un nouveau voyage peut commencer son CHARGEMENT dès que le camion est de retour (vFinOcc)
        const nouveauDebutChargement = new Date(nouveauDepart.getTime() - (10 * 60000));
        
        if (nouveauDebutChargement < vFinOcc && nouvelleArriveeSaisie > vDebutOcc) {
          estDisponible = false;
          prochainCreneau = vFinOcc;
          break;
        }
      }

      result.push({
        ...camion,
        disponible: estDisponible,
        prochaine_dispo: prochainCreneau
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Récupérer les livraisons disponibles (EN_ATTENTE et non assignées à un voyage)
 * Si voyageId est fourni, inclure aussi les livraisons assignées à ce voyage
 */
exports.getLivraisonsDisponibles = async (req, res) => {
  try {
    const { voyageId } = req.query;

    let query = {
      statut: 'EN_ATTENTE'
    };

    if (voyageId) {
      // Si on modifie un voyage, inclure les livraisons non assignées OU assignées à ce voyage
      query.$or = [
        { voyage: { $exists: false } },
        { voyage: null },
        { voyage: voyageId }
      ];
    } else {
      // Sinon, seulement les livraisons non assignées
      query.$or = [
        { voyage: { $exists: false } },
        { voyage: null }
      ];
    }

    const livraisons = await Livraison.find(query)
      .populate({
        path: "commande",
        populate: { path: "pointDeVente" }
      })
      .populate({
        path: "lignesLivraison.produit",
        select: "nom reference image"
      })
      .populate("camion_assigne")
      .sort({ date_creation: -1 });

    res.json(livraisons);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

/**
 * Reordonner manuellement les arrêts (stops) d'un voyage (Approche Hybride)
 * Recalcule la polyline et les ETAs après le changement d'ordre.
 */
exports.reordonnerStops = async (req, res) => {
  try {
    const { getDepotCentral } = require("../utils/depotUtils");
    const depot = await getDepotCentral();
    const { id } = req.params;
    const { sortedStops } = req.body; // Tableau attendu: [{ stopId: string, ordre: number }]

    const voyage = await Voyage.findById(id).populate({
      path: 'livraisons',
      populate: {
        path: 'commande',
        populate: [
          { path: 'pointDeVente' },
          { path: 'client' }
        ]
      }
    });
    if (!voyage) return res.status(404).json({ message: "Voyage introuvable" });

    if (voyage.statut !== "EN_ATTENTE" && voyage.statut !== "PLANIFIE") {
      return res.status(400).json({ message: "Impossible de réordonner les arrêts d'un voyage déjà démarré ou terminé." });
    }

    // Mettre à jour l'ordre, l'adresse et les coordonnées de chaque arrêt dans le Voyage
    for (const item of sortedStops) {
      const stop = voyage.stops.id(item.stopId);
      if (stop) {
        stop.ordre = item.ordre;
        
        // Corriger dynamiquement l'adresse et les coordonnées si nécessaire
        const livraison = voyage.livraisons?.find(l => l._id.toString() === stop.livraison?.toString());
        if (livraison && livraison.commande) {
          let nom = "Client";
          let adresse = "Adresse inconnue";
          let latitude = undefined;
          let longitude = undefined;

          if (livraison.commande.adresse_livraison) {
            const addr = livraison.commande.adresse_livraison;
            if (addr.latitude && addr.longitude) {
              latitude = addr.latitude;
              longitude = addr.longitude;
            }
            if (addr.rue) {
              adresse = addr.rue;
            }
          }

          if (livraison.commande.pointDeVente) {
            nom = livraison.commande.pointDeVente.nom;
            if (!adresse || adresse === "Adresse inconnue") {
              adresse = livraison.commande.pointDeVente.adresse;
            }
            if (!latitude || !longitude) {
              latitude = livraison.commande.pointDeVente.latitude;
              longitude = livraison.commande.pointDeVente.longitude;
            }
          } else if (livraison.commande.client) {
            const addr = livraison.commande.adresse_livraison;
            if (addr) {
              nom = `${addr.prenom || ''} ${addr.nom || ''}`.trim() || livraison.commande.client.nom || "Client";
              if (!adresse || adresse === "Adresse inconnue") {
                const components = [addr.rue, addr.localite, addr.delegation, addr.gouvernorat]
                  .map(c => c?.trim())
                  .filter(Boolean);
                adresse = components.length > 0 ? components.join(', ') : (livraison.commande.client.adresse || "Adresse inconnue");
              }
            } else {
              nom = livraison.commande.client.nom || "Client";
              adresse = livraison.commande.client.adresse || "Adresse inconnue";
            }
            if (!latitude || !longitude) {
              latitude = livraison.commande.client.latitude;
              longitude = livraison.commande.client.longitude;
            }
          }

          if (nom) stop.nom = nom;
          if (adresse && adresse !== "Adresse inconnue") stop.adresse = adresse;
          if (latitude && longitude) {
            stop.latitude = latitude;
            stop.longitude = longitude;
          }
        }
      }
    }

    await voyage.save();

    // Recalculer le tracé et les ETAs via OpenRouteService
    const { initializeVoyageETAs } = require("../services/etaService");
    
    try {
      await initializeVoyageETAs(voyage._id, depot);
    } catch (etaErr) {
      console.error("⚠️ [ETA FAILED] Impossible de recalculer les ETAs avec ORS:", etaErr.message);
    }

    // Récupérer le voyage entièrement peuplé/populé pour le renvoyer au frontend (évite les bugs d'affichage "Inconnu")
    const updatedVoyage = await Voyage.findById(voyage._id)
      .populate({ path: "camion", options: { withDeleted: true } })
      .populate({ 
        path: "chauffeur", 
        options: { withDeleted: true },
        populate: { path: "utilisateur", options: { withDeleted: true } } 
      })
      .populate("responsable");
    
    const fullyPopulatedVoyage = await populateLivraisonsForVoyage(updatedVoyage);

    res.json({ message: "Ordre des arrêts mis à jour", voyage: fullyPopulatedVoyage });
  } catch (err) {
    console.error("❌ Error reordering stops:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};


exports.previewETA = async (req, res) => {
  try {
    const { getDepotCentral } = require("../utils/depotUtils");
    const depot = await getDepotCentral();
    const { date_depart, livraisons } = req.body;
    if (!livraisons || livraisons.length === 0) {
      return res.json({ date_arrivee_prevue: date_depart });
    }

    let stops = [];
    const listLivraisons = await Livraison.find({ _id: { $in: livraisons } })
      .populate({
        path: 'commande',
        populate: [
          { path: 'pointDeVente' },
          { path: 'client' }
        ]
      });

    for (const livraison of listLivraisons) {
      let nom = "Client";
      let adresse = "Adresse inconnue";
      let latitude = undefined;
      let longitude = undefined;

      if (livraison.commande) {
        if (livraison.commande.adresse_livraison) {
          const addr = livraison.commande.adresse_livraison;
          if (addr.latitude && addr.longitude) {
            latitude = addr.latitude;
            longitude = addr.longitude;
          }
          if (addr.rue) {
            adresse = addr.rue;
          }
        }

        if (livraison.commande.pointDeVente) {
          nom = livraison.commande.pointDeVente.nom;
          if (!adresse || adresse === "Adresse inconnue") {
            adresse = livraison.commande.pointDeVente.adresse;
          }
          if (!latitude || !longitude) {
            latitude = livraison.commande.pointDeVente.latitude;
            longitude = livraison.commande.pointDeVente.longitude;
          }
        } else if (livraison.commande.client) {
          const addr = livraison.commande.adresse_livraison;
          if (addr) {
            nom = `${addr.prenom || ''} ${addr.nom || ''}`.trim() || livraison.commande.client.nom || "Client";
            if (!adresse || adresse === "Adresse inconnue") {
              const components = [addr.rue, addr.localite, addr.delegation, addr.gouvernorat]
                .map(c => c?.trim())
                .filter(Boolean);
              adresse = components.length > 0 ? components.join(', ') : (livraison.commande.client.adresse || "Adresse inconnue");
            }
          } else {
            nom = livraison.commande.client.nom || "Client";
            adresse = livraison.commande.client.adresse || "Adresse inconnue";
          }
          if (!latitude || !longitude) {
            latitude = livraison.commande.client.latitude;
            longitude = livraison.commande.client.longitude;
          }
        }
      }

      if (!latitude || !longitude) {
        latitude = depot.latitude;
        longitude = depot.longitude;
      }

      stops.push({
        livraison: livraison._id,
        nom,
        adresse,
        latitude,
        longitude,
        poids_total: livraison.poids_total || 0,
        statut: 'EN_ATTENTE'
      });
    }

    const { optimizeStopsOrder } = require("../services/routeOptimizer");
    const optimizedStops = optimizeStopsOrder(depot, stops);

    const { calculatePreviewETAs } = require("../services/etaService");
    const result = await calculatePreviewETAs(date_depart, optimizedStops, depot);

    if (!result) {
      // Fallback estimate
      const transitTimeMins = (livraisons.length * 20) + 15;
      const departDate = new Date(date_depart || Date.now());
      const calculatedArrivee = new Date(departDate.getTime() + (transitTimeMins * 60000));
      return res.json({ date_arrivee_prevue: calculatedArrivee });
    }

    res.json({
      date_arrivee_prevue: result.date_arrivee_prevue,
      stops: result.stops,
      distance: result.distance,
      duration: result.duration
    });
  } catch (err) {
    console.error("❌ Error calculating preview ETA:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

