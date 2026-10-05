// Dashcam demo media — simulated live (RTS) + history playback from pre-built
// files, with a GPS route sampled once per second alongside each video.
//
// Built and served by scripts/medusa/dashcam-demo (medusa):
//   {DEMO_BASE}/{uniqueId}/manifest.json
//   {DEMO_BASE}/{uniqueId}/live/ch<N>.mp4 + live/route.json
//   {DEMO_BASE}/{uniqueId}/clips/<id>/ch<N>.mp4 + route.json
//
// Route file: { duration, distanceKm, points: [[t, lat, lng, speedKmh, course], ...] }
// with t = 0, 1, 2 … seconds, so for a clip video time t IS the route index.
// The live route is a closed loop driven on the wall clock, independent of the
// (looping) live video.
//
// A device with no manifest (404) is not in the demo; the viewer then falls
// back to the real Live / Clips / Settings tabs.

export const DEMO_BASE = (import.meta.env.VITE_DASHCAM_DEMO_BASE || '').replace(/\/+$/, '');

export function demoEnabled() {
  return DEMO_BASE !== '';
}

export function mediaUrl(uniqueId, path) {
  if (!path) return '';
  return `${DEMO_BASE}/${encodeURIComponent(uniqueId)}/${path}`;
}

const manifestCache = new Map();

// Resolves to the manifest, or null when this device has no demo media.
export async function loadManifest(uniqueId, { fetchImpl = fetch } = {}) {
  if (!demoEnabled() || !uniqueId) return null;
  if (manifestCache.has(uniqueId)) return manifestCache.get(uniqueId);
  const p = (async () => {
    try {
      const res = await fetchImpl(mediaUrl(uniqueId, 'manifest.json'), { cache: 'no-cache' });
      if (!res.ok) return null;
      return normaliseManifest(await res.json());
    } catch {
      return null;
    }
  })();
  manifestCache.set(uniqueId, p);
  const m = await p;
  if (!m) manifestCache.delete(uniqueId); // retry next time
  return m;
}

export function normaliseManifest(m) {
  if (!m || !Array.isArray(m.channels)) return null;
  const channels = m.channels
    .map((c) => ({ index: Number(c.index), name: String(c.name ?? `CH${c.index}`), poster: c.poster || null }))
    .filter((c) => Number.isInteger(c.index) && c.index > 0)
    .sort((a, b) => a.index - b.index);
  const clips = (Array.isArray(m.clips) ? m.clips : [])
    .filter((c) => c && c.id && c.videos)
    .slice()
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
  return { ...m, channels, clips, live: m.live && m.live.videos ? m.live : null };
}

const routeCache = new Map();

export async function loadRoute(uniqueId, path, { fetchImpl = fetch } = {}) {
  const url = mediaUrl(uniqueId, path);
  if (routeCache.has(url)) return routeCache.get(url);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`route ${res.status}`);
  const r = await res.json();
  const route = { duration: Number(r.duration) || 0, distanceKm: Number(r.distanceKm) || 0, points: r.points || [] };
  routeCache.set(url, route);
  return route;
}

// --- route math --------------------------------------------------------------

function lerpAngle(a, b, f) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

// Interpolated position at time t (seconds). Clamped to the route's ends.
export function positionAt(points, t) {
  if (!points || points.length === 0) return null;
  const last = points.length - 1;
  if (!(t > 0)) return toPos(points[0]);
  if (t >= points[last][0]) return toPos(points[last]);
  // points are 1 s apart from t = 0, so the index is floor(t); guard anyway.
  let i = Math.min(Math.floor(t), last - 1);
  while (i > 0 && points[i][0] > t) i--;
  while (i < last - 1 && points[i + 1][0] <= t) i++;
  const a = points[i];
  const b = points[i + 1];
  const span = b[0] - a[0] || 1;
  const f = (t - a[0]) / span;
  return {
    t,
    lat: a[1] + (b[1] - a[1]) * f,
    lng: a[2] + (b[2] - a[2]) * f,
    speed: a[3] + (b[3] - a[3]) * f,
    course: lerpAngle(a[4], b[4], f),
  };
}

function toPos(p) {
  return { t: p[0], lat: p[1], lng: p[2], speed: p[3], course: p[4] };
}

// Live: where the vehicle is "now" on its loop. Anchored to the epoch so every
// viewer — and a revisit — sees the same continuous drive.
export function liveRouteTime(route, nowMs = Date.now()) {
  const d = route?.duration || route?.points?.length - 1 || 0;
  if (!(d > 0)) return 0;
  return (nowMs / 1000) % d;
}

// The last `seconds` of the drive up to t, wrapping around the loop.
export function trailBefore(points, t, seconds, loop = false) {
  if (!points?.length) return [];
  const out = [];
  const from = t - seconds;
  for (const p of points) {
    if (p[0] >= Math.max(0, from) && p[0] <= t) out.push([p[1], p[2]]);
  }
  if (loop && from < 0) {
    const d = points[points.length - 1][0];
    const wrapped = points.filter((p) => p[0] >= d + from).map((p) => [p[1], p[2]]);
    out.unshift(...wrapped);
  }
  const here = positionAt(points, t);
  if (here) out.push([here.lat, here.lng]);
  return out;
}

// Nearest route time to a clicked lat/lng (for click-to-seek on the track).
export function nearestTime(points, lat, lng) {
  let best = null;
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const p of points || []) {
    const dy = p[1] - lat;
    const dx = (p[2] - lng) * k;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p[0];
    }
  }
  return best;
}

// --- formatting ----------------------------------------------------------------

const PH_TZ = 'Asia/Manila';

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtClock(date) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: PH_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

export function fmtDay(date) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: PH_TZ, weekday: 'short', month: 'short', day: 'numeric',
  }).format(date);
}

export function dayKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PH_TZ }).format(date); // YYYY-MM-DD
}

// Clips grouped by PH calendar day, newest day first.
export function groupClipsByDay(clips) {
  const groups = new Map();
  for (const c of clips || []) {
    const d = new Date(c.start);
    const key = dayKey(d);
    if (!groups.has(key)) groups.set(key, { key, label: fmtDay(d), clips: [] });
    groups.get(key).clips.push(c);
  }
  return [...groups.values()];
}
