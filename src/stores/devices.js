import { defineStore } from 'pinia';
import { ref, watch, computed, reactive } from 'vue';
import ky from 'ky';
import { useUserStore } from './user';
import { useRouter } from 'vue-router';

export const useDevicesStore = defineStore('devices', () => {
  const userStore = useUserStore();

  const devices = reactive({});
  const geofences = reactive({}); // Fixed: Made this a reactive object
  const loading = ref(false);
  const error = ref(null);
  const deviceSelected = ref(null);
  const mapUpdate = ref(null);
  const draftPolygon = ref(null); // <-- ADD THIS LINE
  const deviceMarkers = reactive({});
  const activeRoute = ref({ line: [], markers: {} });
  const router = useRouter()

  async function fetchDevices() {
    if (!userStore.server_url) return;
    try {
      let retArr = await ky.get(`https://${userStore.server_url}/api/devices`, {
        credentials: 'include' 
      }).json();

      if(retArr.length < 1){
        router.push('/linkdevice/teaser')
      }

      retArr.forEach(device => {
        devices[device.id] = device;
      });
    } catch (err) {
      console.error('Error fetching devices:', err);
      throw err;
    }
  }

  async function fetchGeofences() {
    if (!userStore.server_url) return;
    try {
      let retArr = await ky.get(`https://${userStore.server_url}/api/geofences`, {
        credentials: 'include' 
      }).json();

      retArr.forEach(g => {
        let parsedPoints = [];

        // Traccar sends areas as WKT strings, e.g., "POLYGON ((14.6 120.98, 14.5 120.97))"
        if (g.area && g.area.startsWith('POLYGON')) {
          // Remove the word POLYGON and all parentheses
          const coordsString = g.area.replace('POLYGON', '').replace(/[()]/g, '').trim();
          
          // Split by comma to get coordinate pairs, then split by space to get lat/lon
          parsedPoints = coordsString.split(',').map(coord => {
            const [lat, lon] = coord.trim().split(/\s+/);
            return [parseFloat(lat), parseFloat(lon)];
          });
        }

        // Assign to reactive object in your requested format
        geofences[g.id] = {
          name: g.name,
          points: parsedPoints
        };
      });
    } catch (err) {
      console.error('Error fetching geofences:', err);
      throw err;
    }
  }

  // Combine both fetch requests
  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      // Both functions run in parallel for faster loading
      await Promise.all([fetchDevices(), fetchGeofences()]);
      userStore.connectSocket(socketMsgCallback);  
      
    } catch (err) {
      error.value = err.message || 'Failed to fetch tracking data.';
    }
  }
  
  function clearData() {
    // Clear reactive objects by iterating and deleting keys
    Object.keys(devices).forEach(key => delete devices[key]);
    Object.keys(deviceMarkers).forEach(key => delete deviceMarkers[key]);
    Object.keys(geofences).forEach(key => delete geofences[key]); // Properly clear reactive geofences
    
    error.value = null;
    mapUpdate.value = null;
  }

  // --- THE WATCHER ---
  watch(
    () => userStore.server_connect,
    (isConnected) => {
      if (isConnected) {
        fetchAll();
      } else {
        clearData();
      }
    },
    { immediate: true }
  );

  // --- THE WEBSOCKET CALLBACK ---
  function socketMsgCallback(data) {
    
    // 1. HANDLE DEVICE STATUS UPDATES (Online/Offline)
    if ("devices" in data) {
      data.devices.forEach((d) => {
        if (devices[d.id]) {
          Object.assign(devices[d.id], d); // Update existing
        } else {
          devices[d.id] = d; // Add new
        }
      });
    }

    // 2. HANDLE GPS POSITION UPDATES
    if ("positions" in data) {
      data.positions.forEach((pos) => {
        const deviceId = pos.deviceId;
        const device = devices[deviceId];

        if (!device) return; // Skip if we don't have this device in memory

        // A. Update the nested object in devices reactive state safely
        Object.assign(device, {
          ignition: pos.attributes?.ignition || false,
          speed: pos.speed,
          event: pos.attributes?.event || pos.event,
          power: pos.attributes?.power,
          battery: pos.attributes?.battery,
          latlon: [pos.latitude, pos.longitude],
          bearing: pos.course,
          accuracy: pos.accuracy,
          fixTime: pos.fixTime,
          updateTime: pos.serverTime || pos.deviceTime,
          connectionType: pos.network?.radioType,
          signalLevel: pos.network?.cellTowers?.[0]?.signalStrength,
          mobileCountryCode: pos.network?.cellTowers?.[0]?.mobileCountryCode,
          mobileNetworkCode: pos.network?.cellTowers?.[0]?.mobileNetworkCode,
          address: pos.address,
          geofences: pos.geofenceIds 
        });

        // B. Update Map Markers
        const isOnline = device.status === "online";
        const isIgnitionOn = pos.attributes?.ignition;
        const markerColor = (isOnline && isIgnitionOn) ? "#57f491" : "#ffcbd1";

        if (deviceId in deviceMarkers) {
          // Update mapUpdate ref for specific map pan/zoom triggers
          mapUpdate.value = {
            id: deviceId, 
            latlon: [pos.latitude, pos.longitude],
            bearing: pos.course,
            color: markerColor,
          };
        } else {
          // It's NOT on the map yet, add to the buffer
          deviceMarkers[deviceId] = {
            latlon: [pos.latitude, pos.longitude],
            bearing: pos.course,
            label: device.name,
            color: markerColor,
            type: device.category
          };
          
          mapUpdate.value = {
            id: deviceId, 
            latlon: [pos.latitude, pos.longitude],
            bearing: pos.course,
            color: markerColor,
          };
        }
      });
    }
    loading.value = false
    console.log('Processed WebSocket Data:', data);
  }

  // --- COMPUTED PROPERTIES ---
  const deviceMarkerKeys = computed(() => {
    return Object.keys(deviceMarkers);
  });

  const deviceSelectedObject = computed(() => {
    if (deviceSelected.value == null || deviceSelected.value === false) {
      return null;
    } else if (deviceSelected.value in devices) { 
      return devices[deviceSelected.value];
    } else {
      return null;
    }
  });

  return {
    devices,
    geofences,
    loading,
    error,
    deviceMarkers,
    deviceMarkerKeys,
    deviceSelectedObject,
    deviceSelected,
    mapUpdate,
    draftPolygon, // <-- ADD THIS LINE
    activeRoute,
    fetchDevices,
    fetchGeofences,
    fetchAll,
    clearData
  };
});