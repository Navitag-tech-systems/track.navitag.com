import { describe, it, expect } from 'vitest';
import { hasRealCoords } from './gps.js';
import VT100MapProcessor from './reportProcessor.js';
import { toTrack } from './dashcamPlayback.js';

// Device-in-Africa (2026-11-19): the Tenet DCAM009 reports no-fix positions at
// 0,0 and at near-zero junk such as 0.008068 with valid=false.
describe('hasRealCoords', () => {
  it('rejects 0,0, -0 and the near-zero junk box; accepts real places', () => {
    expect(hasRealCoords(0, 0)).toBe(false);
    expect(hasRealCoords(-0, -0)).toBe(false);
    expect(hasRealCoords(0.008068, 0.003)).toBe(false);
    expect(hasRealCoords(null, 121)).toBe(false);
    expect(hasRealCoords(NaN, 121)).toBe(false);
    expect(hasRealCoords(14.681934, 121.03043)).toBe(true);
    expect(hasRealCoords(0.5, 32.6)).toBe(true);     // Kampala-ish: on the equator, far from 0 lon
    expect(hasRealCoords(-33.9, 18.4)).toBe(true);
  });
});

describe('history route skips no-fix coordinates', () => {
  const pt = (id, min, lat, lon, extra = {}) => ({
    id, protocol: 'jt808', latitude: lat, longitude: lon, course: 0, speed: 0, valid: lat !== 0,
    fixTime: new Date(Date.UTC(2026, 10, 19, 7, min)).toISOString(), attributes: {}, ...extra,
  });

  it('carries the last real coordinates over junk points and drops leading junk', () => {
    const p = new VT100MapProcessor();
    const { line } = p.generateMapData([
      pt(1, 0, 0, 0),                          // before any fix: dropped
      pt(2, 1, 14.68, 121.03),
      pt(3, 2, 0.008068, 0.003),               // junk: takes [14.68,121.03]
      pt(4, 3, -0, -0),
      pt(5, 4, 14.70, 121.05),
    ]);
    expect(line).toEqual([[14.68, 121.03], [14.68, 121.03], [14.68, 121.03], [14.70, 121.05]]);
    expect(line.every(([la, lo]) => hasRealCoords(la, lo))).toBe(true);
  });

  it('an all-junk day yields an empty route', () => {
    const p = new VT100MapProcessor();
    expect(p.generateMapData([pt(1, 0, 0, 0), pt(2, 1, 0.01, 0.02)]).line).toEqual([]);
  });
});

describe('dashcam playback track', () => {
  it('drops near-zero junk as well as 0,0', () => {
    const at = (min, lat, lon) => ({ fixTime: new Date(Date.UTC(2026, 10, 19, 7, min)).toISOString(), latitude: lat, longitude: lon, speed: 0 });
    const t = toTrack([at(0, 14.68, 121.03), at(1, 0.008068, 0.003), at(2, 0, 0)]);
    expect(t.map((x) => [x.lat, x.lng])).toEqual([[14.68, 121.03]]);
  });
});
