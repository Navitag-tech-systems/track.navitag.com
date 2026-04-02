<script setup>
import { computed } from 'vue';
import { useRoute, RouterView } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import { useCartStore } from '@/stores/cart.js';
import BottomNav from './components/bottomNav.vue';
import Loading from '@/components/loading.vue';
import Error from '@/components/error.vue';
import NoNet from './components/noNet.vue';
import { getPlatformInfo, liqKey } from './utils/variables';
import { leafletMap } from '@burkaloo/leaflet-vue3'
import { LifecycleService } from '@/utils/lifecycle'

const userStore = useUserStore();
const deviceStore = useDevicesStore();
const route = useRoute();
const cartStore = useCartStore()

// Check if we are on the main map screen
const isMapRoute = computed(() => {
  // If the meta flag is strictly the boolean true (using your idea)
  if (route.meta.mapRoute === true) {
    // If you literally named the route parameter :mapProp
    if (route.params.mode) {
      return route.params.mode;
    }
  }

  // Fallback: If mapRoute is a string (like 'track' or 'geo-new')
  if (typeof route.meta.mapRoute === 'string') {
    return route.meta.mapRoute;
  }

  return false;
});

const masterLoading = computed(() => {
  if(deviceStore.loading || userStore.loading || cartStore.loading){
    return true
  } else {
    return false
  }
})

const showNav = computed(() => {
  let plat = getPlatformInfo(); // Evaluates platform logic
  return masterLoading.value === false && userStore.isLoggedIn && route.meta.requiresAuth === true && route.meta.activeTab !== false;
});

const activeGeofences = computed(() => {
  return { ...deviceStore.geofences };
});

function trackMapMode(mode){
  console.log('mode', mode[0])
}

async function retryConnection() {
  userStore.error = false;
  await LifecycleService.checkConnectionAndReconnect();
}

</script>

<template>
  <div class="fixed top-0 left-0 right-0 h-safe-top bg-white z-50"></div>

  <div 
    class="flex flex-col h-dvh w-full pt-safe-top bg-gray-50"
    :class="{ 'pb-safe-bottom': !showNav }"
  >
    <Loading v-if="masterLoading"/>
    <Error v-if="userStore.error">
      <template #action>
        <button
          @click="retryConnection"
          class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-colors outline-none cursor-pointer"
        >
          Retry
        </button>
      </template>
    </Error>
    <NoNet v-if="!userStore.internet"/>

    <main 
      class="flex-1 w-full relative"
      :class="showNav ? 'pb-[calc(48px+env(safe-area-inset-bottom))]' : ''"
    >
      <div 
        class="absolute inset-0 z-0 transition-opacity duration-300"
        :class="isMapRoute ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'"
      >
        <leafletMap 
          v-if="userStore.isLoggedIn && masterLoading === false"
          :mode="isMapRoute ? isMapRoute : 'track'" 
          :devices="deviceStore.deviceMarkers" 
          :geos="activeGeofences"
          :liqkey="liqKey" 
          :route="deviceStore.activeRoute"
          tileLayer="liq"
          :deviceUpdate="deviceStore.mapUpdate"
          :activeId="deviceStore.deviceSelected === null ? null : deviceStore.deviceSelected+''"
          @poly-save="(data) => deviceStore.draftPolygon = data"
          @marker-select="(data) => deviceStore.deviceSelected = Array.isArray(data) ? +data[0]: +data"
          @mode-change="trackMapMode"
        />
      </div>

      <div 
        class="relative z-10 w-full h-full overflow-y-auto"
        :class="isMapRoute ? 'pointer-events-none' : 'pointer-events-auto'"
      >
        <RouterView />  
      </div>
    </main>

    <BottomNav v-if="showNav" class="z-50" />

  </div>
</template>

<style>
/* No extra styles needed if Tailwind is handling everything */
</style>