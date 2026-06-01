<script setup>
import { computed } from 'vue';
import { useRoute, useRouter, RouterView } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import { useInstallStore, INSTALL_TOAST_ENABLED } from '@/stores/install.js';
import { useToastStore } from '@/stores/toast.js';
import BottomNav from './components/bottomNav.vue';
import Loading from '@/components/loading.vue';
import Error from '@/components/error.vue';
import NoNet from './components/noNet.vue';
import { getPlatformInfo, liqKey } from './utils/variables';
import { leafletMap } from '@burkaloo/leaflet-vue3'
import { LifecycleService } from '@/utils/lifecycle'
import { Capacitor } from '@capacitor/core';

const PUSH_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const INSTALL_DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

const userStore = useUserStore();
const deviceStore = useDevicesStore();
const installStore = useInstallStore();
const toastStore = useToastStore();
const route = useRoute();
const router = useRouter();

function isInIframe() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

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
  if(deviceStore.loading || userStore.loading){
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
  const m = Array.isArray(mode) ? mode[0] : mode;
  // The map emits 'track' both when the user SAVES (checkmark) and CANCELS (X).
  // On save, poly-save has already set draftPolygon and the geofence view will
  // navigate itself — so only treat a 'track' switch as a cancel when there is
  // no pending draft. In that case leave the geofence view so its bottom sheet
  // doesn't linger (mirrors each view's own Cancel destination).
  if (m === 'track' && !deviceStore.draftPolygon) {
    if (route.path === '/addgeo') {
      router.replace('/');
    } else if (route.path.startsWith('/editgeo')) {
      router.replace('/list/geofences');
    }
  }
}

async function retryConnection() {
  userStore.error = false;
  await LifecycleService.checkConnectionAndReconnect();
}

// Returns 'install' | 'notification' | null. Prompt matrix:
//   Android/iOS browser (mobile/tablet): install toast only
//   Android/iOS installed PWA:           notification toast only
//   Anything else (desktop, other UAs):  neither
//   Native (Capacitor):                  neither (handled natively)
const currentToast = computed(() => {
  if (isInIframe()) return null;
  if (Capacitor.isNativePlatform()) return null;
  if (!userStore.isLoggedIn) return null;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const isMobileTouch = window.matchMedia('(pointer: coarse)').matches;
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMobileOS = isIOS || isAndroid;

  if (!isMobileOS || !isMobileTouch) return null;

  if (INSTALL_TOAST_ENABLED && !isStandalone) {
    const installDismissedAt = Number(
      localStorage.getItem('pwa_install_dismissed_at') || 0
    );
    if (
      installStore.deferred &&
      !installStore.resolvedThisSession &&
      !installStore.installed &&
      Date.now() - installDismissedAt >= INSTALL_DISMISS_COOLDOWN_MS
    ) {
      return 'install';
    }
  }

  // Notification toast only inside the installed PWA on Android/iOS mobile.
  // Project rule: notifications never on web (any browser context).
  if (!isStandalone) return null;
  if (!userStore.showPushEnableToast) return null;
  if (userStore.pushPermission !== 'prompt') return null;
  const pushDismissedAt = Number(localStorage.getItem('pwa_push_dismissed_at') || 0);
  if (Date.now() - pushDismissedAt < PUSH_DISMISS_COOLDOWN_MS) return null;
  return 'notification';
});

function dismissPushToast() {
  localStorage.setItem('pwa_push_dismissed_at', String(Date.now()));
  userStore.showPushEnableToast = false;
}

async function clickInstall() {
  if (!installStore.deferred) return;
  try {
    await installStore.deferred.prompt();
    await installStore.deferred.userChoice;
  } catch {
    // prompt() throws if the event has already been used; treat as resolved.
  }
  installStore.setDeferred(null);
  installStore.markResolved();
}

function dismissInstallToast() {
  try {
    localStorage.setItem('pwa_install_dismissed_at', String(Date.now()));
  } catch {}
  installStore.markResolved();
}

</script>

<template>
  <div class="fixed top-0 left-0 right-0 h-safe-top bg-white z-50"></div>

  <div 
    class="flex flex-col h-dvh w-full pt-safe-top bg-surface"
    :class="{ 'pb-safe-bottom': !showNav }"
  >
    <Loading v-if="masterLoading"/>
    <Error v-if="userStore.error"/>
    <NoNet v-if="!userStore.internet"/>

    <div
      v-if="currentToast === 'install'"
      class="fixed top-[calc(env(safe-area-inset-top)+12px)] left-4 right-4 z-50 bg-white shadow-lg rounded-lg p-4 flex items-center gap-3"
    >
      <span class="flex-1 text-sm text-slate-800">
        Install Navitag App
      </span>
      <button
        class="px-3 py-1 bg-blue-600 text-white rounded text-sm"
        @click="clickInstall"
      >
        Install
      </button>
      <button
        class="text-slate-500 hover:text-slate-700 cursor-pointer"
        aria-label="Dismiss"
        @click="dismissInstallToast"
      >
        <i class="fa-solid fa-xmark text-lg"></i>
      </button>
    </div>

    <div
      v-if="currentToast === 'notification'"
      class="fixed top-[calc(env(safe-area-inset-top)+12px)] left-4 right-4 z-50 bg-white shadow-lg rounded-lg p-4 flex items-center gap-3"
    >
      <span class="flex-1 text-sm text-slate-800">
        Enable notifications to receive device alerts.
      </span>
      <button
        class="px-3 py-1 bg-blue-600 text-white rounded text-sm"
        @click="userStore.enablePushFromGesture()"
      >
        Enable
      </button>
      <button class="text-slate-500 text-sm" @click="dismissPushToast">
        Dismiss
      </button>
    </div>

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

    <div
      v-if="toastStore.message"
      class="fixed left-4 right-4 z-50 shadow-lg rounded-lg p-3 flex items-center gap-3"
      :class="[
        showNav ? 'bottom-[calc(48px+env(safe-area-inset-bottom)+12px)]' : 'bottom-[calc(env(safe-area-inset-bottom)+12px)]',
        toastStore.variant === 'error' ? 'bg-red-600 text-white' :
        toastStore.variant === 'success' ? 'bg-green-600 text-white' :
        'bg-slate-800 text-white'
      ]"
      role="status"
    >
      <span class="flex-1 text-sm">{{ toastStore.message }}</span>
      <button
        class="text-white/80 hover:text-white cursor-pointer"
        aria-label="Dismiss"
        @click="toastStore.hide()"
      >
        <i class="fa-solid fa-xmark text-base"></i>
      </button>
    </div>

  </div>
</template>

<style>
/* No extra styles needed if Tailwind is handling everything */
</style>