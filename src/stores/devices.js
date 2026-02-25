import { defineStore } from 'pinia';
import { ref, watch, computed, reactive } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { useRouter } from 'vue-router';
import { CapacitorHttp, Capacitor } from '@capacitor/core'; 

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

  // --- Helpers ---
  const getAuthHeaders = () => {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (Capacitor.isNativePlatform() && userStore.sessionId) {
      headers['Cookie'] = `JSESSIONID=${userStore.sessionId}`;
    }
    return headers;
  };

  // --- Callback Defined Early ---
  function socketMsgCallback(data) {
    console.log('incomming Message: ', JSON.stringify(data))
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

        // Map Markers
        const isOnline = device.status === "online";
        const isIgnitionOn = pos.attributes?.ignition;
        const markerColor = (isOnline && isIgnitionOn) ? "#57f491" : "#ffcbd1";

        const markerData = {
          id: deviceId, 
          latlon: [pos.latitude, pos.longitude],
          bearing: pos.course,
          color: markerColor,
          label: device.name,
          type: device.category
        };

        if (deviceId in deviceMarkers) {
          console.log('Update Marker', JSON.stringify(markerData))
          mapUpdate.value = markerData;

        } else {
          console.log('add new marker', JSON.stringify(markerData))
          deviceMarkers[deviceId] = markerData;
          mapUpdate.value = markerData;
        }
      });
    }
    loading.value = false;
    console.log('Processed WebSocket Data');
  }

  // --- Actions ---

  async function fetchDevices() {
    console.log('[STEP 2] Entering fetchDevices...');
    if (!userStore.server_url) {
      console.log('[STEP 2a] No server_url, aborting.');
      return;
    }

    try {
      console.log('[STEP 3] Sending CapacitorHttp Request for Devices...');
      const options = {
        url: `https://${userStore.server_url}/api/devices`,
        headers: getAuthHeaders(),
        withCredentials: true,
        connectTimeout: 10000, // 10s timeout
        readTimeout: 10000 
      };

      const response = await CapacitorHttp.get(options);
      console.log(`[STEP 4] Devices Response: ${response.status}`);
      
      if (response.status === 401) throw new Error('Unauthorized');

      const retArr = response.data;

      if (Array.isArray(retArr)) {
        console.log(`[STEP 5] Processing ${retArr.length} devices...`);
        if (retArr.length < 1) {
             console.log('[STEP 5a] No devices, redirecting.');
             router.push('/linkdevice/teaser');
        }
        retArr.forEach(device => {
          devices[device.id] = device;
        });
      } else {
        console.warn('[STEP 5-WARN] Response data is not an array:', retArr);
      }
    } catch (err) {
      console.error('[STEP 2-ERROR] fetchDevices failed:', err);
      if (err.message === 'Unauthorized') { /* handle */ }
      throw err;
    } finally {
      console.log('[STEP 6] Exiting fetchDevices (Finally Block)');
    }
  }

  async function fetchGeofences() {
    console.log('[STEP 7] Entering fetchGeofences...');
    if (!userStore.server_url) return;
    try {
      const options = {
        url: `https://${userStore.server_url}/api/geofences`,
        headers: getAuthHeaders(),
        withCredentials: true,
      };

      const response = await CapacitorHttp.get(options);
      console.log(`[STEP 8] Geofences Response: ${response.status}`);

      if (response.status === 401) throw new Error('Unauthorized');

      const retArr = response.data;
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
          geofences[g.id] = { name: g.name, points: parsedPoints };
        });
      }
    } catch (err) {
      console.error('[STEP 7-ERROR] fetchGeofences failed:', err);
    } finally {
      console.log('[STEP 9] Exiting fetchGeofences');
    }
  }

  async function fetchAll() {
    console.log('[STEP 1] fetchAll Started');
    loading.value = true;
    error.value = null;
    try {
      // SEQUENTIAL EXECUTION (Easier to debug than Promise.all)
      await fetchDevices();
      await fetchGeofences();
      
      console.log('[STEP 10] API Calls Done. Connecting Socket...');
      
      if (typeof userStore.connectSocket === 'function') {
        userStore.connectSocket(socketMsgCallback);
        console.log('[STEP 11] Socket connection initiated.');
      } else {
        console.error('[STEP 11-ERROR] connectSocket function missing!');
      }

    } catch (err) {
      console.error('[STEP 1-ERROR] fetchAll aborted:', err);
      error.value = err.message || 'Failed to fetch tracking data.';
    } finally {
      console.log('[STEP 12] fetchAll Finished');
    }
  }
  
  function clearData() {
    Object.keys(devices).forEach(key => delete devices[key]);
    Object.keys(deviceMarkers).forEach(key => delete deviceMarkers[key]);
    Object.keys(geofences).forEach(key => delete geofences[key]); 
    error.value = null;
    mapUpdate.value = null;
  }

  // --- Watcher ---
  watch(
    () => userStore.server_connect,
    (isConnected) => {
      console.log('[STEP 0] Watcher triggered. Connected:', isConnected);
      if (isConnected) {
        fetchAll();
      } else {
        clearData();
      }
    },
    { immediate: true }
  );

  // --- Getters ---
  const deviceMarkerKeys = computed(() => Object.keys(deviceMarkers));
  const deviceSelectedObject = computed(() => (deviceSelected.value && devices[deviceSelected.value]) || null);

  return {
    devices, geofences, loading, error, deviceMarkers, deviceMarkerKeys,
    deviceSelectedObject, deviceSelected, mapUpdate, draftPolygon, activeRoute,
    fetchDevices, fetchGeofences, fetchAll, clearData
  };
});