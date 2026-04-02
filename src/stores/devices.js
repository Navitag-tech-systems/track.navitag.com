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
        }
        
        retArr.forEach(device => {
          devices[device.id] = device;
        });
      }
      const exps = await request.send({
        url: `${baseUrl}/user/device-expiration`,
        token: userStore.idToken
      });
      if(exps && exps.status =="success"){
        exps.message.forEach((el) => {
          devices[el.server_ref].expiration = el.expiration
        })
      } else{
        return false
      }
      

      // add logic to map and add expiration proprty to deviceStore.devices object

    } catch (err) {
      console.error('[Devices] Fetch failed:', err);
      throw err;
    }
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
      console.error('[Devices] fetchAll failed:', err);
      error.value = err.message || 'Failed to fetch tracking data.';
      return false; // Fetch failed
    }
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

  return {
    devices, geofences, loading, error, deviceMarkers, deviceMarkerKeys,
    deviceSelectedObject, deviceSelected, mapUpdate, draftPolygon, activeRoute,
    processSocketData, 
    fetchDevices, fetchGeofences, fetchAll, clearData
  };
});