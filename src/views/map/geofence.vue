<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import { request } from '@/utils/http';
import { baseUrl } from '@/utils/variables';
import { LifecycleService } from '@/utils/lifecycle';

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

// The geofence→group link is no longer this view's problem. POST /v1/geofence
// creates and links in one atomic server-side step, and rolls the geofence back
// if the link fails — so the old create-then-retry-3× dance, and the orphan it
// left behind when it gave up, are both gone.

// One create attempt plus the shared success side-effects. Used by both the
// first attempt and the post-sync retry, so the two can never drift. Throws on
// a non-2xx (the caller decides whether to retry); navigates away on success.
const attemptCreate = async (pointsArray, createBody) => {
  // Send points, not WKT. The server is the only place that builds the
  // polygon string now, so the lat/lon axis order has one implementation
  // instead of the two that used to disagree with their own comments.
  const newGeofence = await request.send({
    url: `${baseUrl}/geofence`,
    method: 'POST',
    token: userStore.idToken,
    data: createBody,
  });

  // Optimistic store update so the shape is on the map before the refetch.
  // [lat, lng] — matching what fetchGeofences parses out of the WKT. This
  // used to write [lng, lat], drawing every newly-created geofence
  // transposed until the next session refresh corrected it.
  deviceStore.geofences[newGeofence.id] = {
    name: newGeofence.name,
    points: pointsArray.map(p => [p.lat, p.lng]),
  };

  LifecycleService.startSession();
  router.replace('/');
};

const saveGeofence = async (latLngs) => {
  if (isSaving.value) return;
  isSaving.value = true;
  deviceStore.loading = true
  try {
    // Leaflet polygons can be nested arrays depending on shape complexity.
    // Ensure we are working with a flat array of {lat, lng} objects.
    const pointsArray = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;
    const createBody = {
      name: geofenceName.value.trim(),
      points: pointsArray.map(p => [p.lat, p.lng]),
    };

    try {
      await attemptCreate(pointsArray, createBody);
    } catch (err) {
      // 409 { action: 'retry_after_sync' } is the account mid-provisioning:
      // server_group isn't set yet, so create was refused BEFORE anything was
      // created on Traccar (the guard runs first) — nothing to duplicate. A
      // fresh /user/sync heals the group server-side (CASE 3 self-heal), and
      // that only runs on sync, not on foreground resume — so telling the user
      // to relaunch was the only recovery. Re-sync once and retry the create
      // here instead. Bounded to one sync + one retry: a persistent
      // provisioning failure re-throws and drops through to the message.
      if (err?.status === 409 && (err.body || {}).action === 'retry_after_sync') {
        try {
          if (await userStore.backendSync()) {
            await attemptCreate(pointsArray, createBody);
            return; // healed and created — navigated away
          }
        } catch (retryErr) {
          console.error('Geofence create retry after sync failed:', retryErr);
        }
        alert('Your account is still being set up. Please close and reopen the app, then try again.');
        isSaving.value = false;
        return;
      }
      throw err; // anything else is handled by the terminal branch below
    }

  } catch (err) {
    console.error('Failed to save geofence:', err);

    // retry_after_sync is handled above; a 409 reaching here is the plan quota.
    if (err?.status === 409) {
      const body = err.body || {};
      alert(`You have used all ${body.geofence_limit ?? ''} geofences included in your ${body.tier ?? 'current'} plan. Delete one, or upgrade a device, to add another.`.replace(/\s+/g, ' '));
    } else if (err?.status === 400) {
      alert(err.message || 'That shape could not be saved. Try drawing it again.');
    } else {
      alert('Failed to save geofence. Please check your internet connection.');
    }
    isSaving.value = false;
  } finally {
    deviceStore.loading = false;
  }
};

// Listen for the poly-save event forwarded from App.vue
const unwatch = watch(() => deviceStore.draftPolygon, (data) => {
  if (data && step.value === 2) {
    // data[0] is the poly_id (should be 'new')
    // data[1] is the LatLngs array drawn by the user
    saveGeofence(data[1]);
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
        New Geofence
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
          @click="router.replace('/')"
          class="w-full text-gray-500 hover:text-gray-700 hover:bg-surface font-bold py-3 rounded-xl transition-colors text-sm"
        >
          Cancel
        </button>
      </div>
    </div>

    <div v-if="step === 2" class="mt-auto pointer-events-auto bg-white rounded-t-3xl shadow-[0_-10px_20px_rgba(0,0,0,0.05)] p-5 pb-8 z-10 text-center">
      <div v-if="isSaving" class="py-4">
        <i class="fa-solid fa-circle-notch fa-spin text-brand text-2xl mb-3"></i>
        <p class="text-sm font-bold text-gray-700">Saving to server...</p>
      </div>
      <div v-else>
        <h3 class="font-bold text-gray-800 mb-1">{{ geofenceName }}</h3>
        <p class="text-xs text-gray-500 mb-3 flex items-center justify-center gap-2">
          <i class="fa-solid fa-hand-pointer text-accent"></i> 
          Tap the map to draw your polygon boundaries.
        </p>
        <div class="bg-brand-light text-brand-dark text-xs px-3 py-2 rounded-lg inline-flex items-center gap-2 font-medium">
          <i class="fa-solid fa-check text-green-600"></i>
          Click the checkmark icon on the map to save.
        </div>
      </div>
    </div>

  </div>
</template>