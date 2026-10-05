import { describe, it, expect } from 'vitest';
import {
  positionAt, liveRouteTime, trailBefore, nearestTime, normaliseManifest,
  fmtDuration, groupClipsByDay,
} from './dashcamDemo.js';

const PTS = [
  [0, 14.0, 121.0, 0, 0],
  [1, 14.001, 121.0, 10, 0],
  [2, 14.002, 121.001, 20, 90],
  [3, 14.002, 121.002, 30, 90],
];

describe('positionAt', () => {
  it('returns the first point at or before t=0', () => {
    expect(positionAt(PTS, 0)).toMatchObject({ lat: 14.0, lng: 121.0 });
    expect(positionAt(PTS, -5)).toMatchObject({ lat: 14.0 });
  });
  it('interpolates between samples', () => {
    const p = positionAt(PTS, 1.5);
    expect(p.lat).toBeCloseTo(14.0015, 6);
    expect(p.lng).toBeCloseTo(121.0005, 6);
    expect(p.speed).toBeCloseTo(15, 6);
    expect(p.course).toBeCloseTo(45, 6);
  });
  it('clamps past the end', () => {
    expect(positionAt(PTS, 99)).toMatchObject({ lat: 14.002, lng: 121.002 });
  });
  it('takes the short way round for course', () => {
    const p = positionAt([[0, 0, 0, 0, 350], [1, 0, 0, 0, 10]], 0.5);
    expect(p.course).toBeCloseTo(0, 6);
  });
  it('handles empty input', () => {
    expect(positionAt([], 1)).toBeNull();
  });
});

describe('liveRouteTime', () => {
  it('wraps the wall clock over the route duration', () => {
    expect(liveRouteTime({ duration: 100 }, 250_000)).toBe(50);
    expect(liveRouteTime({ duration: 0 }, 250_000)).toBe(0);
  });
});

describe('trailBefore', () => {
  it('includes the window and the interpolated head', () => {
    const t = trailBefore(PTS, 2.5, 1.2);
    expect(t[0]).toEqual([14.002, 121.001]);
    expect(t[t.length - 1][1]).toBeCloseTo(121.0015, 6);
  });
  it('wraps on a loop', () => {
    const t = trailBefore(PTS, 0.5, 1, true);
    expect(t[0]).toEqual([14.002, 121.002]);
  });
});

describe('nearestTime', () => {
  it('finds the closest sample', () => {
    expect(nearestTime(PTS, 14.0021, 121.0019)).toBe(3);
  });
});

describe('normaliseManifest', () => {
  it('sorts channels and clips, rejects junk', () => {
    const m = normaliseManifest({
      channels: [{ index: 2, name: 'Cabin' }, { index: 1, name: 'Front' }, { index: 'x' }],
      clips: [{ id: 'a', start: '2026-10-04T08:00:00+08:00', videos: {} }, { id: 'b', start: '2026-10-05T08:00:00+08:00', videos: {} }],
      live: { videos: { 1: 'live/ch1.mp4' } },
    });
    expect(m.channels.map((c) => c.index)).toEqual([1, 2]);
    expect(m.clips.map((c) => c.id)).toEqual(['b', 'a']);
    expect(m.live).not.toBeNull();
    expect(normaliseManifest({})).toBeNull();
  });
});

describe('formatting', () => {
  it('fmtDuration', () => {
    expect(fmtDuration(90)).toBe('1:30');
    expect(fmtDuration(5)).toBe('0:05');
  });
  it('groups clips by Manila day', () => {
    const g = groupClipsByDay([
      { id: 'a', start: '2026-10-05T07:55:00+08:00' },
      { id: 'b', start: '2026-10-04T17:40:00+08:00' },
      { id: 'c', start: '2026-10-04T08:12:00+08:00' },
    ]);
    expect(g.map((x) => x.key)).toEqual(['2026-10-05', '2026-10-04']);
    expect(g[1].clips.map((c) => c.id)).toEqual(['b', 'c']);
  });
});
