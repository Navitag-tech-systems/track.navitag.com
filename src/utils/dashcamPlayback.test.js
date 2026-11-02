import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/http', () => ({ request: { send: vi.fn() } }));

import {
  HOUR_MS, MIN_MS, dayStart, hourStart, hoursOfDay, saneClips, mergeClips, mergeRanges,
  videoRanges, inRanges, nextVideoStart, alarmMarks, toTrack, fixAt, trackPoints, drivingByHour,
  candidatesAt, downloadCandidates, sliceAround, parseRecIndex, loadListCache, saveListCache,
  isChecked, clipsFromPositions, playbackCommand, SYNC_SLICE_BASE, pickListAnswer, listEntries,
  listCommand, echoKey, fmtHour12, fmtHourRange12,
  sliceBefore, DOWNLOAD_MINUTES, subtractRanges, planDownload, coveredMs,
} from './dashcamPlayback.js';
import { parseMediaList, LIVE_HLS_BASE, DASHCAM_MEDIA_BASE } from './dashcam.js';

const at = (h, m = 0, s = 0) => new Date(2026, 10, 2, h, m, s).getTime();
const rawClip = (ch, start, end, extra = {}) => ({ ch, start, end, alarm: 0, size: 1000, ...extra });
// Device clock = app clock here (tz null) so the strings read as local time.
const clips = (...items) => parseMediaList(items, null);

describe('calendar', () => {
  it('hour and day starts are local', () => {
    expect(hourStart(at(18, 3, 27))).toBe(at(18));
    expect(dayStart(at(18, 3, 27))).toBe(at(0));
  });
  it('12-hour labels for the hour selector', () => {
    expect(fmtHour12(at(0))).toBe('12 AM');
    expect(fmtHour12(at(9))).toBe('9 AM');
    expect(fmtHour12(at(12))).toBe('12 PM');
    expect(fmtHourRange12(at(9), at(10))).toBe('9 – 10 AM');
    expect(fmtHourRange12(at(11), at(12))).toBe('11 AM – 12 PM');
    expect(fmtHourRange12(at(23), at(23) + HOUR_MS)).toBe('11 PM – 12 AM');
  });
  it('a day has 24 local hours', () => {
    const hours = hoursOfDay(at(0));
    expect(hours).toHaveLength(24);
    expect(hours[18]).toBe(at(18));
  });
});

describe('clip list', () => {
  it('drops decoder garbage', () => {
    const list = clips(
      rawClip(1, '2026-11-02 18:00:00', '2026-11-02 18:40:12'),
      rawClip(17, '2001-08-00 00:26:11', '2001-09-00 00:00:00'),
      rawClip(16, '2026-10-01 00:00:00', '2026-10-31 00:00:00'),
      rawClip(2, '2026-11-02 18:10:00', '2026-11-02 18:00:00'),
    );
    const ok = saneClips(list, at(20));
    expect(ok.map((c) => c.ch)).toEqual([1]);
  });
  it('merges lists by id', () => {
    const a = clips(rawClip(1, '2026-11-02 18:00:00', '2026-11-02 19:00:00'));
    const b = clips(rawClip(1, '2026-11-02 18:00:00', '2026-11-02 19:00:00'), rawClip(2, '2026-11-02 17:00:00', '2026-11-02 18:00:00'));
    expect(mergeClips(a, b).map((c) => c.ch)).toEqual([2, 1]);
  });
  it('reads every 0x1205 answer in a positions response', () => {
    const pos = [
      { attributes: {} },
      { attributes: { mediaList: JSON.stringify([rawClip(1, '2026-11-02 07:00:00', '2026-11-02 08:00:00')]) } },
      { attributes: { mediaList: [rawClip(2, '2026-11-02 12:00:00', '2026-11-02 12:30:00')] } },
    ];
    expect(clipsFromPositions(pos, null).map((c) => c.ch)).toEqual([1, 2]);
  });
});

describe('ranges', () => {
  it('merges overlapping and touching ranges', () => {
    const s = 1000;
    expect(mergeRanges([{ start: 10 * s, end: 20 * s }, { start: 0, end: 5 * s }, { start: 19 * s, end: 30 * s }, { start: 30.5 * s, end: 31 * s }]))
      .toEqual([{ start: 0, end: 5 * s }, { start: 10 * s, end: 31 * s }]);
  });
  it('video ranges are the union of the clip list and the cache, clipped to the window', () => {
    const list = clips(rawClip(1, '2026-11-02 17:52:00', '2026-11-02 18:10:00'), rawClip(2, '2026-11-02 18:00:00', '2026-11-02 18:30:00'));
    const cache = { 1: [{ start: at(18, 5), end: at(18, 20) }, { start: at(18, 30), end: at(18, 31) }] };
    const r = videoRanges({ clips: list, cache, ch: 1, from: at(18), to: at(19) });
    expect(r).toEqual([{ start: at(18), end: at(18, 20) }, { start: at(18, 30), end: at(18, 31) }]);
    expect(inRanges(r, at(18, 15))).toBe(true);
    expect(inRanges(r, at(18, 25))).toBe(false);
    expect(nextVideoStart(r, at(18, 25))).toBe(at(18, 30));
    expect(nextVideoStart(r, at(18, 45))).toBeNull();
  });
  it('alarm marks only for the camera and window', () => {
    const list = clips(
      rawClip(1, '2026-11-02 18:05:00', '2026-11-02 18:06:00', { alarm: 4 }),
      rawClip(2, '2026-11-02 18:05:00', '2026-11-02 18:06:00', { alarm: 4 }),
      rawClip(1, '2026-11-02 18:20:00', '2026-11-02 18:21:00'),
    );
    expect(alarmMarks(list, 1, at(18), at(19))).toEqual([at(18, 5)]);
  });
});

describe('GPS', () => {
  const pos = (h, m, s, lat, lng, knots = 0, extra = {}) => ({
    fixTime: new Date(at(h, m, s)).toISOString(), latitude: lat, longitude: lng, speed: knots, course: 90, attributes: {}, ...extra,
  });
  it('converts knots, sorts, drops duplicate fixes and 0,0', () => {
    const t = toTrack([pos(18, 1, 0, 14.1, 120.1, 10), pos(18, 0, 0, 14.0, 120.0, 0), pos(18, 1, 0, 14.1, 120.1, 10), pos(18, 2, 0, 0, 0)]);
    expect(t).toHaveLength(2);
    expect(t[0].t).toBe(at(18));
    expect(t[1].kmh).toBeCloseTo(18.52);
    expect(t[1].moving).toBe(true);
  });
  it('interpolates between fixes and refuses long gaps', () => {
    const t = toTrack([pos(18, 0, 0, 14.0, 120.0), pos(18, 0, 10, 14.1, 120.2), pos(19, 0, 0, 15, 121)]);
    const f = fixAt(t, at(18, 0, 5));
    expect(f.lat).toBeCloseTo(14.05);
    expect(f.lng).toBeCloseTo(120.1);
    expect(fixAt(t, at(18, 30))).toBeNull();
    expect(fixAt(t, at(17, 59))).toBeNull();
  });
  it('trackPoints are 1 Hz seconds since the window start', () => {
    const t = toTrack([pos(18, 0, 0, 14.0, 120.0), pos(18, 0, 10, 14.1, 120.2)]);
    const p = trackPoints(t, at(18), at(19));
    expect(p).toHaveLength(11);
    expect(p[0][0]).toBe(0);
    expect(p[10][0]).toBe(10);
  });
  it('counts moving minutes per hour', () => {
    const t = toTrack([pos(7, 31, 0, 14, 120, 20), pos(7, 31, 30, 14, 120.01, 20), pos(7, 32, 0, 14, 120.02, 20), pos(12, 0, 0, 14, 120, 0)]);
    const h = drivingByHour(t, at(0));
    expect(h[7].minutes).toBe(2);
    expect(h[12].minutes).toBe(0);
  });
});

describe('sources', () => {
  const list = clips(rawClip(1, '2026-11-02 18:00:00', '2026-11-02 18:40:12'));
  it('best first: hub, then cache, then the camera', () => {
    const cache = { 1: [{ start: at(18), end: at(18, 10), url: `${LIVE_HLS_BASE}/rec/x/1/1/vod.m3u8`, active: false }] };
    const c = candidatesAt({ t: at(18, 3), ch: 1, clips: list, cache, uniqueId: '991318145911' });
    expect(c.map((x) => x.kind)).toEqual(['hub', 'cache', 'remote']);
    expect(c[0].url).toBe(`${DASHCAM_MEDIA_BASE}/991318145911/1/20261102180000.mp4`);
    expect(c[0].base).toBe(at(18));
    expect(c[1].base).toBe(at(18));
    expect(c[2].base).toBe(at(18, 3));
    expect(c[2].end).toBe(at(18, 40, 12));
  });
  it('cache alone when the list does not know the time', () => {
    const cache = { 1: [{ start: at(18, 45), end: at(18, 50), url: 'u' }] };
    expect(candidatesAt({ t: at(18, 46), ch: 1, clips: list, cache, uniqueId: 'x' }).map((x) => x.kind)).toEqual(['cache']);
    expect(candidatesAt({ t: at(18, 55), ch: 1, clips: list, cache, uniqueId: 'x' })).toEqual([]);
  });
  it('downloads are server-cut slices', () => {
    const cache = { 1: [{ start: at(18), end: at(18, 10), url: 'u' }] };
    const d = downloadCandidates({ ch: 1, from: at(18, 1), to: at(18, 6), clips: list, cache, uniqueId: '991318145911', sim: '991318145911' });
    expect(d[0].kind).toBe('hub');
    expect(d[0].url).toBe(`${SYNC_SLICE_BASE}/991318145911/1/20261102180000?from=60.0&to=360.0`);
    expect(d[0].check).toBe(`${DASHCAM_MEDIA_BASE}/991318145911/1/20261102180000.mp4`);
    expect(d[1].url).toBe(`${LIVE_HLS_BASE}/_clip?sim=991318145911&ch=1&from=${at(18, 1)}&to=${at(18, 6)}`);
  });
  it('slices stay inside the window', () => {
    expect(sliceAround(at(18, 3), 5, at(18), at(19))).toEqual({ from: at(18, 0, 30), to: at(18, 5, 30) });
    expect(sliceAround(at(18, 1), 5, at(18), at(19))).toEqual({ from: at(18), to: at(18, 5) });
    expect(sliceAround(at(18, 59), 5, at(18), at(19))).toEqual({ from: at(18, 55), to: at(19) });
  });
  it('9201 goes to the medusa receiver on the device clock', () => {
    const cmd = playbackCommand({ attributes: { 'decoder.timezone': 'UTC' } }, 1, Date.UTC(2026, 10, 2, 10, 3, 0), Date.UTC(2026, 10, 2, 10, 40, 0));
    const hex = cmd.attributes.data;
    expect(hex.startsWith('9201:')).toBe(true);
    const ipHex = Buffer.from('159.65.135.101').toString('hex');
    expect(hex).toContain(ipHex + '1e790000');
    expect(hex.endsWith('261102100300261102104000')).toBe(true);
  });
});

describe('download planning', () => {
  const sim = '991318145295';
  const five = (ch, mm) => rawClip(ch, `2026-11-02 14:${String(mm).padStart(2, '0')}:00`, `2026-11-02 14:${String(mm + 5).padStart(2, '0')}:00`);
  const list = clips(five(1, 20), five(1, 25), five(1, 30), five(2, 25));
  it('the range ends at the playhead', () => {
    expect(sliceBefore(at(14, 30, 0, 400) + 400, 3)).toEqual({ from: at(14, 27), to: at(14, 30) });
    expect(DOWNLOAD_MINUTES).toEqual([1, 3, 5, 10]);
  });
  it('subtracts ranges', () => {
    expect(subtractRanges([{ start: 0, end: 10_000 }], [{ start: 2000, end: 4000 }, { start: 8000, end: 12_000 }]))
      .toEqual([{ start: 0, end: 2000 }, { start: 4000, end: 8000 }]);
  });
  it('one hub file that holds everything is used as is', () => {
    const p = planDownload({ ch: 1, from: at(14, 26), to: at(14, 29), clips: list, uniqueId: sim, sim, hubOk: () => true });
    expect(p.kind).toBe('hub');
    expect(p.url).toBe(`${SYNC_SLICE_BASE}/${sim}/1/20261102142500?from=60.0&to=240.0`);
  });
  it('fetches from the camera only what the cache lacks, one piece per file', () => {
    const cache = { 1: [{ start: at(14, 24), end: at(14, 26) }] };
    const p = planDownload({ ch: 1, from: at(14, 22), to: at(14, 32), clips: list, cache, uniqueId: sim, sim });
    expect(p.kind).toBe('cache');
    expect(p.pieces).toEqual([
      { start: at(14, 22), end: at(14, 24) },   // file 14:20
      { start: at(14, 26), end: at(14, 30) },   // file 14:25
      { start: at(14, 30), end: at(14, 32) },   // file 14:30
    ]);
    expect(p.url).toBe(`${LIVE_HLS_BASE}/_clip?sim=${sim}&ch=1&from=${at(14, 22)}&to=${at(14, 32)}`);
  });
  it('a hub file that does not hold everything falls back to the cache path', () => {
    const p = planDownload({ ch: 1, from: at(14, 22), to: at(14, 27), clips: list, uniqueId: sim, sim, hubOk: () => true });
    expect(p.kind).toBe('cache');
    expect(p.pieces).toHaveLength(2);
  });
  it('trims to where video exists, and nothing when there is none', () => {
    const p = planDownload({ ch: 2, from: at(14, 20), to: at(14, 40), clips: list, uniqueId: sim, sim });
    expect([p.from, p.to]).toEqual([at(14, 25), at(14, 30)]);
    expect(planDownload({ ch: 3, from: at(14, 20), to: at(14, 30), clips: list, uniqueId: sim, sim })).toEqual({ kind: 'none' });
  });
  it('fully cached needs nothing from the camera', () => {
    const cache = { 2: [{ start: at(14, 20), end: at(14, 40) }] };
    expect(planDownload({ ch: 2, from: at(14, 25), to: at(14, 30), clips: list, cache, uniqueId: sim, sim }).pieces).toEqual([]);
    expect(coveredMs(cache[2], at(14, 39), at(14, 41))).toBe(MIN_MS);
  });
});

describe('per-camera list answers', () => {
  const entry = (id, receivedMs, items, count = items.length) => ({ id, receivedMs, raw: JSON.stringify(items), count });
  const five = (ch, hh, mm) => rawClip(ch, `2026-11-01 ${hh}:${mm}:00`, `2026-11-01 ${hh}:${String(+mm + 5).padStart(2, '0')}:00`);
  it('takes the first answer since the request that is all for the asked camera', () => {
    const entries = [
      entry(1, 100, [five(2, '10', '00')]),                       // before the request
      // Real 5295 frame: sub-packet 2 decoded as a list (count 0x00020126).
      entry(2, 2000, [rawClip(17, '2001-08-00 00:26:11', '2001-09-00 00:00:00', { alarm: 1 })], 131366),
      entry(3, 2100, [five(1, '10', '00')]),                      // another camera's answer
      entry(4, 2200, [five(2, '10', '00'), five(2, '10', '05')]),
    ];
    const a = pickListAnswer(entries, 1000, 2, null);
    expect(a.id).toBe(4);
    expect(a.clips).toHaveLength(2);
    expect(a.clean).toBe(true);
  });
  it('an empty answer is a clean "nothing here"', () => {
    const a = pickListAnswer([entry(5, 2000, [])], 1000, 4, null);
    expect(a).toEqual({ id: 5, clips: [], clean: true });
  });
  it('a short or junk-carrying answer is not clean', () => {
    expect(pickListAnswer([entry(6, 2000, [five(1, '10', '00')], 36)], 1000, 1, null).clean).toBe(false);
  });
  it('skips used answers and the 0x9201 echo', () => {
    const echo = entry(7, 2000, [rawClip(1, '2026-11-01 07:00:00', '2026-11-01 08:00:00')]);
    const real = entry(8, 2500, [five(1, '07', '00')]);
    const echoes = new Set([echoKey(1, new Date(2026, 10, 1, 7, 0, 0).getTime(), new Date(2026, 10, 1, 8, 0, 0).getTime() + 400)]);
    expect(pickListAnswer([echo, real], 1000, 1, null, new Set(), echoes).id).toBe(8);
    expect(pickListAnswer([echo, real], 1000, 1, null, new Set([8]), echoes)).toBeNull();
  });
  it('listEntries reads positions in arrival order', () => {
    const e = listEntries([
      { id: 2, serverTime: '2026-11-02T16:07:33Z', attributes: { mediaList: '[]', mediaCount: 0 } },
      { id: 1, serverTime: '2026-11-02T16:05:55Z', attributes: { mediaList: '[]', mediaCount: 0 } },
      { id: 3, serverTime: '2026-11-02T16:08:00Z', attributes: {} },
    ]);
    expect(e.map((x) => x.id)).toEqual([1, 2]);
  });
  it('9205 asks one camera', () => {
    const hex = listCommand({ attributes: { 'decoder.timezone': 'UTC' } }, Date.UTC(2026, 10, 1, 7), Date.UTC(2026, 10, 1, 8), 3).attributes.data;
    expect(hex).toBe('9205:03261101070000261101080000' + '00'.repeat(11));
  });
});

describe('medusa cache index', () => {
  it('parses /_rec', () => {
    const r = parseRecIndex({ channels: { 1: [{ start_ms: 10, end_ms: 20, playlist: 'rec/a/1/5/vod.m3u8', active: true }, { start_ms: 5, end_ms: 5 }] } });
    expect(r).toEqual({ 1: [{ start: 10, end: 20, url: `${LIVE_HLS_BASE}/rec/a/1/5/vod.m3u8`, active: true }] });
  });
});

describe('list cache', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips clips and checked windows', () => {
    const list = clips(rawClip(1, '2026-11-02 18:00:00', '2026-11-02 18:40:12'));
    saveListCache(248, { checked: [[at(18), at(19), at(19, 1)]], clips: list }, at(20));
    const back = loadListCache(248, null, at(20));
    expect(back.clips).toHaveLength(1);
    expect(back.clips[0].start.getTime()).toBe(at(18));
    expect(back.clips[0].startRaw).toBe('2026-11-02 18:00:00');
    expect(isChecked(back.checked, at(18), at(19))).toBe(true);
    expect(isChecked(back.checked, at(17), at(18, 30))).toBe(false);
  });
  it('survives junk in storage', () => {
    localStorage.setItem('dashcam:lists:1', '{not json');
    expect(loadListCache(1, null)).toEqual({ checked: [], clips: [] });
  });
});

describe('constants', () => {
  it('minute and hour', () => {
    expect(HOUR_MS).toBe(60 * MIN_MS);
  });
});
