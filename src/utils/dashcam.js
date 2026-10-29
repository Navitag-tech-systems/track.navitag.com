// Dashcam (Yuwei V5-C "VISION-360" and V5N, up to 4 channels) helpers.
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

// Hub-sync store (medusa dashcam-sync behind mcp.navitag.com/sync). Its
// /lookup route resolves <uniqueId>/<ch>/<device start digits> to the synced
// copy of a clip; a HEAD tells the player whether it exists (404 = not yet).
export const DASHCAM_MEDIA_BASE = 'https://mcp.navitag.com/sync/lookup';

// Sub-stream bitrate hint shown in the UI, per channel. Live streams are
// forced to the sub-stream (streamType 1) — the modem is LTE Cat-1 and the
// 1080p main stream does not fit.
export const SUB_STREAM_KBPS = 300;

// A live session stops itself this long after Start, so a page left open does
// not stream from the customer's SIM indefinitely. Tap Start to continue.
export const LIVE_SESSION_LIMIT_S = 5 * 60;

// JT/T 1078 logical channels this app drives. Both supported units expose at
// most 4 camera inputs (V5N: maxch 4).
export const MAX_CHANNELS = 4;

export const DEFAULT_CHANNELS = [
  { index: 1, name: 'Front' },
  { index: 2, name: 'Cabin' },
];

// Channel layout by Traccar device model, used when the device carries no
// `videoChannels` attribute. VISION-360 is the V5-C.
const MODEL_CHANNELS = [
  { match: /v5n/i, channels: [
    { index: 1, name: 'Front' },
    { index: 2, name: 'Cabin' },
    { index: 3, name: 'Camera 3' },
    { index: 4, name: 'Camera 4' },
  ] },
  { match: /v5-?c|vision-?360/i, channels: DEFAULT_CHANNELS },
];

// Clock zone the dashcam's BCD timestamps are written in. Traccar's jt808
// decoder reads the same per-device `decoder.timezone` attribute and falls back
// to GMT+8 (the JT/T 808 convention), so this mirrors it exactly. Yuwei units
// keep UTC: set `decoder.timezone` = "UTC" on the device when provisioning.
export const DEFAULT_DEVICE_TZ = 'GMT+8';

// Traccar jt1078 media receiver the device is told to push playback to (9201).
export const JT1078_HOST = 'tserver1.navitag.com';
export const JT1078_PORT = 5263;
// Traccar's /api/stream playlist is a sliding window of at most 5 segments
// (3 s each), so waitForHls's default minSegments (6, sized for the medusa live
// burst) can never be met and every playback timed out at 45 s. Measured
// 2026-10-26: 2 segments at 2.5 s, 4 at 4.7 s, then a steady 5.
export const PLAYBACK_MIN_SEGMENTS = 3;

// LIVE goes through the medusa ffmpeg re-mux, NOT Traccar's native HLS: Traccar's
// live segments have a cross-segment DTS discontinuity that MSE rejects
// ("CHUNK_DEMUXER_ERROR_APPEND_FAILED: Parsed buffers not in DTS sequence"), so
// live never played in-browser. The device is told (0x9101) to push JT1078 to
// this receiver; ffmpeg regenerates clean, continuous timestamps and serves HLS.
// The receiver keys every stream on the SIM number + channel in the JT/T 1078
// frame header, so any number of devices and channels can stream at once.
// (Recorded playback via 0x9201 stays on Traccar — it's already continuous.)
export const LIVE_MEDIA_IP = '159.65.135.101';        // medusa public IP (device dials over cellular)
export const LIVE_MEDIA_PORT = 7801;
export const LIVE_HLS_BASE = 'https://mcp.navitag.com/live';

// 0x9101 live AV request: ipLen(1)+ip+tcpPort(2)+udpPort(2)+ch(1)+dataType(1)+streamType(1)
export function body9101({ ip = LIVE_MEDIA_IP, tcpPort = LIVE_MEDIA_PORT, udpPort = 0, ch, dataType = 0, streamType = 1 }) {
  const ipHex = utf8Hex(ip);
  return hex1(ipHex.length / 2) + ipHex + hex2(tcpPort) + hex2(udpPort) + hex1(ch) + hex1(dataType) + hex1(streamType);
}

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

function modelChannels(device) {
  const model = String(device?.model ?? '');
  return MODEL_CHANNELS.find((m) => m.match.test(model))?.channels ?? DEFAULT_CHANNELS;
}

// `attributes.videoChannels` is stored as a JSON string on the Traccar device
// (attributes are flat scalars); tolerate an already-parsed array too. Without
// it the layout comes from the device model. At most MAX_CHANNELS, ordered.
export function videoChannels(device) {
  const fallback = modelChannels(device);
  const raw = device?.attributes?.videoChannels;
  if (raw == null) return fallback;
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return fallback; }
  }
  if (!Array.isArray(list)) return fallback;
  const seen = new Set();
  const cleaned = list
    .map((c) => ({ index: Number(c?.index), name: String(c?.name ?? `Camera ${c?.index}`) }))
    .filter((c) => Number.isInteger(c.index) && c.index > 0 && c.index <= MAX_CHANNELS && !seen.has(c.index) && seen.add(c.index))
    .sort((a, b) => a.index - b.index);
  return cleaned.length ? cleaned : fallback;
}

// The JT/T 1078 SIM field is BCD[6]: the terminal phone number, which is the
// Traccar uniqueId (V5-C 001318110808, V5N 991318145911), zero-padded to 12.
export function terminalSim(device) {
  const digits = String(device?.uniqueId ?? '').replace(/\D/g, '');
  return digits.padStart(12, '0').slice(-12);
}

export function liveHlsUrl(device, ch) {
  return `${LIVE_HLS_BASE}/${terminalSim(device)}/${Number(ch)}/stream.m3u8`;
}

// --- device clock ----------------------------------------------------------

export function deviceTimeZone(device) {
  const tz = device?.attributes?.['decoder.timezone'];
  return typeof tz === 'string' && tz.trim() ? tz.trim() : DEFAULT_DEVICE_TZ;
}

// Minutes the zone is ahead of UTC at `date`. Accepts what Java's
// TimeZone.getTimeZone accepts in practice: "UTC", "GMT", "GMT+8",
// "UTC-05:30", or an IANA name. Unknown names fall back to UTC, as Java does.
export function tzOffsetMinutes(tz, date = new Date()) {
  const s = String(tz ?? '').trim();
  if (!s || /^(utc|gmt|z)$/i.test(s)) return 0;
  const m = /^(?:utc|gmt)\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(s);
  if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: s, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date);
    const v = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
    const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

// Wall-clock fields of `date` in zone `tz` (null = the app's local zone).
function wallClock(date, tz) {
  if (tz == null) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
  }
  const w = new Date(date.getTime() + tzOffsetMinutes(tz, date) * 60000);
  return [w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds()];
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

// JT/T 808 BCD[6] timestamp: "YYMMDDhhmmss" on the DEVICE's wall clock. `tz`
// is the device clock zone (deviceTimeZone); null keeps the app's local zone.
export function bcd6(date, tz = null) {
  if (date == null) return '000000000000';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '000000000000';
  const [y, mo, da, h, mi, s] = wallClock(d, tz);
  return p2(y % 100) + p2(mo) + p2(da) + p2(h) + p2(mi) + p2(s);
}

// --- JT/T 1078 message bodies ---------------------------------------------

// 0x9205 query resource list:
//   ch(1) + start BCD6 + end BCD6 + alarm flags(8, all zero = any) +
//   mediaType(1: 0 any) + streamType(1: 0 any) + storageType(1: 0 any)
// 24 bytes (48 hex), spec-strict — this exact shape was verified against the
// real V5-C on 2026-08-22.
export function body9205(ch, start, end, tz = null) {
  return hex1(ch) + bcd6(start, tz) + bcd6(end, tz) + '00'.repeat(8) + '00' + '00' + '00';
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
  tz = null,
}) {
  const ipHex = utf8Hex(ip);
  return (
    hex1(ipHex.length / 2) + ipHex +
    hex2(tcpPort) + hex2(udpPort) +
    hex1(ch) + hex1(mediaType) + hex1(streamType) + hex1(storageType) +
    hex1(playbackMode) + hex1(speed) +
    bcd6(start, tz) + bcd6(end, tz)
  );
}

// 0x9202 playback control: ch(1) + ctrl(1: 0 play, 1 pause, 2 stop, 3 fast
// fwd, 4 key-frame rewind, 5 drag) + fastSpeed(1) + start BCD6 (zeros unless
// dragging).
export function body9202(ch, ctrl = 2, fastSpeed = 0, start = null, tz = null) {
  return hex1(ch) + hex1(ctrl) + hex1(fastSpeed) + (start ? bcd6(start, tz) : '000000000000');
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

// Live via the medusa re-mux path (custom 0x9101 -> LIVE_MEDIA_IP:LIVE_MEDIA_PORT).
export function liveStartCommand(ch) {
  return customCommand('9101', body9101({ ch: Number(ch) }));
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
  requireFresh = true,
  minSegments = 6,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  // Readiness needs TWO things, not just "a manifest with a segment exists":
  //
  // 1. FRESHNESS. Every start() makes the medusa re-mux clear its HLS dir and
  //    restart ffmpeg from media-sequence 0, so a stale manifest from the prior
  //    session can still be on disk when we begin polling. Latching it hands
  //    hls.js segments the restarting ffmpeg is about to delete (native code 4).
  //    We only trust a manifest seen ABSENT/empty then segmented, or changed from
  //    the first segmented body - both only happen for the new session.
  //
  // 2. MATURITY. The device dumps a buffered BURST when the video conn opens, so
  //    the first one or two segments are irregular (short/odd EXTINF). hls.js
  //    starts a LIVE stream near the edge (edge minus liveSyncDurationCount); if
  //    we hand it the playlist while those burst segments are still the newest
  //    content, it fatals on them and LiveStream stops the whole session. Waiting
  //    for >= minSegments clean segments pushes the edge-anchored start past the
  //    burst. A mature stream (verified) plays this exact hls.js config flawlessly.
  let baseline = null;      // first manifest BODY that already listed a segment
  let sawAbsent = false;    // observed no manifest / empty playlist since polling began
  let sawFresh = false;     // established the manifest belongs to THIS session
  const segCount = (m) => (m.match(/#EXTINF/g) || []).length;
  while (true) {
    if (signal?.aborted) throw new Error('aborted');
    const r = await probe(url);
    if (typeof r !== 'string') {
      // Back-compat: a boolean-returning probe (injected in tests) resolves as before.
      if (r) return true;
      sawAbsent = true;
    } else {
      const n = segCount(r);
      if (n === 0) {
        sawAbsent = true;                         // manifest present but empty = not up yet
      } else if (!requireFresh) {
        return true;
      } else {
        if (!sawFresh) {
          if (sawAbsent) sawFresh = true;         // absent -> segmented: definitely this session
          else if (baseline === null) baseline = r; // first segmented body: could be stale, don't latch
          else if (r !== baseline) sawFresh = true; // playlist advanced: a live session is producing
        }
        if (sawFresh && n >= minSegments) return true;
      }
    }
    if (Date.now() + intervalMs > deadline) {
      throw new Error(`Stream did not start within ${Math.round(timeoutMs / 1000)} s`);
    }
    await sleep(intervalMs);
  }
}

async function defaultProbe(url) {
  try {
    // Return the manifest BODY (or null) so waitForHls can judge freshness, not
    // just presence - medusa answers the manifest immediately, sometimes with a
    // stale or empty playlist, and hls.js fatals on those.
    // medusa answers `Access-Control-Allow-Origin: *`, which the browser rejects
    // for a credentialed request - so live manifests go without cookies. Traccar
    // playback (/api/stream) still needs the session cookie.
    const medusa = url.startsWith(LIVE_HLS_BASE);
    const text = await request.send({ url, isTraccar: !medusa, simple: medusa, raw: true });
    return typeof text === 'string' ? text : null;
  } catch (err) {
    // 404 = not up yet; anything else is also "not yet" until the deadline.
    if (err?.status && err.status !== 404) console.warn('[dashcam] HLS probe', err.status);
    return null;
  }
}

// --- clip list -------------------------------------------------------------

// "2026-08-22 01:33:25" on the device clock -> the instant it names. `tz` is
// the device clock zone; null reads it in the app's local zone.
export function parseClipTime(str, tz = null) {
  if (str instanceof Date) return str;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(str ?? '').trim());
  if (!m) return null;
  if (tz == null) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  // Offset at (approximately) that instant; exact for fixed-offset zones.
  return new Date(asUtc - tzOffsetMinutes(tz, new Date(asUtc)) * 60000);
}

export function parseMediaList(raw, tz = null) {
  if (raw == null) return [];
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((c, i) => {
      const start = parseClipTime(c.start, tz);
      const end = parseClipTime(c.end, tz);
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

// Pick the newest mediaList position RECEIVED at or after `sinceMs` (null = any).
export function pickMediaList(positions, sinceMs = null, tz = null) {
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
    clips: parseMediaList(best.pos.attributes.mediaList, tz),
    receivedMs: best.t,
    positionId: best.pos.id,
  };
}

// /api/positions filters on fixTime, and Traccar stamps the 0x1205 answer with
// the device's LAST fix time — minutes old when parked (ACC-off reports every
// 300 s), or skewed if the clock zone is misconfigured. Query a generous window
// back and judge freshness by serverTime in pickMediaList instead.
export const MEDIA_LIST_LOOKBACK_MS = 30 * 60_000;

// Fetch positions around `since` (Date|ms) and return the newest mediaList
// received since then, or null. `fetcher` is injectable for tests.
export async function findMediaList(server, deviceId, since, fetcher = defaultPositionsFetcher, tz = null) {
  const sinceMs = since instanceof Date ? since.getTime() : Number(since);
  const from = new Date(sinceMs - MEDIA_LIST_LOOKBACK_MS).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const positions = await fetcher(server, deviceId, from, to);
  return pickMediaList(positions, sinceMs, tz);
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

// <base>/<uniqueId>/<ch>/<YYYYMMDDhhmmss>.mp4 — the start is the device's own
// wall-clock digits (the 0x1205 string), which is exactly what the device puts
// in the name of the file it uploads, whatever zone its clock is in.
export function clipUrl(uniqueId, clip, base = DASHCAM_MEDIA_BASE) {
  const raw = String(clip.startRaw ?? '').replace(/\D/g, '');
  const start = raw.length === 14 ? raw : compactTime(clip.start);
  return `${base}/${uniqueId}/${clip.ch}/${start}.mp4`;
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

// Rough data-usage estimate for `streams` sub-streams at a given elapsed time.
export function estimateDataMB(elapsedSec, kbps = SUB_STREAM_KBPS, streams = 1) {
  return (elapsedSec * kbps * streams) / 8 / 1024;
}
