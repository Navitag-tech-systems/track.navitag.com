// Dashcam (Yuwei V5-C / "navicam") helpers.
//
// Everything that talks to a device goes through the stock Traccar API on the
// user's own server (`server_url` + the JSESSIONID the app already holds):
//
//   POST /api/commands/send   {deviceId, type, attributes}
//   GET  /api/stream/{deviceId}/{channel}/live.m3u8   (HLS, appears ~5-15 s
//                                                     after videoStart — 404 until then)
//   GET  /api/positions?deviceId&from&to              (the 9205 clip list lands
//                                                     as a POSITION with
//                                                     attributes.mediaList)
//
// JT/T 808 / 1078 message ids used here: 9205 query resource list, 9201
// remote playback, 9202 playback control, 8300 text message (hub WiFi apply).
// The builders are pure so they can be unit-tested without a device.
import { request } from '@/utils/http';

// Where the hub-sync job uploads clips. A HEAD on the derived URL tells the
// player whether a clip has been synced yet (404 = not yet).
export const DASHCAM_MEDIA_BASE = 'https://broker.navitag.com/dashcam';

// Sub-stream bitrate hint shown in the UI. Live streams are forced to the
// sub-stream (streamType 1) — the modem is LTE Cat-1 and the 1080p main
// stream does not fit.
export const SUB_STREAM_KBPS = 300;

export const DEFAULT_CHANNELS = [
  { index: 1, name: 'Front' },
  { index: 2, name: 'Cabin' },
];

// Traccar jt1078 media receiver the device is told to push playback to (9201).
export const JT1078_HOST = 'tserver1.navitag.com';
export const JT1078_PORT = 5263;

// Hub WiFi auth codes for the *#396* text command. Keys are the values the
// DashcamConfig security <select> emits.
export const WIFI_AUTH = Object.freeze({
  open: 0,
  'wpa2-psk': 1,
  wpa3: 2,
});

export const UPLOAD_POLICIES = Object.freeze([
  { value: 'all', label: 'All recordings', hint: 'Uses cellular data: about 350 MB per 15 min of front-camera video.' },
  { value: 'events', label: 'Events only', hint: 'Only alarm-flagged clips (collision, harsh braking) are uploaded.' },
  { value: 'none', label: 'No upload to cloud', hint: 'Clips stay on the dashcam. Still viewable live and over the hub LAN.' },
]);

// --- device metadata ---------------------------------------------------

export function isDashcam(device) {
  if (!device) return false;
  return device.protocol === 'jt808' || device.attributes?.videoChannels != null;
}

// `attributes.videoChannels` is stored as a JSON string on the Traccar device
// (attributes are flat scalars); tolerate an already-parsed array too.
export function videoChannels(device) {
  const raw = device?.attributes?.videoChannels;
  if (raw == null) return DEFAULT_CHANNELS;
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return DEFAULT_CHANNELS; }
  }
  if (!Array.isArray(list)) return DEFAULT_CHANNELS;
  const cleaned = list
    .map((c) => ({ index: Number(c?.index), name: String(c?.name ?? `Channel ${c?.index}`) }))
    .filter((c) => Number.isInteger(c.index) && c.index > 0);
  return cleaned.length ? cleaned : DEFAULT_CHANNELS;
}

// --- hex / BCD helpers ---------------------------------------------------

const p2 = (n) => String(n).padStart(2, '0');

export function hex1(n) {
  return (Number(n) & 0xff).toString(16).padStart(2, '0');
}

export function hex2(n) {
  return (Number(n) & 0xffff).toString(16).padStart(4, '0');
}

export function utf8Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// JT/T 808 BCD[6] timestamp: "YYMMDDhhmmss", device-local wall clock. The
// dashcam keeps local time, so a JS Date's LOCAL fields are the right source
// (the app and the device are in the same zone in practice).
export function bcd6(date) {
  if (date == null) return '000000000000';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '000000000000';
  return (
    p2(d.getFullYear() % 100) +
    p2(d.getMonth() + 1) +
    p2(d.getDate()) +
    p2(d.getHours()) +
    p2(d.getMinutes()) +
    p2(d.getSeconds())
  );
}

// --- JT/T 1078 message bodies ---------------------------------------------

// 0x9205 query resource list:
//   ch(1) + start BCD6 + end BCD6 + alarm flags(8, all zero = any) +
//   mediaType(1: 0 any) + streamType(1: 0 any) + storageType(1: 0 any)
// 24 bytes (48 hex), spec-strict — this exact shape was verified against the
// real V5-C on 2026-08-22.
export function body9205(ch, start, end) {
  return hex1(ch) + bcd6(start) + bcd6(end) + '00'.repeat(8) + '00' + '00' + '00';
}

// 0x9201 remote playback request:
//   ipLen(1) + ip(ascii) + tcpPort(2) + udpPort(2) + ch(1) + mediaType(1) +
//   streamType(1) + storageType(1) + playbackMode(1) + speed(1) + start BCD6 + end BCD6
export function body9201({
  ip = JT1078_HOST,
  tcpPort = JT1078_PORT,
  udpPort = 0,
  ch,
  mediaType = 0,
  streamType = 1,
  storageType = 0,
  playbackMode = 0,
  speed = 0,
  start,
  end,
}) {
  const ipHex = utf8Hex(ip);
  return (
    hex1(ipHex.length / 2) + ipHex +
    hex2(tcpPort) + hex2(udpPort) +
    hex1(ch) + hex1(mediaType) + hex1(streamType) + hex1(storageType) +
    hex1(playbackMode) + hex1(speed) +
    bcd6(start) + bcd6(end)
  );
}

// 0x9202 playback control: ch(1) + ctrl(1: 0 play, 1 pause, 2 stop, 3 fast
// fwd, 4 key-frame rewind, 5 drag) + fastSpeed(1) + start BCD6 (zeros unless
// dragging).
export function body9202(ch, ctrl = 2, fastSpeed = 0, start = null) {
  return hex1(ch) + hex1(ctrl) + hex1(fastSpeed) + (start ? bcd6(start) : '000000000000');
}

// 0x8300 text message: flag(1) + text. Flag 0x01 = "emergency" bit, which is
// what the vendor's config channel keys on.
export function body8300(text, flag = 0x01) {
  return hex1(flag) + utf8Hex(text);
}

// Vendor config string for the hub WiFi. Field order per the Yuwei *#396*
// syntax: 11 = WiFi STA, 1 = enable, ssid, password, auth, 1, 1.
export function hubWifiText({ ssid, password, security = 'wpa2-psk' }) {
  const auth = WIFI_AUTH[security] ?? WIFI_AUTH['wpa2-psk'];
  return `*#396*11*1*${ssid}*${password ?? ''}*${auth}*1*1#`;
}

export function validateHubWifi({ ssid, password, security = 'wpa2-psk' }) {
  const errors = {};
  const s = String(ssid ?? '');
  if (s.length < 1 || s.length > 32) errors.ssid = 'SSID must be 1–32 characters.';
  if (s.includes('*') || s.includes('#')) errors.ssid = 'SSID cannot contain * or #.';
  if (security !== 'open') {
    const p = String(password ?? '');
    if (p.length < 8 || p.length > 63) errors.password = 'Password must be 8–63 characters.';
    else if (p.includes('*') || p.includes('#')) errors.password = 'Password cannot contain * or #.';
  }
  return errors;
}

// --- command payloads ------------------------------------------------------

export function customCommand(msgId, bodyHex) {
  return { type: 'custom', attributes: { data: `${msgId}:${bodyHex}` } };
}

export function videoStartCommand(ch) {
  return { type: 'videoStart', attributes: { index: Number(ch), streamType: 1 } };
}

export function videoStopCommand(ch) {
  return { type: 'videoStop', attributes: { index: Number(ch) } };
}

export function hlsUrl(server, deviceId, ch) {
  return `https://${server}/api/stream/${deviceId}/${ch}/live.m3u8`;
}

// --- transport -------------------------------------------------------------

// `payload` is {type, attributes}; deviceId is the Traccar device id.
export function sendCommand(server, deviceId, payload) {
  return request.send({
    url: `https://${server}/api/commands/send`,
    method: 'POST',
    data: { deviceId: Number(deviceId), ...payload },
    isTraccar: true,
  });
}

// Single seam for pushing the hub WiFi to the device.
//
// TRANSPORT UNVERIFIED on the device over 0x8300 — the *#396* string is the
// vendor's config syntax and it is known to work over the Ytool LAN API; it
// has not been confirmed that the firmware honours it when delivered as a
// JT/T 808 text message. The backend may switch this to SMS. Keep every
// caller going through here so that swap is one edit.
export function applyHubWifi(server, deviceId, { ssid, password, security }) {
  const text = hubWifiText({ ssid, password, security });
  return sendCommand(server, deviceId, customCommand('8300', body8300(text)));
}

// Persist the non-secret dashcam settings on the Traccar device object. The
// WiFi password is deliberately NOT part of this — Traccar attributes are
// plain JSON readable by every user the device is shared with.
export async function saveDashcamSettings(server, device, settings) {
  const payload = {
    id: device.id,
    uniqueId: device.uniqueId,
    name: device.name,
    disabled: device.disabled,
    groupId: device.groupId,
    phone: device.phone,
    model: device.model,
    contact: device.contact,
    category: device.category,
    attributes: {
      ...(device.attributes || {}),
      dashcam: {
        hubSsid: settings.hubSsid ?? '',
        hubSecurity: settings.hubSecurity ?? 'wpa2-psk',
        uploadPolicy: settings.uploadPolicy ?? 'events',
        uploadNetwork: settings.uploadNetwork ?? 'wifi-only',
        updatedAt: new Date().toISOString(),
      },
    },
  };
  return request.send({
    url: `https://${server}/api/devices/${device.id}`,
    method: 'PUT',
    data: payload,
    isTraccar: true,
  });
}

export function readDashcamSettings(device) {
  const raw = device?.attributes?.dashcam;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  return {
    hubSsid: obj?.hubSsid ?? '',
    hubSecurity: obj?.hubSecurity ?? 'wpa2-psk',
    uploadPolicy: obj?.uploadPolicy ?? 'events',
    uploadNetwork: obj?.uploadNetwork ?? 'wifi-only',
    updatedAt: obj?.updatedAt ?? null,
  };
}

// Poll the HLS manifest until the server answers 2xx. Resolves true when the
// stream is up, throws on timeout or abort. `probe`/`sleep` are injectable
// for tests; the default probe goes through request.send so the native path
// carries the Traccar cookie.
export async function waitForHls(url, timeoutMs = 45000, {
  intervalMs = 2000,
  probe = defaultProbe,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  signal = null,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw new Error('aborted');
    if (await probe(url)) return true;
    if (Date.now() + intervalMs > deadline) {
      throw new Error(`Stream did not start within ${Math.round(timeoutMs / 1000)} s`);
    }
    await sleep(intervalMs);
  }
}

async function defaultProbe(url) {
  try {
    await request.send({ url, isTraccar: true, raw: true });
    return true;
  } catch (err) {
    // 404 = not up yet; anything else is also "not yet" until the deadline.
    if (err?.status && err.status !== 404) console.warn('[dashcam] HLS probe', err.status);
    return false;
  }
}

// --- clip list -------------------------------------------------------------

// "2026-08-22 01:33:25" (device-local) -> Date in the app's local zone.
export function parseClipTime(str) {
  if (str instanceof Date) return str;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(str ?? '').trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export function parseMediaList(raw) {
  if (raw == null) return [];
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((c, i) => {
      const start = parseClipTime(c.start);
      const end = parseClipTime(c.end);
      if (!start || !end) return null;
      return {
        id: `${c.ch}-${c.start}-${c.end}`,
        ch: Number(c.ch),
        start,
        end,
        startRaw: c.start,
        endRaw: c.end,
        alarm: Number(c.alarm ?? 0),
        media: Number(c.media ?? 0),
        stream: Number(c.stream ?? 0),
        storage: Number(c.storage ?? 0),
        size: Number(c.size ?? 0),
        seq: i,
      };
    })
    .filter(Boolean);
}

// Pick the newest mediaList position at or after `sinceMs` (null = any).
export function pickMediaList(positions, sinceMs = null) {
  if (!Array.isArray(positions)) return null;
  let best = null;
  for (const pos of positions) {
    const raw = pos?.attributes?.mediaList;
    if (raw == null) continue;
    const t = new Date(pos.serverTime || pos.deviceTime || pos.fixTime).getTime();
    if (sinceMs != null && Number.isFinite(t) && t < sinceMs) continue;
    if (!best || t > best.t) best = { t, pos };
  }
  if (!best) return null;
  return {
    serial: best.pos.attributes.mediaSerial ?? null,
    count: Number(best.pos.attributes.mediaCount ?? 0),
    clips: parseMediaList(best.pos.attributes.mediaList),
    receivedMs: best.t,
    positionId: best.pos.id,
  };
}

// Fetch positions since `since` (Date|ms) and return the newest mediaList, or
// null. `fetcher` is injectable for tests.
export async function findMediaList(server, deviceId, since, fetcher = defaultPositionsFetcher) {
  const sinceMs = since instanceof Date ? since.getTime() : Number(since);
  const from = new Date(sinceMs).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const positions = await fetcher(server, deviceId, from, to);
  return pickMediaList(positions, sinceMs);
}

function defaultPositionsFetcher(server, deviceId, from, to) {
  return request.send({
    url: `https://${server}/api/positions`,
    params: { deviceId: Number(deviceId), from, to },
    isTraccar: true,
  });
}

// --- clip presentation -------------------------------------------------------

export function clipDurationSec(clip) {
  return Math.max(0, Math.round((clip.end.getTime() - clip.start.getTime()) / 1000));
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${p2(m % 60)}:${p2(s % 60)}`;
  return `${m}:${p2(s % 60)}`;
}

export function formatMB(bytes) {
  const n = Number(bytes) || 0;
  const mb = n / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export function dayKey(date) {
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

// [{ day: 'YYYY-MM-DD', clips: [...] }] newest day first, clips newest first.
export function groupByDay(clips) {
  const map = new Map();
  for (const c of clips) {
    const k = dayKey(c.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({ day, clips: list.sort((a, b) => b.start - a.start) }));
}

// Compact timestamp used in the synced-clip filename: YYYYMMDDhhmmss.
export function compactTime(date) {
  return (
    date.getFullYear() +
    p2(date.getMonth() + 1) +
    p2(date.getDate()) +
    p2(date.getHours()) +
    p2(date.getMinutes()) +
    p2(date.getSeconds())
  );
}

// https://<media-host>/dashcam/<uniqueId>/<ch>/<start>_<end>.mp4
export function clipUrl(uniqueId, clip, base = DASHCAM_MEDIA_BASE) {
  return `${base}/${uniqueId}/${clip.ch}/${compactTime(clip.start)}_${compactTime(clip.end)}.mp4`;
}

// HEAD the synced-clip URL. true = synced, false = 404 / unreachable.
export async function clipIsSynced(url, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

// Rough data-usage estimate for the sub-stream at a given elapsed time.
export function estimateDataMB(elapsedSec, kbps = SUB_STREAM_KBPS) {
  return (elapsedSec * kbps) / 8 / 1024;
}
