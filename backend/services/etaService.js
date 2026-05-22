/**
 * etaService.js
 * Logistics ETA cascade engine. Computes trip timeline schedules,
 * executes dynamic delay shifts, and manages chauffeur voyage cascades.
 */
const { getDirections } = require("./routingService");
const Voyage = require("../models/Voyage");
const { DEFAULT_DEPOT } = require("../utils/depotUtils");

const DEFAULT_UNLOAD_DURATION_MINS = 10; // 10 minutes per stop
const TRAFFIC_MULTIPLIER = parseFloat(process.env.TRAFFIC_MULTIPLIER) || 1.6; // Multiplier for realistic Tunis traffic

/**
 * Helper: Calculates a dynamic traffic multiplier based on the leg's theoretical average speed.
 * Urban roads (slow speed) get a higher traffic multiplier.
 * Highways (fast speed) get a lower traffic multiplier (closer to 1.1).
 */
function getDynamicTrafficMultiplier(distanceMeters, durationSeconds) {
  if (durationSeconds <= 0) return 1.0;
  
  // Speed in km/h = (distance in meters / duration in seconds) * 3.6
  const speedKmh = (distanceMeters / durationSeconds) * 3.6;
  const urbanSpeedLimit = 40; // km/h
  const highwaySpeedLimit = 75; // km/h
  const maxMultiplier = TRAFFIC_MULTIPLIER; // Configured max traffic delay for city center
  const minMultiplier = 1.1; // Baseline for highway (minor delays only)

  if (speedKmh <= urbanSpeedLimit) {
    return maxMultiplier;
  } else if (speedKmh >= highwaySpeedLimit) {
    return minMultiplier;
  } else {
    // Smooth linear interpolation between urban and highway speed
    const ratio = (speedKmh - urbanSpeedLimit) / (highwaySpeedLimit - urbanSpeedLimit);
    return maxMultiplier - ratio * (maxMultiplier - minMultiplier);
  }
}

/**
 * Initializes ETAs for all stops in a voyage.
 * @param {String} voyageId - The Voyage DB ObjectId
 * @param {Object} depot - { lat, lng }
 * @returns {Promise<Object>} The updated Voyage document
 */
async function initializeVoyageETAs(voyageId, depot) {
  const voyage = await Voyage.findById(voyageId).populate("livraisons");
  if (!voyage) throw new Error("Voyage not found");
  if (!voyage.stops || voyage.stops.length === 0) return voyage;

  // 1. Sort stops by order
  const sortedStops = [...voyage.stops].sort((a, b) => a.ordre - b.ordre);

  // 2. Prepare coordinate legs for OpenRouteService
  // Coords format in ORS is [lng, lat]
  const coordinates = [];
  coordinates.push([depot.lng, depot.lat]); // Start at Depot

  for (const stop of sortedStops) {
    coordinates.push([stop.longitude, stop.latitude]);
  }
  
  coordinates.push([depot.lng, depot.lat]); // Return to Depot

  try {
    // 3. Fetch route geometry and segment timings from ORS
    const routeInfo = await getDirections(coordinates);
    
    // Total duration is in seconds. Since ORS gives us one full route,
    // we can approximate individual legs proportional to straight-line distances,
    // or make sequential directions calls. To preserve API budget (Feature 9),
    // we do one call and segment the duration proportionally to straight-line distance.
    const segmentRatios = [];
    let totalHaversineDist = 0;
    const { getHaversineDistance } = require("./eventEngine");

    let prevPoint = depot;
    for (const stop of sortedStops) {
      const dist = getHaversineDistance(prevPoint.lat || prevPoint.latitude, prevPoint.lng || prevPoint.longitude, stop.latitude, stop.longitude);
      segmentRatios.push(dist);
      totalHaversineDist += dist;
      prevPoint = stop;
    }
    // Return leg
    const finalDist = getHaversineDistance(prevPoint.latitude, prevPoint.longitude, depot.lat || depot.latitude, depot.lng || depot.longitude);
    segmentRatios.push(finalDist);
    totalHaversineDist += finalDist;

    // 4. Calculate planned ETAs
    let currentPointTime = new Date(voyage.date_depart || Date.now());
    let totalAdjustedDuration = 0;
    
    for (let i = 0; i < sortedStops.length; i++) {
      const ratio = totalHaversineDist > 0 ? (segmentRatios[i] / totalHaversineDist) : 0;
      const legDistance = routeInfo.distance * ratio;
      const legDuration = routeInfo.duration * ratio;
      
      const dynamicMultiplier = getDynamicTrafficMultiplier(legDistance, legDuration);
      const legDurationSeconds = legDuration * dynamicMultiplier;
      totalAdjustedDuration += legDurationSeconds;
      
       // Calculate Arrival Time = Current Time + travel duration
      const arrivalTime = new Date(currentPointTime.getTime() + legDurationSeconds * 1000);
      sortedStops[i].plannedArrival = arrivalTime;

      // Règle métier : 3.5 minutes pour chaque tranche de 250 kg de marchandise + 8 minutes de base
      const matchingLiv = voyage.livraisons.find(l => l._id.toString() === sortedStops[i].livraison.toString());
      const poidsLiv = matchingLiv ? (matchingLiv.poids_total || 0) : 0;
      const unloadMins = Math.ceil(8 + (poidsLiv * 3.5 / 250));
      currentPointTime = new Date(arrivalTime.getTime() + unloadMins * 60 * 1000);
    }

    // Final depot arrival (Return leg)
    const finalRatio = totalHaversineDist > 0 ? (segmentRatios[segmentRatios.length - 1] / totalHaversineDist) : 0;
    const finalLegDistance = routeInfo.distance * finalRatio;
    const finalLegDuration = routeInfo.duration * finalRatio;
    
    const finalMultiplier = getDynamicTrafficMultiplier(finalLegDistance, finalLegDuration);
    const finalLegSeconds = finalLegDuration * finalMultiplier;
    totalAdjustedDuration += finalLegSeconds;
    
    const voyageEndPrevue = new Date(currentPointTime.getTime() + finalLegSeconds * 1000);

    // 5. Persist back to DB
    voyage.stops = sortedStops;
    voyage.optimizedRoute = {
      polyline: routeInfo.polyline,
      distance: routeInfo.distance,
      duration: Math.round(totalAdjustedDuration)
    };
    voyage.date_arrivee_prevue = voyageEndPrevue;
    
    await voyage.save();
    return voyage;

  } catch (error) {
    console.error("❌ Failed to initialize Voyage ETAs:", error.message);
    throw error;
  }
}

/**
 * Propagates a time shift / delay (in minutes) across all remaining stops in a voyage.
 */
async function cascadeDelay(voyageId, delayMinutes, logDescription = "Dynamic delay adjustment") {
  const voyage = await Voyage.findById(voyageId);
  if (!voyage) return null;

  console.log(`⏱️ [DELAY CASCADE] Voyage ${voyage.id_formate} shifted by +${delayMinutes} minutes.`);

  // Shift stops that are still pending (EN_ATTENTE)
  for (let stop of voyage.stops) {
    if (stop.statut === "EN_ATTENTE" && stop.plannedArrival) {
      stop.plannedArrival = new Date(stop.plannedArrival.getTime() + delayMinutes * 60 * 1000);
    }
  }

  // Shift planned end arrival of Voyage
  if (voyage.date_arrivee_prevue) {
    voyage.date_arrivee_prevue = new Date(voyage.date_arrivee_prevue.getTime() + delayMinutes * 60 * 1000);
  }

  // Update cumulative voyage delay field
  voyage.delay += delayMinutes;

  voyage.eventLog.push({
    type: "TRIP_DELAYED",
    timestamp: new Date(),
    description: `${logDescription}: +${delayMinutes} mins delay added.`
  });

  await voyage.save();

  // Cascade delay to NEXT voyage of this driver if conflict occurs
  await cascadeToNextVoyage(voyage.chauffeur, voyage.date_arrivee_prevue);

  return voyage;
}

/**
 * Cascades delay to subsequent voyages of the same driver if their schedules overlap.
 * Assumes a minimum 30-minute rest/turnaround buffer between trips.
 */
async function cascadeToNextVoyage(chauffeurId, currentVoyageEnd) {
  if (!currentVoyageEnd) return;

  const nextVoyage = await Voyage.findOne({
    chauffeur: chauffeurId,
    statut: "EN_ATTENTE"
  }).sort({ date_depart: 1 });

  if (!nextVoyage) return;

  const minBuffer = 30 * 60 * 1000; // 30 minutes rest buffer
  const earliestDeparture = new Date(currentVoyageEnd.getTime() + minBuffer);

  if (nextVoyage.date_depart < earliestDeparture) {
    const diffMs = earliestDeparture.getTime() - nextVoyage.date_depart.getTime();
    const delayMins = Math.round(diffMs / (60 * 1000));

    console.log(`🔀 [CASCADE NEXT] Overlap detected! Voyage ${nextVoyage.id_formate} departure delayed by ${delayMins} mins.`);

    nextVoyage.date_depart = earliestDeparture;
    await nextVoyage.save();

    // Trigger full stops recalculation for this newly delayed voyage
    // Since stops are stored relative to date_depart, we shift all planned ETAs of voyageB
    for (let stop of nextVoyage.stops) {
      if (stop.plannedArrival) {
        stop.plannedArrival = new Date(stop.plannedArrival.getTime() + diffMs);
      }
    }
    if (nextVoyage.date_arrivee_prevue) {
      nextVoyage.date_arrivee_prevue = new Date(nextVoyage.date_arrivee_prevue.getTime() + diffMs);
    }
    
    nextVoyage.eventLog.push({
      type: "TRIP_DELAYED",
      timestamp: new Date(),
      description: `Départ retardé suite au retard du voyage précédent (+${delayMins} mins).`
    });

    await nextVoyage.save();
  }
}

/**
 * Updates next stop ETA when unexpected traffic is encountered.
 * Uses 1 call to ORS.
 */
async function updateTrafficETA(voyageId, currentCoords, nextStopId) {
  const voyage = await Voyage.findById(voyageId);
  if (!voyage) return null;

  const nextStop = voyage.stops.find(s => s._id.toString() === nextStopId.toString());
  if (!nextStop) return null;

  try {
    // 1. Fetch exact routing from current position to next stop (Lng, Lat for ORS)
    const route = await getDirections([
      [currentCoords.lng, currentCoords.lat],
      [nextStop.longitude, nextStop.latitude]
    ]);

    const dynamicMultiplier = getDynamicTrafficMultiplier(route.distance, route.duration);
    const newArrival = new Date(Date.now() + route.duration * 1000 * dynamicMultiplier);
    const oldArrival = nextStop.plannedArrival;
    
    const diffMs = newArrival.getTime() - oldArrival.getTime();
    const diffMins = Math.round(diffMs / (60 * 1000));

    if (diffMins > 3) { // Trigger delay cascade only if delay is substantial (>3 minutes)
      await cascadeDelay(
        voyageId,
        diffMins,
        `Trafic ralenti détecté sur le tronçon en cours`
      );
    }

  } catch (err) {
    console.error("❌ Failed to update traffic ETA:", err.message);
  }
}

/**
 * Calculates real-time ETAs for a list of optimized stops BEFORE the voyage is saved/created.
 * Uses 1 call to ORS with dynamic traffic multiplier.
 */
async function calculatePreviewETAs(dateDepart, sortedStops, depot) {
  if (!sortedStops || sortedStops.length === 0) {
    return {
      stops: [],
      date_arrivee_prevue: dateDepart
    };
  }

  const { getDirections } = require("./routingService");
  const { getHaversineDistance } = require("./eventEngine");

  try {
    // 1. Coordinates list (Depot -> Stops -> Depot)
    const coords = [
      [depot.lng || depot.longitude || DEFAULT_DEPOT.longitude, depot.lat || depot.latitude || DEFAULT_DEPOT.latitude]
    ];
    for (const stop of sortedStops) {
      coords.push([stop.longitude, stop.latitude]);
    }
    coords.push([depot.lng || depot.longitude || DEFAULT_DEPOT.longitude, depot.lat || depot.latitude || DEFAULT_DEPOT.latitude]);

    // 2. Fetch ORS directions
    const routeInfo = await getDirections(coords);

    // 3. Segment distances (Haversine)
    const segmentRatios = [];
    let totalHaversineDist = 0;

    let prevPoint = depot;
    for (const stop of sortedStops) {
      const dist = getHaversineDistance(
        prevPoint.lat || prevPoint.latitude || DEFAULT_DEPOT.latitude,
        prevPoint.lng || prevPoint.longitude || DEFAULT_DEPOT.longitude,
        stop.latitude,
        stop.longitude
      );
      segmentRatios.push(dist);
      totalHaversineDist += dist;
      prevPoint = stop;
    }
    const finalDist = getHaversineDistance(
      prevPoint.latitude,
      prevPoint.longitude,
      depot.lat || depot.latitude || DEFAULT_DEPOT.latitude,
      depot.lng || depot.longitude || DEFAULT_DEPOT.longitude
    );
    segmentRatios.push(finalDist);
    totalHaversineDist += finalDist;

    // 4. Calculate planned ETAs with getDynamicTrafficMultiplier
    let currentPointTime = new Date(dateDepart || Date.now());
    let totalAdjustedDuration = 0;
    
    for (let i = 0; i < sortedStops.length; i++) {
      const ratio = totalHaversineDist > 0 ? (segmentRatios[i] / totalHaversineDist) : 0;
      const legDistance = routeInfo.distance * ratio;
      const legDuration = routeInfo.duration * ratio;
      
      const dynamicMultiplier = getDynamicTrafficMultiplier(legDistance, legDuration);
      const legDurationSeconds = legDuration * dynamicMultiplier;
      totalAdjustedDuration += legDurationSeconds;
      
      const arrivalTime = new Date(currentPointTime.getTime() + legDurationSeconds * 1000);
      sortedStops[i].plannedArrival = arrivalTime;

      // Règle métier : 3.5 minutes pour chaque tranche de 250 kg de marchandise + 8 minutes de base
      const poidsLiv = sortedStops[i].poids_total || 0;
      const unloadMins = Math.ceil(8 + (poidsLiv * 3.5 / 250));
      currentPointTime = new Date(arrivalTime.getTime() + unloadMins * 60 * 1000);
    }

    // Return leg
    const finalRatio = totalHaversineDist > 0 ? (segmentRatios[segmentRatios.length - 1] / totalHaversineDist) : 0;
    const finalLegDistance = routeInfo.distance * finalRatio;
    const finalLegDuration = routeInfo.duration * finalRatio;
    
    const finalMultiplier = getDynamicTrafficMultiplier(finalLegDistance, finalLegDuration);
    const finalLegSeconds = finalLegDuration * finalMultiplier;
    totalAdjustedDuration += finalLegSeconds;
    
    const dateArriveePrevue = new Date(currentPointTime.getTime() + finalLegSeconds * 1000);

    return {
      stops: sortedStops,
      date_arrivee_prevue: dateArriveePrevue,
      distance: routeInfo.distance,
      duration: totalAdjustedDuration
    };
  } catch (err) {
    console.error("⚠️ [PREVIEW ETA FAILED] Failed to calculate real-time preview:", err.message);
    // Return fallback in case ORS fails
    return null;
  }
}

module.exports = {
  initializeVoyageETAs,
  cascadeDelay,
  updateTrafficETA,
  calculatePreviewETAs
};
