// Business join links: track.navitag.com/join/<code>.
//
// The code survives the trip through signup/login (and an SSO redirect) in
// localStorage, and is claimed by the session start right after /user/sync —
// before the device fetch, so the business's vehicles are in the very first
// list. The server keeps a member in step with the owner's fleet afterwards
// (POST /share/tome syncs), so nothing here is needed after the claim.
//
// Claiming is idempotent server-side: an existing member just re-syncs.
import { ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { request } from '@/utils/http';
import { baseUrl } from '@/utils/variables';

const PENDING_KEY = 'join_pending_code';
// The pending code is dropped after this long, so a link opened weeks ago does
// not silently join the next account that signs in on a shared phone.
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

// Result of the latest claim in this tab: { business_name, device_count,
// granted, already_member } | null. Read by the install page banner; kept in
// sessionStorage so it survives the reload that follows an in-session claim.
const LAST_KEY = 'join_last_result';
// One-shot: the next session start after a claim lands on the install guide.
const ROUTE_ONCE_KEY = 'join_route_once';
export const lastJoin = ref(readLast());

function readLast() {
  try { return JSON.parse(sessionStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
}

export function normalizeCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return /^[A-Z0-9]{6,16}$/.test(code) ? code : '';
}

// businessName is kept for the "Joining <business>" banner on /login and /signup.
export function setPendingJoin(code, businessName = '') {
  const c = normalizeCode(code);
  if (!c) return;
  try {
    const prev = getPendingJoinInfo();
    const name = businessName || (prev?.code === c ? prev.business_name : '');
    localStorage.setItem(PENDING_KEY, JSON.stringify({ code: c, business_name: name, at: Date.now() }));
  } catch {}
}

// { code, business_name } | null
export function getPendingJoinInfo() {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (!v?.code || Date.now() - (v.at || 0) > PENDING_TTL_MS) return null;
    const code = normalizeCode(v.code);
    return code ? { code, business_name: String(v.business_name || '') } : null;
  } catch {
    return null;
  }
}

export function getPendingJoin() {
  return getPendingJoinInfo()?.code || '';
}

// Which screen a signed-out visitor is sent to: the URL's ?start= when valid,
// else the link's own `landing` setting, else login.
export const LANDINGS = ['login', 'signup'];
export function resolveLanding(queryStart, linkLanding) {
  const q = String(queryStart || '').toLowerCase();
  if (LANDINGS.includes(q)) return q;
  return LANDINGS.includes(linkLanding) ? linkLanding : 'login';
}

export function clearPendingJoin() {
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}

// Public: business name + device count. Throws an Error with .status
// (404 unknown/revoked, 410 expired/full — body.state says which).
export function lookupJoin(code) {
  return request.send({ url: `${baseUrl}/join/${encodeURIComponent(code)}`, simple: true });
}

export async function claimJoin(code, token) {
  const res = await request.send({
    url: `${baseUrl}/join/claim`,
    method: 'POST',
    data: { code },
    token,
  });
  lastJoin.value = res;
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify(res));
    sessionStorage.setItem(ROUTE_ONCE_KEY, '1');
  } catch {}
  return res;
}

// Session-start hook. Never throws: a failed claim must not fail the session.
// The pending code is kept only for failures worth retrying on the next start
// (network, 5xx, 409 account-not-ready).
export async function claimPendingJoin(token) {
  const code = getPendingJoin();
  if (!code || !token) return null;
  try {
    const res = await claimJoin(code, token);
    clearPendingJoin();
    return res;
  } catch (err) {
    const s = err?.status;
    if (s && s >= 400 && s < 500 && s !== 409) clearPendingJoin();
    console.warn('[Join] claim failed:', s, err?.message);
    return null;
  }
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Where to land after a session start: once, the install guide after a join
// in a browser tab that is not the installed app; the map otherwise.
export function routeAfterSession() {
  let once = false;
  try {
    once = sessionStorage.getItem(ROUTE_ONCE_KEY) === '1';
    sessionStorage.removeItem(ROUTE_ONCE_KEY);
  } catch {}
  if (once && !Capacitor.isNativePlatform() && !isStandalone()) {
    return '/install?joined=1';
  }
  return '/';
}
