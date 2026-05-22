/**
 * routeOptimizer.js
 * Offline TSP optimizer using Local Nearest-Neighbor and 2-Opt local search heuristics.
 * Guarantees zero cost and extremely fast sorting.
 */
const { getHaversineDistance } = require("./eventEngine");

/**
 * Solves the Traveling Salesperson Problem (TSP) locally using Nearest Neighbor + 2-opt.
 * @param {Object} depot - { lat, lng, nom: 'Dépôt', adresse: '...' }
 * @param {Array} stops - Array of stop objects: [{ livraison, nom, adresse, latitude, longitude }]
 * @returns {Array} Ordered stop list with `ordre` properties
 */
function optimizeStopsOrder(depot, stops) {
  if (!stops || stops.length === 0) return [];
  if (stops.length === 1) {
    return [{ ...stops[0], ordre: 1 }];
  }

  // 1. Build a working copy of coordinates and associate original stop pointers
  const nodes = stops.map((s, idx) => ({
    id: idx,
    lat: s.latitude,
    lng: s.longitude,
    originalStop: s
  }));

  // 2. Step 1: Solve Nearest Neighbor Tour starting from depot
  const tour = [];
  const unvisited = [...nodes];
  let currentPoint = { lat: depot.lat || depot.latitude, lng: depot.lng || depot.longitude };

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = getHaversineDistance(
        currentPoint.lat,
        currentPoint.lng,
        unvisited[i].lat,
        unvisited[i].lng
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }

    const nextNode = unvisited.splice(nearestIdx, 1)[0];
    tour.push(nextNode);
    currentPoint = nextNode;
  }

  // 3. Step 2: Run 2-Opt local search to resolve route intersections and crossovers
  let improved = true;
  let iterations = 0;
  const maxIterations = 100; // Cap to guarantee fast processing

  const getTourDistance = (currentTour) => {
    let dist = 0;
    let from = { lat: depot.lat || depot.latitude, lng: depot.lng || depot.longitude };
    
    for (const node of currentTour) {
      dist += getHaversineDistance(from.lat, from.lng, node.lat, node.lng);
      from = node;
    }
    // Return back to depot
    dist += getHaversineDistance(from.lat, from.lng, depot.lat || depot.latitude, depot.lng || depot.longitude);
    return dist;
  };

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    let bestDist = getTourDistance(tour);

    for (let i = 0; i < tour.length - 1; i++) {
      for (let k = i + 1; k < tour.length; k++) {
        // Swap route elements between i and k
        const newTour = [...tour];
        // Reverse array slice between i and k
        const subSlice = newTour.slice(i, k + 1).reverse();
        newTour.splice(i, k - i + 1, ...subSlice);

        const newDist = getTourDistance(newTour);

        if (newDist < bestDist) {
          // Keep swap
          tour.splice(0, tour.length, ...newTour);
          bestDist = newDist;
          improved = true;
        }
      }
    }
  }

  // 4. Map the sorted list back to stops and assign `ordre` numbering (1-indexed)
  return tour.map((node, index) => {
    return {
      ...node.originalStop,
      ordre: index + 1
    };
  });
}

module.exports = {
  optimizeStopsOrder
};
