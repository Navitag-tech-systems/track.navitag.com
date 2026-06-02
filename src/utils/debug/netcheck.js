// On-device connectivity diagnostics for the iOS WKAppBoundDomains question:
// why map tiles don't load, and whether an all-WILDCARD WKAppBoundDomains
// (*.navitag.net, *.navitag.com, *.tile.openstreetmap.org, *.locationiq.com)
// actually covers every host (REST + sockets + tiles) on-device.
//
// Run from the eruda console:  window.netcheck()
// Also auto-runs once ~4s after launch when built with VITE_DEBUG_CONSOLE=true.
// (Best signal: log in, open the map, THEN run window.netcheck() so the active
// Traccar server is known.)
//
// WHY EACH HOST IS PROBED ON TWO LAYERS
// CapacitorHttp (enabled in capacitor.config.json) monkeypatches window.fetch
// and XMLHttpRequest to route through NATIVE URLSession. Native traffic is
// IMMUNE to WKAppBoundDomains. The only requests that actually traverse the
// WKWebView — and could therefore be gated by app-bound domains — are
// <img> loads (Leaflet tiles) and WebSocket connections (Traccar + posbroker
// live positions). So each host is tested on both layers and compared:
//
//   tile: native fetch OK  + webview <img> FAIL  -> WEBVIEW-level block
//                                                   (app-bound domains / CSP)
//   tile: native fetch FAIL + webview <img> FAIL -> server/key (e.g. 403) or DNS
//   tile: both OK                                -> reachable; bug is rendering
//
//   posbroker WS connects -> the *.navitag.com WILDCARD entry covers it
//     (posbroker.navitag.com is a *.navitag.com host) -> confirms the
//     wildcard WKAppBoundDomains actually works for webview sockets on-device.

import { CapacitorHttp, Capacitor } from '@capacitor/core';
import { baseUrl, liqKey } from '@/utils/variables';
import { useUserStore } from '@/stores/user';

const TIMEOUT_MS = 8000;

// Native reach: ANY HTTP response (even 401/404) means the host was reached.
// A thrown error (or timeout) means the native layer could not connect.
async function nativeReach(url) {
  try {
    const res = await Promise.race([
      CapacitorHttp.request({ url, method: 'GET' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    return { ok: true, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e?.message || String(e) };
  }
}

// Webview reach via <img>. onload = the WKWebView loaded the resource;
// onerror = blocked/failed at the webview layer. This is the EXACT path
// Leaflet uses for tiles (no crossOrigin set, matching the package).
function imgReach(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = img.onerror = null;
      resolve({ ok: false, detail: 'timeout' });
    }, TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve({ ok: true, detail: `loaded ${img.naturalWidth}px` }); };
    img.onerror = () => { clearTimeout(timer); resolve({ ok: false, detail: 'img onerror (webview blocked/failed)' }); };
    img.src = url;
  });
}

// Webview reach via WebSocket. onopen firing = the WKWebView was ALLOWED to
// establish the connection (not blocked by app-bound domains), even if the
// server then closes it for missing auth. A close/error WITHOUT a prior open
// = could not connect (blocked or network).
function wsReach(wsUrl, protocols) {
  return new Promise((resolve) => {
    let opened = false, settled = false, ws;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws && ws.close(); } catch { /* ignore */ }
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ ok: opened, detail: opened ? 'opened (held)' : 'timeout (never opened)' }),
      TIMEOUT_MS,
    );
    try {
      ws = protocols ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);
    } catch (e) {
      return finish({ ok: false, detail: 'ctor threw: ' + (e?.message || e) });
    }
    ws.onopen = () => { opened = true; finish({ ok: true, detail: 'handshake opened' }); };
    ws.onerror = () => { if (!opened) finish({ ok: false, detail: 'ws error before open (blocked/failed)' }); };
    ws.onclose = (e) => { if (!opened) finish({ ok: false, detail: `closed before open (code ${e.code})` }); };
  });
}

export async function runNetCheck() {
  const userStore = useUserStore();
  const serverUrl = userStore?.server_url || null;
  const platform = Capacitor.getPlatform();

  // Low-zoom tiles that always exist, so a miss means "blocked", not "404".
  const osmTile = 'https://a.tile.openstreetmap.org/3/4/3.png';
  const liqTile = `https://a-tiles.locationiq.com/v3/streets/r/3/4/3.png?key=${liqKey}`;

  console.log(
    `%c[netcheck] platform=${platform} server=${serverUrl ?? '(none yet — log in & open map)'}`,
    'color:#1E88E5;font-weight:bold',
  );

  const results = {};

  // Tiles — native vs webview (answers the tile-loading question)
  results['osm tile (native fetch)'] = await nativeReach(osmTile);
  results['osm tile (webview img)']  = await imgReach(osmTile);
  results['liq tile (native fetch)'] = await nativeReach(liqTile);
  results['liq tile (webview img)']  = await imgReach(liqTile);

  // api.navitag.net — native only (no webview usage; immune to app-bound)
  results['api.navitag.net (native)'] = await nativeReach(baseUrl);

  // Traccar active tserver — LISTED in WKAppBoundDomains
  if (serverUrl) {
    results['tserver (native)']     = await nativeReach(`https://${serverUrl}/api/server`);
    results['tserver WS (webview)'] = await wsReach(`wss://${serverUrl}/api/socket`);
  } else {
    results['tserver (native/WS)'] = { ok: false, detail: 'no active server — log in, open map, run window.netcheck()' };
  }

  // posbroker — a *.navitag.com host; verifies the *.navitag.com wildcard
  results['posbroker WS (webview)'] = await wsReach('wss://posbroker.navitag.com', ['mqtt']);

  const rows = Object.entries(results).map(([test, r]) => ({
    test, result: r.ok ? '✅ OK' : '❌ FAIL', detail: r.detail,
  }));
  if (console.table) console.table(rows);
  else rows.forEach((r) => console.log(`${r.result}  ${r.test} — ${r.detail}`));

  // Plain-language interpretation
  const liqImg = results['liq tile (webview img)']?.ok;
  const liqFetch = results['liq tile (native fetch)']?.ok;
  const posbroker = results['posbroker WS (webview)']?.ok;
  console.log('%c[netcheck] interpretation:', 'color:#1E88E5;font-weight:bold');
  if (liqFetch && !liqImg) {
    console.log('• Tiles: native OK but webview <img> blocked -> WEBVIEW-level block (app-bound domains / CSP).');
  } else if (!liqFetch && !liqImg) {
    console.log('• Tiles: both layers fail -> server/key (e.g. 403) or DNS, NOT app-bound.');
  } else if (liqImg) {
    console.log('• Tiles: webview <img> loads -> tiles reachable; problem is rendering, not network.');
  }
  console.log(
    posbroker
      ? '• posbroker WS connected -> the *.navitag.com wildcard covers it; the wildcard WKAppBoundDomains works for webview sockets.'
      : '• posbroker WS did NOT connect -> the *.navitag.com wildcard did not cover it (wildcard invalid, or sockets blocked).',
  );

  return results;
}

export default runNetCheck;
