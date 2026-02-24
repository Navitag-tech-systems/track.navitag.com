import { defineStore } from 'pinia';
import { ref, watch, computed, reactive } from 'vue';
import { useUserStore } from './user-backup';
import { useRouter } from 'vue-router';
import { CapacitorHttp } from '@capacitor/core';

export const useDevicesStore = defineStore('devices', () => {
  const userStore = useUserStore();

  const devices = reactive({});
  const geofences = reactive({}); 
  const loading = ref(false);
  const error = ref(null);
  const deviceSelected = ref(null);
  const mapUpdate = ref(null);
  const draftPolygon = ref(null); 
  const deviceMarkers = reactive({});
  const activeRoute = ref({ line: [], markers: {} });
  const router = useRouter();

  async function fetchDevices() {
    if (!userStore.server_url) return;
    try {
      const options = {
        url: `https://${userStore.server_url}/api/devices`,
        // Essential for Traccar to send/receive JSESSIONID on native platforms
        withCredentials: true, 
      };

      const response = await CapacitorHttp.get(options);
      const retArr = response.data;

      if (retArr.length < 1) {
        router.push('/linkdevice/teaser');
      }

      retArr.forEach(device => {
        devices[device.id] = device;
      });
    } catch (err) {
      console.error('Error fetching devices:', err);
      throw err;
    } finally {
      console.log('Fetched All Devices');
    }
  }

  async function fetchGeofences() {
    if (!userStore.server_url) return;
    try {
      const options = {
        url: `https://${userStore.server_url}/api/geofences`,
        withCredentials: true,
      };

      const response = await CapacitorHttp.get(options);
      const retArr = response.data;

      retArr.forEach(g => {
        let parsedPoints = [];

        if (g.area && g.area.startsWith('POLYGON')) {
          const coordsString = g.area.replace('POLYGON', '').replace(/[()]/g, '').trim();
          
          parsedPoints = coordsString.split(',').map(coord => {
            const [x, y] = coord.trim().split(/\s+/); 
            return [parseFloat(x), parseFloat(y)];
          });
        }

        geofences[g.id] = {
          name: g.name,
          points: parsedPoints
        };
      });
    } catch (err) {
      console.error('Error fetching geofences:', err);
      throw err;
    } finally {
      console.log('Fetched All Geofences');
    }
  }

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      await Promise.all([fetchDevices(), fetchGeofences()]);
      userStore.connectSocket(socketMsgCallback);  
      
    } catch (err) {
      error.value = err.message || 'Failed to fetch tracking data.';
    }
  }
  
  function clearData() {
    Object.keys(devices).forEach(key => delete devices[key]);
    Object.keys(deviceMarkers).forEach(key => delete deviceMarkers[key]);
    Object.keys(geofences).forEach(key => delete geofences[key]); 
    
    error.value = null;
    mapUpdate.value = null;
  }

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

  function socketMsgCallback(data) {
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
          mobileCountryCode: pos.network?.cellTowers?.[0]?.mobileCountryCode,
          mobileNetworkCode: pos.network?.cellTowers?.[0]?.mobileNetworkCode,
          address: pos.address,
          geofences: pos.geofenceIds,
          valid: pos.valid
        });

        const isOnline = device.status === "online";
        const isIgnitionOn = pos.attributes?.ignition;
        const markerColor = (isOnline && isIgnitionOn) ? "#57f491" : "#ffcbd1";

        if (deviceId in deviceMarkers) {
          mapUpdate.value = {
            id: deviceId, 
            latlon: [pos.latitude, pos.longitude],
            bearing: pos.course,
            color: markerColor,
          };
        } else {
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
    loading.value = false;
    console.log('Processed WebSocket Data:', data);
  }

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
    draftPolygon, 
    activeRoute,
    fetchDevices,
    fetchGeofences,
    fetchAll,
    clearData
  };
});