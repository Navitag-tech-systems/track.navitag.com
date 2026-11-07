// Geofence geometry helpers. Points are [lat, lng] — the order Traccar's WKT
// is stored in and the order fetchGeofences parses (see devices.js).

// Bounding box of a polygon, used to skip the full test for positions nowhere
// near it.
export function polygonBounds(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

// Ray casting. `bounds` is optional (polygonBounds result).
export function pointInPolygon(lat, lng, points, bounds = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!Array.isArray(points) || points.length < 3) return false;
  if (bounds && (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng)) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [latI, lngI] = points[i];
    const [latJ, lngJ] = points[j];
    if ((lngI > lng) !== (lngJ > lng)
        && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI) {
      inside = !inside;
    }
  }
  return inside;
}
