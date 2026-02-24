<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';
import ky from 'ky';

const router = useRouter();
const userStore = useUserStore();
const deviceStore = useDevicesStore();

const geofenceName = ref('');
const step = ref(1);
const isSaving = ref(false);

// Clear any old draft data when opening this view
deviceStore.draftPolygon = null;

const nextStep = () => {
  if (!geofenceName.value.trim()) {
    alert('Please enter a name for the geofence.');
    return;
  }
  step.value = 2; // Proceed to map drawing
};

const saveToTraccar = async (latLngs) => {
  if (isSaving.value) return;
  isSaving.value = true;

  try {
    // Leaflet polygons can be nested arrays depending on shape complexity.
    // Ensure we are working with a flat array of {lat, lng} objects.
    const pointsArray = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;

    // --- CORRECTION START ---
    // Traccar WKT expects "LONGITUDE LATITUDE" (X Y order).
    // Original code was sending "LAT LON", which flips coordinates.
    let points = pointsArray.map(p => `${p.lat} ${p.lng}`);
    // --- CORRECTION END ---
    
    // Traccar WKT requires the polygon to be closed (first point == last point)
    // Leaflet often gives an open array, so we close it manually if needed.
    const first = points[0];
    const last = points[points.length - 1];
    if (first !== last) {
      points.push(first);
    }
    
    const areaString = `POLYGON ((${points.join(', ')}))`;

    // Save directly to Traccar API
    const newGeofence = await ky.post(`https://${userStore.server_url}/api/geofences`, {
      json: {
        name: geofenceName.value.trim(),
        area: areaString,
        description: '' // Optional description
      },
      credentials: 'include' // Important for Traccar JSESSIONID cookie
    }).json();

    // Update local Pinia store immediately to reflect changes on the map
    // Note: Store keeps [lat, lon] format for Leaflet, while Server gets WKT [lon, lat]
    const leafletPoints = pointsArray.map(p => [p.lat, p.lng]);

    deviceStore.geofences[newGeofence.id] = {
      name: newGeofence.name,
      points: leafletPoints
    };
    
    // Success! Redirect to the home map route
    router.replace('/');

  } catch (err) {
    console.error('Failed to save geofence:', err);
    alert('Failed to save geofence. Please check your internet connection.');
    isSaving.value = false;
  }
};

// Listen for the poly-save event forwarded from App.vue
const unwatch = watch(() => deviceStore.draftPolygon, (data) => {
  if (data && step.value === 2) {
    // data[0] is the poly_id (should be 'new')
    // data[1] is the LatLngs array drawn by the user
    saveToTraccar(data[1]);
  }
});

// Clean up watcher when leaving view
onUnmounted(() => {
  unwatch();
  deviceStore.draftPolygon = null;
});
</script>

<template>
  <div class="h-full flex flex-col justify-between pointer-events-none relative">
    
    <div class="pointer-events-auto bg-white/95 backdrop-blur-sm shadow-sm p-4 flex items-center safe-top z-10">
      <button 
        @click="router.back()" 
        class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none"
      >
        <i class="fa-solid fa-arrow-left text-lg"></i>
      </button>
      <h1 class="text-lg font-bold text-gray-800">
        {{ step === 1 ? 'New Geofence' : 'Drawing Geofence' }}
      </h1>
    </div>

    <div v-if="step === 1" class="absolute inset-0 z-20 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm pointer-events-auto">
      <div class="bg-white rounded-3xl shadow-xl p-6 w-full max-w-sm">
        <h2 class="text-xl font-bold text-gray-800 mb-2">Name your Geofence</h2>
        <p class="text-sm text-gray-500 mb-5">Give this boundary a recognizable name.</p>
        
        <div class="mb-6 relative">
          <i class="fa-solid fa-tag absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input 
            v-model="geofenceName"
            @keyup.enter="nextStep"
            type="text" 
            placeholder="e.g., Office Building, Home..." 
            class="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all outline-none"
          />
        </div>

        <button 
          @click="nextStep"
          class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex justify-center items-center gap-2 mb-2"
        >
          Continue to Map
          <i class="fa-solid fa-arrow-right"></i>
        </button>

        <button 
          @click="router.replace('/')"
          class="w-full text-gray-500 hover:text-gray-700 hover:bg-gray-50 font-bold py-3 rounded-xl transition-colors text-sm"
        >
          Cancel
        </button>
      </div>
    </div>

    <div v-if="step === 2" class="pointer-events-auto bg-white rounded-t-3xl shadow-[0_-10px_20px_rgba(0,0,0,0.05)] p-5 pb-8 z-10 text-center">
      <div v-if="isSaving" class="py-4">
        <i class="fa-solid fa-circle-notch fa-spin text-blue-500 text-2xl mb-3"></i>
        <p class="text-sm font-bold text-gray-700">Saving to server...</p>
      </div>
      <div v-else>
        <h3 class="font-bold text-gray-800 mb-1">{{ geofenceName }}</h3>
        <p class="text-xs text-gray-500 mb-3 flex items-center justify-center gap-2">
          <i class="fa-solid fa-hand-pointer text-blue-500"></i> 
          Tap the map to draw your polygon boundaries.
        </p>
        <div class="bg-blue-50 text-blue-700 text-xs px-3 py-2 rounded-lg inline-flex items-center gap-2 font-medium">
          <i class="fa-solid fa-check text-green-600"></i>
          Click the checkmark icon on the map to save.
        </div>
      </div>
    </div>

  </div>
</template>