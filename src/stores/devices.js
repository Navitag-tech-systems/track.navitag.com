import { defineStore } from 'pinia';
import { ref, computed, reactive } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { useRouter } from 'vue-router';
import { request } from '@/utils/http';
import { baseUrl, categoryMapping } from '@/utils/variables';
import { OWNER_SENTINEL } from '@/utils/scopes';

// Backend now emits plan_level lowercase ('pro', 'basic'); older shapes
// shipped 'Pro' / 'Basic'. Normalize on ingestion so the UI can render
// the field directly and downstream comparisons are stable. Comparison
// sites still use toLowerCase() defensively in case a new path skips this.
function normalizePlanLevel(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export const useDevicesStore = defineStore('devices', () => {
  const userStore = useUserStore();
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

  // Devices shared TO this user by other accounts (from POST /share/tome).
  // Hydrated on every lifecycle entry in parallel with fetchDevices +
  // fetchGeofences. Each entry: { imei, scopes: ['position:live', ...] }.
  const sharedToMe = ref([]);

  // --- Socket Data Handler ---
  function processSocketData(data) {
    if ("devices" in data) {
      data.devices.forEach((d) => {
        if (devices[d.id]) {
          Object.assign(devices[d.id], d); 
        } else {
          devices[d.id] = d; 
        }
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
          valid: pos.valid 
        });

        // Map Markers Logic
        const isOnline = device.status === "online";
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
    setTimeout(()=>{
      loading.value = false;
    }, 1000)
  }

  // --- Actions ---

  async function fetchDevices() {
    console.log('[Devices] Fetching devices list...');
    if (!userStore.server_url) return;

    try {
      const retArr = await request.send({
        url: `https://${userStore.server_url}/api/devices`,
        isTraccar: true,
      });

      if (Array.isArray(retArr)) {
        if (retArr.length < 1) {
             console.log('[Devices] No devices found, redirecting to teaser.');
             router.push('/linkdevice/teaser');
             throw new Error('NO_DEVICES');
        }

        retArr.forEach(device => {
          // Owned devices carry the sentinel scope rather than an enumerated
          // list — see src/utils/scopes.js. shared:false makes the
          // ownership flag explicit for hasScope consumers and any UI that
          // wants to render an owned-vs-shared affordance.
          devices[device.id] = { ...device, shared: false, scopes: [OWNER_SENTINEL] };
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
      exps.message.forEach((el) => {
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
    if (!userStore.server_url) return;
    try {
      const retArr = await request.send({
        url: `https://${userStore.server_url}/api/geofences`,
        isTraccar: true,
      });

      let allgeos = {}
      if (Array.isArray(retArr)) {
        retArr.forEach(g => {
          let parsedPoints = [];
          if (g.area && g.area.startsWith('POLYGON')) {
            const coordsString = g.area.replace('POLYGON', '').replace(/[()]/g, '').trim();
            parsedPoints = coordsString.split(',').map(coord => {
              const [x, y] = coord.trim().split(/\s+/); 
              return [parseFloat(x), parseFloat(y)];
            });
          }
          
          allgeos[g.id] = { name: g.name, points: parsedPoints };

        });
      }
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
      };
      if (devices[entry.device.id]) {
        Object.assign(devices[entry.device.id], merged);
      } else {
        devices[entry.device.id] = merged;
      }
    }
  }

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      // fetchSharedToMe is best-effort and never throws, so an outage there
      // cannot poison Promise.all and turn a successful device fetch into a
      // false return.
      await Promise.all([fetchDevices(), fetchGeofences(), fetchSharedToMe()]);
      mergeSharedToMeIntoDevices();
      return true; // Successfully fetched
    } catch (err) {
      if (err.message === 'NO_DEVICES') {
        loading.value = false;
        return 'no_devices';
      }
      console.error('[Devices] fetchAll failed:', err);
      error.value = err.message || 'Failed to fetch tracking data.';
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

  async function updateDevice(deviceId, payload) {
    if (!userStore.server_url) return null;

    try {
      const updated = await request.send({
        url: `https://${userStore.server_url}/api/devices/${deviceId}`,
        method: 'PUT',
        isTraccar: true,
        data: payload,
      });

      if (!updated) return null;

      if (devices[deviceId]) {
        Object.assign(devices[deviceId], updated);
      } else {
        devices[deviceId] = updated;
      }

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

  async function enforceGeofenceLimit() {
    if (!userStore.server_url) return;
    const limit = geofenceLimit.value;
    const ids = Object.keys(geofences).map(Number).sort((a, b) => b - a);
    if (ids.length <= limit) return;

    const excess = ids.slice(0, ids.length - limit);
    console.log(`[Geofences] Over limit (${ids.length}/${limit}). Deleting newest ${excess.length}: ${excess.join(', ')}`);

    await Promise.all(excess.map(id =>
      request.send({
        url: `https://${userStore.server_url}/api/geofences/${id}`,
        method: 'DELETE',
        isTraccar: true,
      }).then(() => {
        delete geofences[id];
      }).catch(err => console.error(`[Geofences] Failed to delete excess geofence ${id}:`, err))
    ));
  }

  function clearData() {
    Object.keys(devices).forEach(key => delete devices[key]);
    Object.keys(deviceMarkers).forEach(key => delete deviceMarkers[key]);
    Object.keys(geofences).forEach(key => delete geofences[key]);
    sharedToMe.value = [];
    error.value = null;
    mapUpdate.value = null;
  }

  // --- Getters ---
  const deviceMarkerKeys = computed(() => Object.keys(deviceMarkers));
  const deviceSelectedObject = computed(() => (deviceSelected.value && devices[deviceSelected.value]) || null);
  const hasProPlan = computed(() => Object.values(devices).some(d => d.plan_level?.toLowerCase() === 'pro'));
  const geofenceLimit = computed(() => hasProPlan.value ? 10 : 2);
  const canCreateGeofence = computed(() => Object.keys(geofences).length < geofenceLimit.value);

  return {
    devices, geofences, loading, error, deviceMarkers, deviceMarkerKeys,
    deviceSelectedObject, deviceSelected, mapUpdate, draftPolygon, activeRoute,
    sharedToMe,
    hasProPlan, geofenceLimit, canCreateGeofence,
    processSocketData,
    fetchDevices, fetchGeofences, fetchDeviceExpirations, fetchSharedToMe, fetchAll, updateDevice,
    setActivityLock, setAutoLock,
    enforceGeofenceLimit, clearData
  };
});