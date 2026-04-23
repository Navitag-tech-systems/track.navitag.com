import { defineStore } from 'pinia';
import { ref, computed, reactive } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { useRouter } from 'vue-router';
import { request } from '@/utils/http'; 
import { baseUrl, categoryMapping } from '@/utils/variables';

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
          devices[device.id] = device;
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
          devices[el.server_ref].plan_level = el.plan_level;
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

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      await Promise.all([fetchDevices(), fetchGeofences()]);
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

  async function fetchDeviceNotifications(deviceId) {
    if (!userStore.server_url) return [];
    try {
      const list = await request.send({
        url: `https://${userStore.server_url}/api/notifications?deviceId=${deviceId}`,
        isTraccar: true,
      });
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.error('[Devices] fetchDeviceNotifications failed:', err);
      return [];
    }
  }

  async function linkDeviceNotification(deviceId, notificationId) {
    if (!userStore.server_url) return false;
    try {
      await request.send({
        url: `https://${userStore.server_url}/api/permissions`,
        method: 'POST',
        isTraccar: true,
        data: { deviceId: Number(deviceId), notificationId: Number(notificationId) },
      });
      return true;
    } catch (err) {
      console.error('[Devices] linkDeviceNotification failed:', err);
      return false;
    }
  }

  async function unlinkDeviceNotification(deviceId, notificationId) {
    if (!userStore.server_url) return false;
    try {
      await request.send({
        url: `https://${userStore.server_url}/api/permissions`,
        method: 'DELETE',
        isTraccar: true,
        data: { deviceId: Number(deviceId), notificationId: Number(notificationId) },
      });
      return true;
    } catch (err) {
      console.error('[Devices] unlinkDeviceNotification failed:', err);
      return false;
    }
  }

  async function linkDeviceGeofence(deviceId, geofenceId) {
    if (!userStore.server_url) return false;
    try {
      await request.send({
        url: `https://${userStore.server_url}/api/permissions`,
        method: 'POST',
        isTraccar: true,
        data: { deviceId: Number(deviceId), geofenceId: Number(geofenceId) },
      });
      return true;
    } catch (err) {
      console.error('[Devices] linkDeviceGeofence failed:', err);
      return false;
    }
  }

  async function linkGeofenceToEligibleDevices(geofenceId) {
    const priorCount = Object.keys(geofences).length;
    const linkAll = priorCount < 2;

    const targets = Object.values(devices).filter(d =>
      linkAll ? true : d.plan_level === 'Pro'
    );

    if (!targets.length) return true;

    const results = await Promise.all(
      targets.map(d => linkDeviceGeofence(d.id, geofenceId))
    );
    const ok = results.every(Boolean);
    if (!ok) console.warn('[Devices] Some devices failed to link to geofence', geofenceId);
    return ok;
  }

  async function linkDefaultGeofencesToDevice(deviceId) {
    const device = devices[deviceId];
    const limit = device?.plan_level === 'Pro' ? 10 : 2;

    const ids = Object.keys(geofences)
      .map(Number)
      .sort((a, b) => a - b)
      .slice(0, limit);

    if (!ids.length) return true;

    const results = await Promise.all(
      ids.map(gid => linkDeviceGeofence(deviceId, gid))
    );
    const ok = results.every(Boolean);
    if (!ok) console.warn('[Devices] Some geofences failed to link to device', deviceId);
    return ok;
  }

  async function linkAllNotificationsToDevice(deviceId) {
    const notifs = userStore.notifications || [];
    if (!notifs.length) return true;
    const results = await Promise.all(
      notifs.map(n => linkDeviceNotification(deviceId, n.id))
    );
    const ok = results.every(Boolean);
    if (!ok) console.warn('[Devices] Some notifications failed to link to device', deviceId);
    return ok;
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
    error.value = null;
    mapUpdate.value = null;
  }

  // --- Getters ---
  const deviceMarkerKeys = computed(() => Object.keys(deviceMarkers));
  const deviceSelectedObject = computed(() => (deviceSelected.value && devices[deviceSelected.value]) || null);
  const hasProPlan = computed(() => Object.values(devices).some(d => d.plan_level === 'Pro'));
  const geofenceLimit = computed(() => hasProPlan.value ? 10 : 2);
  const canCreateGeofence = computed(() => Object.keys(geofences).length < geofenceLimit.value);

  return {
    devices, geofences, loading, error, deviceMarkers, deviceMarkerKeys,
    deviceSelectedObject, deviceSelected, mapUpdate, draftPolygon, activeRoute,
    hasProPlan, geofenceLimit, canCreateGeofence,
    processSocketData,
    fetchDevices, fetchGeofences, fetchDeviceExpirations, fetchAll, updateDevice,
    fetchDeviceNotifications, linkDeviceNotification, unlinkDeviceNotification, linkAllNotificationsToDevice,
    linkDeviceGeofence, linkDefaultGeofencesToDevice, linkGeofenceToEligibleDevices,
    enforceGeofenceLimit, clearData
  };
});