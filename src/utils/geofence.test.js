import { describe, it, expect } from 'vitest';
import { pointInPolygon, polygonBounds } from './geofence.js';

// Square around (14.60, 121.00), [lat, lng] order.
const square = [[14.59, 120.99], [14.59, 121.01], [14.61, 121.01], [14.61, 120.99], [14.59, 120.99]];

describe('pointInPolygon', () => {
  it('detects a point inside', () => {
    expect(pointInPolygon(14.60, 121.00, square)).toBe(true);
  });
  it('rejects a point outside', () => {
    expect(pointInPolygon(14.62, 121.00, square)).toBe(false);
  });
  it('does not swap lat and lng', () => {
    // (121.00, 14.60) would only pass if the order were reversed.
    expect(pointInPolygon(121.00, 14.60, square)).toBe(false);
  });
  it('honours the bounding box shortcut', () => {
    const b = polygonBounds(square);
    expect(pointInPolygon(14.60, 121.00, square, b)).toBe(true);
    expect(pointInPolygon(15.00, 121.00, square, b)).toBe(false);
  });
  it('handles a concave polygon', () => {
    // U shape: notch between lng 120.995 and 121.005 above lat 14.595.
    const u = [[14.59, 120.99], [14.59, 121.01], [14.61, 121.01], [14.61, 121.005],
      [14.595, 121.005], [14.595, 120.995], [14.61, 120.995], [14.61, 120.99]];
    expect(pointInPolygon(14.60, 121.00, u)).toBe(false);
    expect(pointInPolygon(14.60, 120.992, u)).toBe(true);
  });
  it('returns false for bad input', () => {
    expect(pointInPolygon(undefined, 121, square)).toBe(false);
    expect(pointInPolygon(14.6, 121, [])).toBe(false);
  });
});
