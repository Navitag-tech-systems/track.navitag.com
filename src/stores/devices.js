import { defineStore } from 'pinia';
import { ref, computed, reactive } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { useBootStore } from '@/stores/boot.js';
import { useRouter } from 'vue-router';
import { request } from '@/utils/http';
import { baseUrl, categoryMapping } from '@/utils/variables';
import { OWNER_SENTINEL } from '@/utils/scopes';

// Canonical plan_level is lowercase ('pro', 'basic'). Older API shapes shipped
// 'Pro' / 'Basic', so normalize to lowercase on ingestion — the stored value
// then matches the backend canonical form. Display capitalizes cosmetically
// via CSS (`capitalize` class) at render time, not in the data.
function normalizePlanLevel(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return value.toLowerCase();
}

// Online status is recency-gated. The Traccar WS and posbroker both replay the
// last-known device+position on (re)connect — posbroker even re-publishes it
// RETAINED — carrying status:"online" frozen on a stale timestamp. So a device
// counts as online only when the backend says online AND we've heard from it
// within this window; recency also lets a device that falls silent expire on
// its own (no offline message required — important for posbroker, which never
// emits one).
const ONLINE_FRESH_MS = 5 * 60 * 1000;
// Parse a Traccar timestamp (ISO string or epoch) to epoch ms ONCE, at
// ingestion, and cache it as device.lastSeenMs. The list re-renders on every
// socket message, so doing new Date(...) per render (×N cards × ~5 calls each)
// is thousands of string-parses/sec at fleet scale; comparing cached integers
// is effectively free.
function toMs(ts) {
  if (ts == null) return 0;
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  return Number.isFinite(t) ? t : 0;
}
function isFresh(lastSeenMs, now = Date.now()) {
  return lastSeenMs > 0 && (now - lastSeenMs) < ONLINE_FRESH_MS;
}

// How long to wait for the first socket frame after a successful fetch before
// giving up on it. `loading` is released by processSocketData, so without this
// a socket that connects but never speaks leaves the app on a permanent
// full-screen splash with no way out.
const LIVE_WATCHDOG_MS = 20000;

export const useDevicesStore = defineStore('devices', () => {
  const userStore = useUserStore();
  const boot = useBootStore();
  const router = useRouter();

  // --- State ---
  const devices = reactive({});
  const geofences = reactive({});
  const loading = ref(false);
  const error = ref(null);
  const deviceSelected = ref(null);
  const mapUpdate = ref(null);
  const draftPolygon = ref(null);
  const deviceMarkers = reactive({});
  const activeRoute = ref({ line: [], markers: {} });

  // True once fetchAll has completed at least once this session — including the
  // zero-device case, which is a real answer, not a pending one. Views use it to
  // tell "still loading" apart from "no such device"; those two states used to
  // share one message ("Device not found or loading..."), so a genuinely missing
  // device showed a loading string forever.
  const hasLoadedOnce = ref(false);

  // Devices shared TO this user by other accounts (from POST /share/tome).
  // Hydrated on every lifecycle entry in parallel with fetchDevices +
  // fetchGeofences. Each entry: { imei, scopes: ['position:live', ...] }.
  const sharedToMe = ref([]);

  // Plan entitlement, as measured by the backend and returned alongside
  // GET /device/list: { tier, geofence_limit, devices_total, devices_active, error }.
  //
  // null means NOT YET MEASURED — never "basic". The distinction is the whole
  // point: this used to be derived client-side from `plan_level` grafted onto
  // device objects by a second request, so any failure of that request silently
  // collapsed a pro user to the basic allowance of 2 and the session-start prune
  // then deleted their newest 8 geofences.
  //
  // Deliberately NOT reset on a failed refresh — the last measured value is a
  // better answer than "unknown", and clearData() clears it on logout.
  const entitlement = ref(null);

  // Ticking clock (60s) so the recency-gated online status re-evaluates even
  // when a device falls silent and sends no further socket messages. 60s keeps
  // idle re-renders low at fleet scale; expiry lands within 5–6 min.
  const now = ref(Date.now());
  setInterval(() => { now.value = Date.now(); }, 60000);

  // Single source of truth for the device-list + map online indicator.
  // Online ⇔ backend status "online" AND a position within ONLINE_FRESH_MS.
  // Reads `now`, so it expires reactively without needing a new socket message.
  function isDeviceOnline(device) {
    return device?.status === 'online' && isFresh(device?.lastSeenMs || 0, now.value);
  }

  // --- Live-data watchdog ---
  // Armed when a fetch succeeds, disarmed by the first socket frame (Traccar or
  // posbroker — both land in processSocketData).
  let liveWatchdog = null;

  function clearLiveWatchdog() {
    if (liveWatchdog) {
      clearTimeout(liveWatchdog);
      liveWatchdog = null;
    }
  }

  function armLiveWatchdog() {
    // Do NOT restart a watchdog that is already counting. It is armed after every
    // successful fetch, and the reconnect path re-fetches every ~3s while the
    // socket is down — so a self-resetting 20s timer could never elapse, and the
    // one escape from the splash was disarmed by the very retry loop it exists to
    // escape. Measured 2026-08-16: 27 refetches over 4 minutes, watchdog never
    // fired, user held on "Loading your devices" with the data already in the
    // store behind the overlay. The deadline is absolute from the first arm.
    if (liveWatchdog) return;
    liveWatchdog = setTimeout(() => {
      liveWatchdog = null;
      if (!loading.value) return;
      console.warn('[Devices] No live position within 20s — releasing the loading gate.');
      // Let the user into the app with whatever the fetch returned rather than
      // holding them on a splash that has nothing left to wait for.
      loading.value = false;
      boot.markStalled();
    }, LIVE_WATCHDOG_MS);
  }

  // --- Socket Data Handler ---
  function processSocketData(data) {
    if ("devices" in data) {
      data.devices.forEach((d) => {
        // Store status raw; online/offline is derived from recency at render
        // time via isDeviceOnline, so a stale/replayed snapshot (incl.
        // posbroker's retained last position) can't show a dead device online.
        if (devices[d.id]) {
          Object.assign(devices[d.id], d);
        } else {
          devices[d.id] = d;
        }
        // Keep lastSeenMs as the freshest recency signal: a devices-only
        // message can carry a newer lastUpdate, but never rewind below a
        // more-recent position already recorded.
        const ms = toMs(d.lastUpdate);
        if (ms > (devices[d.id].lastSeenMs || 0)) devices[d.id].lastSeenMs = ms;
      });
    }

    if ("positions" in data) {
      data.positions.forEach((pos) => {
        const deviceId = pos.deviceId;
        const device = devices[deviceId];
        if (!device) return; 

        Object.assign(device, {
          ignition: pos.attributes?.ignition || false,
          speed: pos.speed,
          event: pos.attributes?.event || pos.event,
          power: pos.attributes?.power,
          battery: pos.attributes?.battery,
          sat: pos.attributes?.sat, 
          hdop: pos.attributes?.hdop, 
          latlon: [pos.latitude, pos.longitude],
          bearing: pos.course,
          accuracy: pos.accuracy,
          fixTime: pos.fixTime,
          updateTime: pos.serverTime || pos.deviceTime,
          connectionType: pos.network?.radioType,
          signalLevel: pos.network?.cellTowers?.[0]?.signalStrength,
          address: pos.address,
          geofences: pos.geofenceIds,
          valid: pos.valid,
          lastSeenMs: toMs(pos.serverTime || pos.deviceTime || pos.fixTime),
        });

        // Map Markers Logic (freshness-gated, mirroring isDeviceOnline)
        const isOnline = device.status === "online" && isFresh(device.lastSeenMs);
        const isIgnitionOn = pos.attributes?.ignition;
        const markerColor = (isOnline && isIgnitionOn) ? "#57f491" : "#ffcbd1";
        const catObj = categoryMapping.find(category => category.server === device.category)
          ?? categoryMapping.find(category => category.server === null);

        const markerData = {
          id: deviceId,
          latlon: [pos.latitude, pos.longitude],
          bearing: pos.course,
          color: markerColor,
          label: device.name,
          type: catObj.map
        };

        if (deviceId in deviceMarkers) {
          mapUpdate.value = markerData;
        } else {
          deviceMarkers[deviceId] = markerData;
          mapUpdate.value = markerData;
        }
      });
    }
    console.log('procced socket message', data)

    // First frame in — we're live. Both marks are idempotent, which matters
    // because this runs on every socket message, not just the first.
    clearLiveWatchdog();
    boot.done('live');

    // The 1s hold stays for now: it exists so the map has a beat to paint its
    // first markers instead of flashing empty. Guarded so we don't queue a
    // timer per socket frame for the rest of the session.
    if (loading.value) {
      setTimeout(() => {
        loading.value = false;
      }, 1000)
    }
  }

  // --- Actions ---

  async function fetchDevices() {
    console.log('[Devices] Fetching devices list...');

    try {
      // api.navitag.net resolves the caller's devices through Traccar's own
      // permission graph (?userId=), so this returns exactly what the old
      // direct-to-Traccar call returned. A Traccar outage comes back as a 502
      // and throws here — it must never arrive as an empty list, or fetchAll
      // would read it as "no devices" and bounce the user to the teaser.
      const res = await request.send({
        url: `${baseUrl}/device/list`,
        token: userStore.idToken,
      });
      const retArr = res?.devices;

      // Set only when present. A response without it (older API build) leaves
      // the previous measurement in place rather than overwriting it with null.
      if (res?.entitlement) entitlement.value = res.entitlement;

      if (Array.isArray(retArr)) {
        // An empty owned-device list is NOT an error and NOT a teaser
        // trigger on its own — the user may still have devices shared TO
        // them (fetchSharedToMe). The teaser decision is made in fetchAll()
        // after the shared-device merge, so both sources are considered.
        retArr.forEach(device => {
          // Owned devices carry the sentinel scope rather than an enumerated
          // list — see src/utils/scopes.js. shared:false makes the
          // ownership flag explicit for hasScope consumers and any UI that
          // wants to render an owned-vs-shared affordance.
          devices[device.id] = { ...device, shared: false, scopes: [OWNER_SENTINEL], lastSeenMs: toMs(device.lastUpdate) };
        });
      }
      await fetchDeviceExpirations();

    } catch (err) {
      console.error('[Devices] Fetch failed:', err);
      throw err;
    }
  }

  async function fetchDeviceExpirations() {
    const exps = await request.send({
      url: `${baseUrl}/user/device-expiration`,
      token: userStore.idToken
    });
    if (exps && exps.status == "success") {
      // The payload key was renamed `message` -> `devices` on 2026-08-20 so
      // this endpoint stops being the only one shipping data under the key
      // everyone else uses for error text. Both are read because the frontend
      // and the API deploy separately — whichever lands first, this works.
      const rows = exps.devices ?? exps.message ?? [];
      rows.forEach((el) => {
        if (devices[el.server_ref]) {
          devices[el.server_ref].expiration = el.expiration;
          devices[el.server_ref].plan_level = normalizePlanLevel(el.plan_level);
          devices[el.server_ref].actionable = el.actionable;
        }
      });
      return true;
    }
    return false;
  }

  async function fetchGeofences() {
    console.log('[Geofences] Fetching geofences...');
    try {
      // api.navitag.net lists by the caller's 1:1 Traccar group, which is what
      // makes a geofence both visible and evaluated. Traccar's array is passed
      // through unchanged, so the parser below is untouched by the migration.
      //
      // A Traccar outage comes back as a 502 and throws here — it must never
      // arrive as an empty array, or the store would read it as "no geofences"
      // and the list view would show an empty state over live data.
      const retArr = await request.send({
        url: `${baseUrl}/geofence`,
        token: userStore.idToken,
      });

      let allgeos = {}
      if (Array.isArray(retArr)) {
        retArr.forEach(g => {
          let parsedPoints = [];
          if (g.area && g.area.startsWith('POLYGON')) {
            const coordsString = g.area.replace('POLYGON', '').replace(/[()]/g, '').trim();
            // Traccar's WKT is "lat lon", NOT the WKT/JTS standard "lon lat" —
            // so x is the latitude here and Leaflet gets [lat, lng] as it
            // expects. Do not "correct" this; the server builds WKT in the same
            // order (Geofence.php buildPolygonWkt) and every stored geofence
            // uses it. See api.navitag.net/v1/BACKFILL_AND_DEBT.md §E6.
            parsedPoints = coordsString.split(',').map(coord => {
              const [x, y] = coord.trim().split(/\s+/);
              return [parseFloat(x), parseFloat(y)];
            });
          }

          allgeos[g.id] = { name: g.name, points: parsedPoints };

        });
      }
      // Replace rather than merge: a geofence deleted server-side (by the plan
      // sweep, or from another device) must disappear here too. Object.assign
      // alone would leave it resident forever.
      Object.keys(geofences).forEach(k => { if (!(k in allgeos)) delete geofences[k]; });
      Object.assign(geofences, allgeos)
    } catch (err) {
      console.error('[Geofences] Geofences fetch failed:', err);
      throw err;
    }
  }

  // Best-effort: never throws, populates sharedToMe in place. Failure leaves
  // the prior value intact so a /share/tome outage doesn't drop a working
  // list of shared devices from a previous lifecycle tick.
  async function fetchSharedToMe() {
    if (!userStore.idToken) {
      sharedToMe.value = [];
      return [];
    }
    try {
      const res = await request.send({
        url: `${baseUrl}/share/tome`,
        method: 'POST',
        token: userStore.idToken,
      });
      const list = Array.isArray(res?.shared_devices) ? res.shared_devices : [];
      sharedToMe.value = list;
      return list;
    } catch (err) {
      console.warn('[Devices] /share/tome fetch failed:', err?.message || err);
      return sharedToMe.value;
    }
  }

  // Merges /share/tome entries into the devices reactive map so shared
  // devices show up in lists/map alongside owned ones. Runs after the three
  // parallel fetches resolve, so fetchDevices' bulk-assignment can't
  // clobber the `shared` flag. Skips wildcard ("*") and entries whose
  // Traccar lookup failed (device === null). Device ids come from the
  // granter's Traccar server — collisions with owned-device ids are
  // theoretically possible across servers but very unlikely in practice.
  function mergeSharedToMeIntoDevices() {
    for (const entry of sharedToMe.value) {
      if (!entry || entry.imei === '*' || !entry.device || entry.device.id == null) continue;
      const merged = {
        ...entry.device,
        shared: true,
        scopes: Array.isArray(entry.scopes) ? entry.scopes : [],
        lastSeenMs: toMs(entry.device.lastUpdate),
      };
      if (devices[entry.device.id]) {
        Object.assign(devices[entry.device.id], merged);
      } else {
        devices[entry.device.id] = merged;
      }
    }
  }

  async function fetchAll() {
    boot.begin('devices');
    loading.value = true;
    error.value = null;
    // Deliberately NOT clearing the live watchdog here. fetchAll runs on every
    // reconnect attempt, so clearing it made the deadline slide forward once per
    // retry and never expire. A genuine reset still happens where it should: on
    // the first socket frame (processSocketData) and on session teardown.
    try {
      // fetchSharedToMe is best-effort and never throws, so an outage there
      // cannot poison Promise.all and turn a successful device fetch into a
      // false return.
      await Promise.all([fetchDevices(), fetchGeofences(), fetchSharedToMe()]);
      mergeSharedToMeIntoDevices();
      // Both branches below are answers, not pending states.
      hasLoadedOnce.value = true;

      // Teaser decision happens HERE, after the merge, so it accounts for
      // BOTH owned devices and devices shared TO this user. Checking the
      // post-merge `devices` map (rather than the raw owned list) also
      // naturally excludes wildcard / failed-lookup shares, which
      // mergeSharedToMeIntoDevices already filters out. Nothing renderable
      // from either source → teaser. Deciding here (not inside fetchDevices)
      // is also what keeps mergeSharedToMeIntoDevices from being skipped by
      // a throw — that skip was leaving shared rows to be (re)created by the
      // broker without shared:true / scopes.
      if (Object.keys(devices).length === 0) {
        console.log('[Devices] No owned or shared devices, redirecting to teaser.');
        loading.value = false;
        // No devices means no socket traffic is coming, so the live step would
        // never land. Close out the run rather than leaving the bar short.
        boot.completeAll();
        router.push('/linkdevice/teaser');
        return 'no_devices';
      }

      boot.done('devices');
      // `loading` deliberately stays true here — it is released by the first
      // socket frame in processSocketData, so the splash covers the gap between
      // "list fetched" and "positions on the map". The watchdog bounds that wait.
      boot.begin('live');
      armLiveWatchdog();
      return true; // Successfully fetched
    } catch (err) {
      console.error('[Devices] fetchAll failed:', err);
      error.value = err.message || 'Failed to fetch tracking data.';
      // Release the gate on the way out. This used to fall through with
      // `loading` still true, so any throw from fetchDevices/fetchGeofences
      // stranded the user on the splash — and the <Error /> overlay that
      // covered it cleared on retry while the splash underneath did not.
      loading.value = false;
      boot.fail('devices');
      return false; // Fetch failed
    }
  }
  
  // Internal: read-patch-write a single attribute via one of the lock endpoints.
  // Sends a clean Traccar device payload, reconciles the store from
  // response.traccar (which includes any broker side-effects on other attrs).
  async function _setLockAttribute(deviceId, attrKey, enabled, endpoint) {
    const d = devices[deviceId];
    if (!d) return { ok: false, error: 'Device not found' };

    const payload = {
      id: d.id,
      uniqueId: d.uniqueId,
      name: d.name,
      disabled: d.disabled,
      groupId: d.groupId,
      phone: d.phone,
      model: d.model,
      contact: d.contact,
      category: d.category,
      attributes: {
        ...(d.attributes || {}),
        [attrKey]: enabled,
      },
    };

    try {
      const res = await request.send({
        url: `${baseUrl}/device/${endpoint}`,
        method: 'POST',
        data: payload,
        token: userStore.idToken,
      });
      if (res?.status === 'ok' && res.traccar && devices[deviceId]) {
        Object.assign(devices[deviceId], res.traccar);
        return { ok: true, traccar: res.traccar };
      }
      return { ok: false, status: res?.status };
    } catch (err) {
      console.error(`[Devices] _setLockAttribute(${attrKey}) failed:`, err);
      return { ok: false, error: err };
    }
  }

  function setActivityLock(deviceId, enabled) {
    return _setLockAttribute(deviceId, 'activity_lock', enabled, 'update-activity-lock');
  }

  function setAutoLock(deviceId, enabled) {
    return _setLockAttribute(deviceId, 'auto_lock', enabled, 'update-auto-lock');
  }

  // `deviceId` stays the TRACCAR DEVICE ID — the key every store in this file
  // is built on (fetchDevices, processSocketData, mergeSharedToMeIntoDevices,
  // deviceSelected). The API route is keyed by IMEI, so the IMEI is derived
  // from the store row rather than taken as the argument: passing an IMEI in
  // here would miss `devices[deviceId]`, fall into the create branch, and add a
  // SECOND row for the same device (both list and map render Object.values),
  // plus a marker update with latlon undefined.
  //
  // `edits` is a partial — { name?, category?, speedLimit? } only. The server
  // read-modify-writes it onto the authoritative Traccar snapshot, so
  // groupId/uniqueId/disabled and the lock attributes are no longer ours to send.
  async function updateDevice(deviceId, edits) {
    const current = devices[deviceId];
    if (!current?.uniqueId) {
      console.error('[Devices] updateDevice: no store row / uniqueId for id', deviceId);
      return null;
    }

    try {
      const res = await request.send({
        url: `${baseUrl}/device/${current.uniqueId}`,
        method: 'PUT',
        data: edits,
        token: userStore.idToken,
      });

      const updated = res?.status === 'ok' ? res.traccar : null;
      if (!updated) return null;

      // Surfaces device_inventory.server_ref disagreeing with the id the store
      // was built from — the same class of drift as the TEST1/TEST2 uniqueId
      // mismatch. Keep writing to the known-good store key either way.
      if (updated.id != null && updated.id !== deviceId) {
        console.warn(
          `[Devices] server_ref mismatch: store key ${deviceId} vs Traccar id ${updated.id} for ${current.uniqueId}`
        );
      }

      Object.assign(devices[deviceId], updated);

      const catObj = categoryMapping.find(c => c.server === updated.category)
        ?? categoryMapping.find(c => c.server === null);

      const existing = deviceMarkers[deviceId] || {};
      const newMarker = {
        id: deviceId,
        latlon: existing.latlon,
        bearing: existing.bearing,
        color: existing.color,
        label: updated.name,
        type: catObj.map,
      };

      deviceMarkers[deviceId] = newMarker;
      mapUpdate.value = newMarker;

      return updated;
    } catch (err) {
      console.error('[Devices] updateDevice failed:', err);
      return null;
    }
  }

  // enforceGeofenceLimit() lived here and ran on every session start, deleting
  // the user's NEWEST geofences whenever it decided they were over quota. It
  // computed that limit itself, so one failed /user/device-expiration made a pro
  // customer look basic and destroyed 8 of their 10 geofences — irreversibly,
  // with no confirmation and no record.
  //
  // Quota is server-side now, in both directions: POST /v1/geofence refuses at
  // the limit, and GeofenceQuota prunes from the plan-change and expiration
  // events that actually change an allowance. The client no longer deletes
  // anything it was not explicitly asked to delete.

  function clearData() {
    clearLiveWatchdog();
    hasLoadedOnce.value = false;
    loading.value = false;
    Object.keys(devices).forEach(key => delete devices[key]);
    Object.keys(deviceMarkers).forEach(key => delete deviceMarkers[key]);
    Object.keys(geofences).forEach(key => delete geofences[key]);
    sharedToMe.value = [];
    entitlement.value = null;
    error.value = null;
    mapUpdate.value = null;
  }

  // --- Getters ---
  const deviceMarkerKeys = computed(() => Object.keys(deviceMarkers));
  const deviceSelectedObject = computed(() => (deviceSelected.value && devices[deviceSelected.value]) || null);
  // The server measures the allowance; the client only renders it. `hasProPlan`
  // is gone — scanning device objects for plan_level is what made a failed
  // /user/device-expiration look like a downgrade.
  //
  // Falls back to 2 for DISPLAY ONLY when the entitlement has not been measured
  // yet — it decides whether the create button is enabled, nothing more. No
  // client code deletes on it: the server refuses at the limit with a 409, and
  // that refusal is the authority. Guessing low here costs the user one blocked
  // tap and a clear message; it can no longer cost them a geofence.
  const geofenceLimit = computed(() => entitlement.value?.geofence_limit ?? 2);
  const canCreateGeofence = computed(() => Object.keys(geofences).length < geofenceLimit.value);

  return {
    devices, geofences, loading, error, deviceMarkers, deviceMarkerKeys,
    deviceSelectedObject, deviceSelected, mapUpdate, draftPolygon, activeRoute,
    sharedToMe, now, isDeviceOnline, hasLoadedOnce,
    entitlement, geofenceLimit, canCreateGeofence,
    processSocketData,
    fetchDevices, fetchGeofences, fetchDeviceExpirations, fetchSharedToMe, fetchAll, updateDevice,
    setActivityLock, setAutoLock,
    clearData
  };
});