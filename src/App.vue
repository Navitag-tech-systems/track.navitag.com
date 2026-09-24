<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, RouterView } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import { useInstallStore, INSTALL_TOAST_ENABLED } from '@/stores/install.js';
import { useToastStore } from '@/stores/toast.js';
import { useAppGateStore } from '@/stores/appGate.js';
import { useBootStore } from '@/stores/boot.js';
import { useUserLocationStore, SELF_MARKER_ID } from '@/stores/userLocation.js';
import BottomNav from './components/bottomNav.vue';
import Loading from '@/components/loading.vue';
import Error from '@/components/error.vue';
import NoNet from './components/noNet.vue';
import UpdateRequired from '@/components/updateRequired.vue';
import { getPlatformInfo, liqKey } from './utils/variables';
import { leafletMap } from '@burkaloo/leaflet-vue3'
import { Capacitor } from '@capacitor/core';

const PUSH_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const INSTALL_DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

const userStore = useUserStore();
const deviceStore = useDevicesStore();
const installStore = useInstallStore();
const toastStore = useToastStore();
const appGate = useAppGateStore();
const boot = useBootStore();
const userLocation = useUserLocationStore();
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

// COLD vs WARM.
//
// The dividing line is "has the app ever been fully up this login", which is
// NOT deviceStore.hasLoadedOnce — that flips as soon as the device list is
// known, while masterLoading stays true through the wait for the first
// position. Using it here would tear the splash away at ~85% and drop the user
// into an empty map, which is precisely the gap the splash exists to cover.
//
// So latch it explicitly: the first time masterLoading goes false while logged
// in AND holding real data. The hasLoadedOnce condition matters on the failure
// path — a fetch that threw releases masterLoading without ever producing
// data, and that must not count as "we've been up", or the retry would come
// back as a hairline bar over an empty list instead of a proper splash.
const hasRenderedOnce = ref(false);
watch(masterLoading, (busy) => {
  if (!busy && userStore.isLoggedIn && deviceStore.hasLoadedOnce) {
    hasRenderedOnce.value = true;
  }
});
// Logging out drops us back to nothing on screen; the next login is cold again.
watch(() => userStore.isLoggedIn, (loggedIn) => {
  if (!loggedIn) hasRenderedOnce.value = false;
});

// Gated on the BOOT RUN, not only on masterLoading.
//
// masterLoading is `deviceStore.loading || userStore.loading`, and neither is
// held across the whole boot: userStore.loading is a computed that is true only
// while `user.value === null` (so it drops the instant auth resolves), and
// deviceStore.loading is raised inside fetchAll(). Between serverConnect
// finishing and fetchAll starting, BOTH are false — so the cold splash
// unmounted and then remounted a beat later, fading out and back in over the
// empty app shell. Measured on a real sign-in: splash up at 58.9s, torn down at
// 62.44s, re-faded 0→1 by 62.64s, with the router view still empty behind it.
//
// boot.inProgress is exactly the right signal: it spans one run start to
// finish, which is what a splash is for. Kept AND-ed with isLoggedIn so the
// logged-out surfaces are untouched — on /login isLoggedIn is false, this falls
// back to masterLoading alone, and the sign-in form is never covered.
const showColdSplash = computed(() =>
  (masterLoading.value || (userStore.isLoggedIn && boot.inProgress)) && !hasRenderedOnce.value
);

// Driven by the boot run rather than masterLoading, so the bar spans the whole
// reconnect (including the serverConnect leg, where neither loading flag is
// necessarily set). The leave transition is what holds it visible at 100%.
//
// Not gated on mode === 'warm': this is the fallback for ANY boot run that
// isn't showing the cold splash, so a cold run that somehow starts with data
// already on screen still gets feedback instead of nothing at all.
const showWarmBar = computed(() => !showColdSplash.value && boot.inProgress);

const showNav = computed(() => {
  let plat = getPlatformInfo(); // Evaluates platform logic
  // The blocking overlays are listed explicitly rather than inferred from
  // masterLoading. That coupling was accidental — masterLoading happened to be
  // true during a failed reconnect (server_connect false), which is the only
  // reason the nav wasn't already painting on top of <Error />; it renders
  // later in the DOM at the same z-50. <NoNet /> never got that protection at
  // all. Both are now handled on purpose.
  if (showColdSplash.value) return false;
  if (userStore.error || !userStore.internet) return false;
  if (appGate.action === 'block') return false;
  return userStore.isLoggedIn && route.meta.requiresAuth === true && route.meta.activeTab !== false;
});

// The self-location marker rides in the same `devices` object as the trackers.
// @burkaloo/leaflet-vue3 has no notion of a user position, and its marker layer
// is keyed by whatever this object is keyed by — so one extra entry is the whole
// integration. SELF_MARKER_ID is non-numeric and the tracker keys are Traccar
// device ids, so they cannot collide.
const mapDevices = computed(() => (
  userLocation.marker
    ? { ...deviceStore.deviceMarkers, [SELF_MARKER_ID]: userLocation.marker }
    : deviceStore.deviceMarkers
));

// Since @burkaloo/leaflet-vue3 2.3.6 the map also MOVES existing markers from
// `devices` (a new object per entry is what it detects), so mapDevices above
// is the primary channel for both the trackers and the self marker. The
// `deviceUpdate` courier below is kept as the fallback for ≤ 2.3.5, where
// `devices` only created and destroyed markers; the package applies whichever
// of the two lands first and ignores the duplicate.
//
// Two writers, last-write-wins within a tick: if a socket frame and a GPS fix
// land in the same flush, one of the two courier moves is dropped — and on
// 2.3.6 the `devices` watcher still applies it, so nothing is lost.
const mapUpdate = ref(null);
watch(() => deviceStore.mapUpdate, (v) => { if (v) mapUpdate.value = v; });
watch(() => userLocation.marker, (m) => { if (m) mapUpdate.value = m; });

// Sign-out kills the watch. The toggle is never restored automatically — it
// starts off on every launch (see stores/userLocation.js) — so this exists only
// to stop a live watch when the session ends, rather than leaving GPS running
// behind the login screen with nothing on screen to justify it.
watch(() => userStore.isLoggedIn, (loggedIn) => {
  if (!loggedIn) userLocation.disable();
});

// The self marker is not a device: no store row, no bottom sheet. The package
// has already centred the map on it by the time this fires, so all that is left
// is to clear any device selection so its sheet does not linger over the marker
// the user just tapped. Real ids keep the original `+id` coercion, null
// included (+null === 0, which reads as "nothing selected" downstream).
function onMarkerSelect(data) {
  const raw = Array.isArray(data) ? data[0] : data;
  if (raw === SELF_MARKER_ID) {
    deviceStore.deviceSelected = null;
    return;
  }
  deviceStore.deviceSelected = +raw;
}

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

// Returns 'install' | 'notification' | null. Prompt matrix:
//   Android/iOS browser (mobile/tablet): install toast only
//   Android/iOS installed PWA:           notification toast only
//   Anything else (desktop, other UAs):  neither
//   Native (Capacitor):                  neither (handled natively)
const currentToast = computed(() => {
  // An update nudge outranks the install/notification prompts — they share the
  // same top slot, and being on a current build matters more than either.
  if (appGate.action === 'warn') return null;
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
    <!-- Hard version wall. Sits above every other overlay and offers no way
         out — see components/updateRequired.vue. -->
    <UpdateRequired v-if="appGate.action === 'block'"/>

    <Transition name="boot-fade">
      <Loading v-if="showColdSplash" variant="cold"/>
    </Transition>
    <Transition name="boot-fade">
      <Loading v-if="showWarmBar" variant="warm"/>
    </Transition>

    <Error v-if="userStore.error"/>
    <NoNet v-if="!userStore.internet"/>

    <div
      v-if="appGate.action === 'warn'"
      class="fixed top-[calc(env(safe-area-inset-top)+12px)] left-4 right-4 z-50 bg-white shadow-lg rounded-lg p-4 flex items-center gap-3"
    >
      <span class="flex-1 text-sm text-slate-800">
        {{ appGate.message || 'A new version of Navitag Track is available.' }}
      </span>
      <button
        class="px-3 py-1 bg-blue-600 text-white rounded text-sm"
        @click="appGate.openStore()"
      >
        Update
      </button>
      <button
        class="text-slate-500 hover:text-slate-700 cursor-pointer"
        aria-label="Dismiss"
        @click="appGate.dismissWarn()"
      >
        <i class="fa-solid fa-xmark text-lg"></i>
      </button>
    </div>

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
        <!-- Mounted on `hasLoadedOnce`, NOT on masterLoading. Gating on the
             latter tore the entire Leaflet instance down and rebuilt it — tiles,
             markers, geoman layers — on every foreground self-heal. It also
             delayed first mount until after the splash lifted; now the map
             initialises behind the splash, so tiles are already in flight by
             the time the user sees it. Safe to mount with an empty marker set:
             leafletMap watches its device key-set and creates markers as
             processSocketData populates them. -->
        <!-- FIRST MOUNT LATE, THEN STAY MOUNTED.
             The first mount still waits for masterLoading: hasLoadedOnce flips
             when the device LIST arrives, before any position, and leafletMap
             only fits bounds on a mode or `geos` change — so mounting earlier
             fitted an empty marker set and left the map at the package's
             default centre (Sheridan, WY) with the devices off-screen in
             Manila (reverted 2026-08-16). masterLoading stays true until the
             first socket frame, so the first mount has markers to fit to.
             After that the map is latched on hasRenderedOnce. It used to
             unmount on every reconnect (fetchAll raises `loading`), which
             threw away tiles, markers and the user's view, and redrew every
             marker from a stale deviceMarkers on remount. The warm reconnect
             no longer raises `loading` at all; this latch covers the retry
             paths that still do. -->
        <leafletMap
          v-if="userStore.isLoggedIn && (hasRenderedOnce || masterLoading === false)"
          :mode="isMapRoute ? isMapRoute : 'track'"
          :devices="mapDevices"
          :geos="activeGeofences"
          :liqkey="liqKey"
          :route="deviceStore.activeRoute"
          tileLayer="liq"
          :deviceUpdate="mapUpdate"
          :activeId="deviceStore.deviceSelected === null ? null : deviceStore.deviceSelected+''"
          @poly-save="(data) => deviceStore.draftPolygon = data"
          @marker-select="onMarkerSelect"
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
/* Boot surfaces fade out rather than popping. The leave transition is also what
   gives the "hold at 100%" beat: the bar has already snapped to 100 by the time
   the v-if flips, so it lingers there for the duration of the fade. */
.boot-fade-enter-active,
.boot-fade-leave-active {
  transition: opacity 260ms ease;
}
.boot-fade-enter-from,
.boot-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .boot-fade-enter-active,
  .boot-fade-leave-active {
    transition-duration: 1ms;
  }
}
</style>