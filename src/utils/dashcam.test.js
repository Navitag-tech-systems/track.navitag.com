import { describe, it, expect, vi } from 'vitest';

// http.js pulls in Capacitor + ky; stub it so the pure helpers load in jsdom.
vi.mock('@/utils/http', () => ({ request: { send: vi.fn() } }));

import {
  bcd6, hex1, hex2, utf8Hex,
  body9205, body9201, body9202, body8300, hubWifiText, validateHubWifi,
  customCommand, videoStartCommand, videoStopCommand, hlsUrl,
  waitForHls, parseClipTime, parseMediaList, pickMediaList, findMediaList,
  groupByDay, clipUrl, formatMB, formatDuration, videoChannels, isDashcam,
  readDashcamSettings,
} from './dashcam.js';

const d = (y, mo, da, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, da, h, mi, s);

describe('hex/BCD', () => {
  it('bcd6 is device-local YYMMDDhhmmss', () => {
    expect(bcd6(d(2026, 8, 21))).toBe('260821000000');
    expect(bcd6(d(2026, 8, 23, 23, 59, 59))).toBe('260823235959');
    expect(bcd6(null)).toBe('000000000000');
    expect(bcd6('garbage')).toBe('000000000000');
  });
  it('hex1/hex2 pad and mask', () => {
    expect(hex1(1)).toBe('01');
    expect(hex1(255)).toBe('ff');
    expect(hex2(5263)).toBe('148f');
    expect(utf8Hex('A*')).toBe('412a');
  });
});

describe('9205 clip list', () => {
  it('matches the 24-byte body verified on the device', () => {
    const body = body9205(1, d(2026, 8, 21), d(2026, 8, 23, 23, 59, 59));
    expect(body).toBe('01260821000000260823235959' + '00'.repeat(8) + '000000');
    expect(body).toHaveLength(48);
  });
  it('wraps as a Traccar custom command', () => {
    const cmd = customCommand('9205', body9205(2, d(2026, 1, 1), d(2026, 1, 2)));
    expect(cmd.type).toBe('custom');
    expect(cmd.attributes.data.startsWith('9205:02260101000000260102000000')).toBe(true);
  });
});

describe('9201 / 9202 playback', () => {
  it('9201 lays out ip, ports, flags and the window', () => {
    const hex = body9201({ ip: 'a.b', tcpPort: 5263, ch: 1, start: d(2026, 8, 22, 1, 33, 25), end: d(2026, 8, 22, 1, 33, 49) });
    // ipLen=3, "a.b", tcp 148f, udp 0000, ch 01, av 00, sub 01, storage 00, mode 00, speed 00, start, end
    expect(hex).toBe('03' + '612e62' + '148f' + '0000' + '01' + '00' + '01' + '00' + '00' + '00' + '260822013325' + '260822013349');
  });
  it('9201 defaults to the tserver1 jt1078 receiver', () => {
    const hex = body9201({ ch: 2, start: d(2026, 1, 1), end: d(2026, 1, 1, 0, 1) });
    const ipLen = parseInt(hex.slice(0, 2), 16);
    expect(ipLen).toBe('tserver1.navitag.com'.length);
    expect(hex.slice(2 + ipLen * 2, 2 + ipLen * 2 + 4)).toBe('148f');
  });
  it('9202 stop is ch + 02 + 00 + zero BCD', () => {
    expect(body9202(1)).toBe('010200000000000000');
    expect(body9202(2, 0, 0, d(2026, 8, 22, 1, 33, 25))).toBe('020000260822013325');
  });
});

describe('8300 hub wifi', () => {
  it('builds the *#396* text with the auth code', () => {
    expect(hubWifiText({ ssid: 'Hub', password: 'secret123', security: 'wpa2-psk' }))
      .toBe('*#396*11*1*Hub*secret123*1*1*1#');
    expect(hubWifiText({ ssid: 'Hub', password: '', security: 'open' }))
      .toBe('*#396*11*1*Hub**0*1*1#');
    expect(hubWifiText({ ssid: 'Hub', password: 'x', security: 'wpa3' })).toContain('*2*1*1#');
  });
  it('body8300 = flag byte + utf-8 hex', () => {
    expect(body8300('*#')).toBe('01' + '2a23');
    expect(body8300('A', 0)).toBe('0041');
  });
  it('validates ssid and password lengths', () => {
    expect(validateHubWifi({ ssid: '', password: 'password1' }).ssid).toBeTruthy();
    expect(validateHubWifi({ ssid: 'x'.repeat(33), password: 'password1' }).ssid).toBeTruthy();
    expect(validateHubWifi({ ssid: 'ok', password: 'short' }).password).toBeTruthy();
    expect(validateHubWifi({ ssid: 'ok', password: 'short', security: 'open' })).toEqual({});
    expect(validateHubWifi({ ssid: 'ok', password: 'longenough' })).toEqual({});
  });
});

describe('live commands', () => {
  it('videoStart forces the sub-stream', () => {
    expect(videoStartCommand('2')).toEqual({ type: 'videoStart', attributes: { index: 2, streamType: 1 } });
    expect(videoStopCommand(1)).toEqual({ type: 'videoStop', attributes: { index: 1 } });
    expect(hlsUrl('tserver1.navitag.com', 203, 1)).toBe('https://tserver1.navitag.com/api/stream/203/1/live.m3u8');
  });
});

describe('waitForHls', () => {
  it('resolves once the probe succeeds', async () => {
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const sleep = vi.fn().mockResolvedValue();
    await expect(waitForHls('u', 10_000, { intervalMs: 1000, probe, sleep, minSegments: 1 })).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it('throws on timeout', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const sleep = vi.fn().mockResolvedValue();
    await expect(waitForHls('u', 100, { intervalMs: 1000, probe, sleep })).rejects.toThrow(/did not start/);
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('throws when aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(waitForHls('u', 1000, { probe: async () => false, signal: ctl.signal })).rejects.toThrow('aborted');
  });

  // Manifests as single-line strings: waitForHls only inspects them for a
  // segment token (#EXTINF / .ts) and body equality, so newlines are irrelevant.
  const M0 = '#EXTM3U #EXT-X-TARGETDURATION:2 (no segments yet)';
  const STALE = '#EXTM3U #EXT-X-MEDIA-SEQUENCE:42 #EXTINF:2.0, seg00042.ts';
  const FRESH1 = '#EXTM3U #EXT-X-MEDIA-SEQUENCE:0 #EXTINF:2.0, seg00000.ts';
  const FRESH2 = '#EXTM3U #EXT-X-MEDIA-SEQUENCE:0 #EXTINF:2.0, seg00000.ts #EXTINF:2.0, seg00001.ts';

  it('does NOT latch a stale manifest that never changes (times out)', async () => {
    const probe = vi.fn().mockResolvedValue(STALE);
    const sleep = vi.fn().mockResolvedValue();
    await expect(waitForHls('u', 100, { intervalMs: 1000, probe, sleep })).rejects.toThrow(/did not start/);
  });
  it('resolves after absent -> segmented (cold start)', async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce(null)      // dir cleared, no manifest yet
      .mockResolvedValueOnce(M0)        // manifest present but empty
      .mockResolvedValueOnce(FRESH1);   // first fresh segment
    const sleep = vi.fn().mockResolvedValue();
    await expect(waitForHls('u', 10_000, { intervalMs: 1000, probe, sleep, minSegments: 1 })).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
  });
  it('resolves when a stale playlist advances to a changed one (cross-session)', async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce(STALE)     // old session still up: baseline, do not latch
      .mockResolvedValueOnce(STALE)     // unchanged: still not ready
      .mockResolvedValueOnce(FRESH2);   // changed body -> this session is producing
    const sleep = vi.fn().mockResolvedValue();
    await expect(waitForHls('u', 10_000, { intervalMs: 1000, probe, sleep, minSegments: 1 })).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
  });
  it('requireFresh:false keeps the old "any segment" behavior', async () => {
    const probe = vi.fn().mockResolvedValue(STALE);
    const sleep = vi.fn().mockResolvedValue();
    await expect(waitForHls('u', 10_000, { intervalMs: 1000, probe, sleep, requireFresh: false })).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('waits for maturity: does not resolve until >= minSegments clean segments', async () => {
    // Burst then growth: absent -> 1 seg (burst) -> ... -> 4 segs. minSegments:4.
    const seg = (n) => '#EXTM3U #EXT-X-MEDIA-SEQUENCE:0 ' + Array.from({length:n},(_,i)=>'#EXTINF:2.0, seg'+i+'.ts').join(' ');
    const probe = vi.fn()
      .mockResolvedValueOnce(null)       // absent -> sawAbsent
      .mockResolvedValueOnce(seg(1))     // fresh but only 1 seg (burst) -> not ready
      .mockResolvedValueOnce(seg(2))     // still maturing
      .mockResolvedValueOnce(seg(3))     // still maturing
      .mockResolvedValueOnce(seg(4));    // >= minSegments -> ready
    const sleep = vi.fn().mockResolvedValue();
    await expect(waitForHls('u', 20_000, { intervalMs: 1000, probe, sleep, minSegments: 4 })).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(5);
  });
});

describe('media list', () => {
  const raw = JSON.stringify([
    { ch: 1, start: '2026-08-22 01:33:25', end: '2026-08-22 01:33:49', alarm: 0, media: 1, stream: 1, storage: 1, size: 9061825 },
    { ch: 2, start: '2026-08-21 23:00:00', end: '2026-08-21 23:05:00', alarm: 1, media: 1, stream: 1, storage: 1, size: 1048576 },
  ]);

  it('parses the JSON string into Dates', () => {
    const clips = parseMediaList(raw);
    expect(clips).toHaveLength(2);
    expect(clips[0].start).toEqual(d(2026, 8, 22, 1, 33, 25));
    expect(clips[0].size).toBe(9061825);
    expect(parseClipTime('nope')).toBeNull();
    expect(parseMediaList('{bad')).toEqual([]);
  });

  it('pickMediaList takes the newest position at/after since', () => {
    const positions = [
      { id: 1, serverTime: '2026-08-22T00:00:00.000+00:00', attributes: { mediaList: '[]', mediaSerial: 1, mediaCount: 0 } },
      { id: 2, serverTime: '2026-08-22T00:00:10.000+00:00', attributes: {} },
      { id: 3, serverTime: '2026-08-22T00:00:20.000+00:00', attributes: { mediaList: raw, mediaSerial: 2, mediaCount: 2 } },
    ];
    const r = pickMediaList(positions, null);
    expect(r.positionId).toBe(3);
    expect(r.count).toBe(2);
    expect(r.clips).toHaveLength(2);
    expect(pickMediaList(positions, Date.parse('2026-08-22T00:00:30.000Z'))).toBeNull();
    expect(pickMediaList(null)).toBeNull();
  });

  it('findMediaList passes an ISO window to the fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const since = Date.parse('2026-08-22T00:00:00.000Z');
    await findMediaList('srv', 203, since, fetcher);
    expect(fetcher).toHaveBeenCalledWith('srv', 203, '2026-08-22T00:00:00.000Z', expect.any(String));
  });

  it('groups by day, newest first', () => {
    const groups = groupByDay(parseMediaList(raw));
    expect(groups.map((g) => g.day)).toEqual(['2026-08-22', '2026-08-21']);
  });

  it('derives the synced-clip url', () => {
    const [clip] = parseMediaList(raw);
    expect(clipUrl('001318110808', clip, 'https://h/dashcam'))
      .toBe('https://h/dashcam/001318110808/1/20260822013325_20260822013349.mp4');
  });

  it('formats size and duration', () => {
    expect(formatMB(9061825)).toBe('8.6 MB');
    expect(formatDuration(24)).toBe('0:24');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('device metadata', () => {
  it('detects dashcams by protocol or channel metadata', () => {
    expect(isDashcam({ protocol: 'jt808' })).toBe(true);
    expect(isDashcam({ protocol: 'istartek', attributes: { videoChannels: '[]' } })).toBe(true);
    expect(isDashcam({ protocol: 'istartek', attributes: {} })).toBe(false);
    expect(isDashcam(null)).toBe(false);
  });
  it('reads channels from attributes, defaulting to front/cabin', () => {
    expect(videoChannels({})).toEqual([{ index: 1, name: 'Front' }, { index: 2, name: 'Cabin' }]);
    expect(videoChannels({ attributes: { videoChannels: '[{"index":3,"name":"Rear"}]' } }))
      .toEqual([{ index: 3, name: 'Rear' }]);
    expect(videoChannels({ attributes: { videoChannels: 'not json' } })).toHaveLength(2);
  });
  it('reads dashcam settings with defaults', () => {
    expect(readDashcamSettings({})).toMatchObject({ hubSsid: '', uploadPolicy: 'events', uploadNetwork: 'wifi-only' });
    expect(readDashcamSettings({ attributes: { dashcam: { hubSsid: 'Hub', uploadPolicy: 'all' } } }))
      .toMatchObject({ hubSsid: 'Hub', uploadPolicy: 'all' });
    expect(readDashcamSettings({ attributes: { dashcam: '{"uploadPolicy":"none"}' } }).uploadPolicy).toBe('none');
  });
});
