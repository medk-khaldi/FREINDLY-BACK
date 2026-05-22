/**
 * eventEngine.js
 * Core event-driven logic engine. Performs high-performance,
 * zero-cost offline mathematical operations on GPS coordinates.
 */

/**
 * Calculates the great-circle distance between two points in meters using the Haversine formula.
 */
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of Earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

/**
 * Helper: Projects a point onto a line segment (defined by two points)
 * and returns the distance from the point to the segment.
 */
function getPointToSegmentDistance(lat, lng, latA, lngA, latB, lngB) {
  const x = lng;
  const y = lat;
  const x1 = lngA;
  const y1 = latA;
  const x2 = lngB;
  const y2 = latB;

  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  // Calculate distance using simple planar approximation for short segments,
  // or precise Haversine distance from the original point to the projected point.
  return getHaversineDistance(y, x, yy, xx);
}

/**
 * Calculates the minimum perpendicular distance from a driver's coordinate to a polyline route.
 * @param {Object} current - { lat, lng } of the driver
 * @param {Array} polylinePoints - Array of [lat, lng] or {lat, lng} objects representing the route
 */
function getRouteDeviation(current, polylinePoints) {
  if (!polylinePoints || polylinePoints.length < 2) return 0;

  let minDistance = Infinity;

  for (let i = 0; i < polylinePoints.length - 1; i++) {
    const ptA = polylinePoints[i];
    const ptB = polylinePoints[i + 1];

    const latA = Array.isArray(ptA) ? ptA[0] : ptA.lat;
    const lngA = Array.isArray(ptA) ? ptA[1] : ptA.lng;
    const latB = Array.isArray(ptB) ? ptB[0] : ptB.lat;
    const lngB = Array.isArray(ptB) ? ptB[1] : ptB.lng;

    const dist = getPointToSegmentDistance(current.lat, current.lng, latA, lngA, latB, lngB);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance; // in meters
}

/**
 * Evaluates whether a driver is close enough to a stop (Geofence threshold: 50 meters).
 */
function isAtStop(current, stopCoords, threshold = 50) {
  const dist = getHaversineDistance(current.lat, current.lng, stopCoords.lat, stopCoords.lng);
  return dist <= threshold;
}

/**
 * Computes remaining travel duration along a polyline using linear interpolation.
 * @param {Object} current - { lat, lng } driver location
 * @param {Array} polylinePoints - Array of [lat, lng] or {lat, lng} route points
 * @param {Number} totalDuration - Planned total duration of route segment in seconds
 * @returns {Number} Estimated remaining duration in seconds (0 to totalDuration)
 */
function getInterpolatedRemainingTime(current, polylinePoints, totalDuration) {
  if (!polylinePoints || polylinePoints.length < 2 || totalDuration <= 0) return 0;

  // 1. Calculate cumulative lengths between all polyline points
  const segmentLengths = [];
  let totalLength = 0;

  for (let i = 0; i < polylinePoints.length - 1; i++) {
    const ptA = polylinePoints[i];
    const ptB = polylinePoints[i + 1];
    const latA = Array.isArray(ptA) ? ptA[0] : ptA.lat;
    const lngA = Array.isArray(ptA) ? ptA[1] : ptA.lng;
    const latB = Array.isArray(ptB) ? ptB[0] : ptB.lat;
    const lngB = Array.isArray(ptB) ? ptB[1] : ptB.lng;

    const len = getHaversineDistance(latA, lngA, latB, lngB);
    segmentLengths.push(len);
    totalLength += len;
  }

  if (totalLength === 0) return 0;

  // 2. Find the closest segment index and point parameter
  let minDistance = Infinity;
  let closestSegmentIdx = 0;
  let closestParam = 0;

  for (let i = 0; i < polylinePoints.length - 1; i++) {
    const ptA = polylinePoints[i];
    const ptB = polylinePoints[i + 1];
    const latA = Array.isArray(ptA) ? ptA[0] : ptA.lat;
    const lngA = Array.isArray(ptA) ? ptA[1] : ptA.lng;
    const latB = Array.isArray(ptB) ? ptB[0] : ptB.lat;
    const lngB = Array.isArray(ptB) ? ptB[1] : ptB.lng;

    // Calculate parameter to project point
    const x = current.lng;
    const y = current.lat;
    const x1 = lngA;
    const y1 = latA;
    const x2 = lngB;
    const y2 = latB;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = 0;

    if (lenSq !== 0) {
      param = Math.max(0, Math.min(1, dot / lenSq));
    }

    const xx = x1 + param * C;
    const yy = y1 + param * D;

    const dist = getHaversineDistance(y, x, yy, xx);
    if (dist < minDistance) {
      minDistance = dist;
      closestSegmentIdx = i;
      closestParam = param;
    }
  }

  // 3. Calculate distance traveled along the polyline up to the projection point
  let traveledDistance = 0;
  for (let i = 0; i < closestSegmentIdx; i++) {
    traveledDistance += segmentLengths[i];
  }
  traveledDistance += closestParam * segmentLengths[closestSegmentIdx];

  // 4. Interpolate remaining time proportional to remaining distance
  const progressRatio = traveledDistance / totalLength;
  const remainingTime = totalDuration * (1 - Math.min(1, Math.max(0, progressRatio)));

  return Math.round(remainingTime);
}

module.exports = {
  getHaversineDistance,
  getRouteDeviation,
  isAtStop,
  getInterpolatedRemainingTime
};
