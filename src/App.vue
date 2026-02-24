<script setup>
import { computed } from 'vue';
import { useRoute, RouterView } from 'vue-router';
import { useUserStore } from '@/stores/user-backup';
import { useDevicesStore } from './stores/devices-backup';
import BottomNav from './components/bottomNav.vue';
import Loading from '@/components/loading.vue';
import { getPlatformInfo, liqKey } from './utils/variables';
import { leafletMap } from '@burkaloo/leaflet-vue3'

const userStore = useUserStore();
const route = useRoute();
const deviceStore = useDevicesStore();

// Check if we are on the main map screen
const isMapRoute = computed(() => {
  if ('mapRoute' in route.meta) {
    return route.meta.mapRoute;
  }
  return false;
});

const showNav = computed(() => {
  let plat = getPlatformInfo(); // Evaluates platform logic
  return userStore.isLoggedIn && route.meta.requiresAuth === true;
});
</script>

<template>
  <div class="fixed top-0 left-0 right-0 h-safe-top bg-white z-50"></div>

  <div 
    class="flex flex-col h-dvh w-full pt-safe-top bg-gray-50"
    :class="{ 'pb-safe-bottom': !showNav }"
  >
    <Loading v-if="userStore.loading"/>

    <main 
      class="flex-1 w-full relative"
      :class="showNav ? 'pb-[calc(4rem+env(safe-area-inset-bottom))]' : ''"
    >
      <div 
        class="absolute inset-0 z-0 transition-opacity duration-300"
        :class="isMapRoute ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'"
      >
        <leafletMap 
          v-if="userStore.isLoggedIn && userStore.loading === false && deviceStore.loading === false"
          :mode="isMapRoute ? isMapRoute : 'track'" 
          :devices="deviceStore.deviceMarkers" 
          :geos="deviceStore.geofences"
          :liqkey="liqKey" 
          :route="deviceStore.activeRoute"
          tileLayer="liq"
          :deviceUpdate="deviceStore.mapUpdate"
          :activeId="deviceStore.deviceSelected === null ? null : deviceStore.deviceSelected+''"
          @poly-save="(data) => deviceStore.draftPolygon = data"
          @marker-select="(data) => deviceStore.deviceSelected = Array.isArray(data) ? +data[0]: +data"
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