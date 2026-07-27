<script setup>
import { ref, watch, onUnmounted, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import { request } from '@/utils/http.js'
import { baseUrl } from '@/utils/variables';
import InlineLoader from '@/components/InlineLoader.vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const deviceStore = useDevicesStore();

const geoid = route.params.id;
const geofenceName = ref('');
const step = ref(1);
const isSaving = ref(false);

// Pre-load existing geofence
onMounted(() => {
  deviceStore.draftPolygon = null;
  const existingGeo = deviceStore.geofences[geoid];
  
  if (existingGeo) {
    geofenceName.value = existingGeo.name;
  } else {
    // Failsafe if accessed directly without data
    router.replace('/list/geofences');
  }
});

const nextStep = () => {
  if (!geofenceName.value.trim()) {
    alert('Please enter a name for the geofence.');
    return;
  }
  step.value = 2; // Proceed to map drawing
};

const updateToTraccar = async (latLngs) => {
  if (isSaving.value) return;
  isSaving.value = true;
  // Deliberately does NOT touch deviceStore.loading. That flag raises the
  // global boot splash, and this function set it true on entry with no
  // matching false on ANY path — so a rejected edit (the 400/404 branch below)
  // dismissed its alert straight onto a permanent full-screen splash. The
  // `isSaving` sheet spinner in the template is the correct, scoped feedback.
  try {
    const pointsArray = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;

    // Points, not WKT — the server builds the polygon string (one axis-order
    // implementation instead of two). It also merges onto the authoritative
    // Traccar record, so `description` / `calendarId` / `attributes` survive
    // an edit; this used to PUT a 3-field object and silently clear them.
    await request.send({
      url: `${baseUrl}/geofence/${geoid}`,
      method: 'PUT',
      token: userStore.idToken,
      data: {
        name: geofenceName.value.trim(),
        points: pointsArray.map(p => [p.lat, p.lng]),
      },
    })

    // Refetch just the geofences. This used to call
    // LifecycleService.startSession(), which re-ran the ENTIRE boot pipeline —
    // /user/sync, Traccar reconnect, full device fetch, socket cycle — to pick
    // up one edited polygon.
    deviceStore.fetchGeofences().catch(err => {
      console.warn('Geofence refetch after edit failed:', err?.message || err);
    });

    // Success! Update local Pinia store
    router.replace('/');

  } catch (err) {
    console.error('Failed to update geofence:', err);
    isSaving.value = false;

    // A rejected shape or name is the user's to fix, not a dead end — the
    // global error screen would strand them with no way back to the drawing.
    if (err?.status === 400 || err?.status === 404) {
      alert(err.message || 'That geofence could not be updated.');
      return;
    }

    // Trigger global dead-end error
    userStore.error = true;
  }
};

// Listen for the poly-save event forwarded from App.vue
const unwatch = watch(() => deviceStore.draftPolygon, (data) => {
  if (data && step.value === 2) {
    // data[0] is the poly_id, data[1] is the LatLngs array drawn
    updateToTraccar(data[1]);
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
    
    <div v-if="step === 1" class="pointer-events-auto bg-white/95 backdrop-blur-sm shadow-sm p-4 flex items-center safe-top z-10">
      <button
        @click="router.back()"
        class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none"
      >
        <i class="fa-solid fa-arrow-left text-lg"></i>
      </button>
      <h1 class="text-lg font-bold text-gray-800">
        Edit Geofence
      </h1>
    </div>

    <div v-if="step === 1" class="absolute inset-0 z-20 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm pointer-events-auto">
      <div class="bg-white rounded-3xl shadow-xl p-6 w-full max-w-sm">
        <h2 class="text-xl font-bold text-gray-800 mb-2">Edit Geofence Name</h2>
        <p class="text-sm text-gray-500 mb-5">Update the name of this boundary.</p>
        
        <div class="mb-6 relative">
          <i class="fa-solid fa-tag absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input 
            v-model="geofenceName"
            @keyup.enter="nextStep"
            type="text" 
            placeholder="e.g., Office Building, Home..." 
            class="w-full pl-11 pr-4 py-3 bg-surface border border-gray-200 rounded-xl text-sm focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none"
          />
        </div>

        <button 
          @click="nextStep"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex justify-center items-center gap-2 mb-2"
        >
          Continue to Map
          <i class="fa-solid fa-arrow-right"></i>
        </button>

        <button 
          @click="router.replace('/list/geofences')"
          class="w-full text-gray-500 hover:text-gray-700 hover:bg-surface font-bold py-3 rounded-xl transition-colors text-sm"
        >
          Cancel
        </button>
      </div>
    </div>

    <div v-if="step === 2" class="mt-auto pointer-events-auto bg-white rounded-t-3xl shadow-[0_-10px_20px_rgba(0,0,0,0.05)] p-5 pb-8 z-10 text-center">
      <div v-if="isSaving" class="py-4">
        <InlineLoader size="2xl" class="text-brand mb-3" />
        <p class="text-sm font-bold text-gray-700">Saving…</p>
      </div>
      <div v-else>
        <h3 class="font-bold text-gray-800 mb-1">{{ geofenceName }}</h3>
        <p class="text-xs text-gray-500 mb-3 flex items-center justify-center gap-2">
          <i class="fa-solid fa-hand-pointer text-accent"></i> 
          Tap and drag the map boundaries to edit.
        </p>
        <div class="bg-brand-light text-brand-dark text-xs px-3 py-2 rounded-lg items-center gap-2 font-medium">
          <i class="fa-solid fa-check text-grey-800"></i>
          Click the checkmark icon on the map to save.
        </div>
        <div class="bg-red-50 text-brand-dark text-xs px-3 py-2 mt-3 rounded-lg items-center gap-2 font-medium">
          <i class="fa-solid fa-xmark text-grey-600"></i>
          Click the X icon on the map to cancel.
        </div>
      </div>
    </div>

  </div>
</template>