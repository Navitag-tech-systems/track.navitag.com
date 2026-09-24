import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { useToastStore } from '@/stores/toast.js';

// The phone's OWN position, for the "show me on the map" toggle in the map
// search bar. It is drawn as one marker and never leaves the device — nothing
// here POSTs a coordinate, and that is what keeps the App Privacy answer
// ("not collected") and the Play data-safety form honest. Anything that starts
// transmitting it has to revisit both.

// The marker id handed to the map. It is merged into the same `devices` object
// the tracker markers live in (App.vue), whose keys are numeric Traccar device
// ids — a non-numeric key cannot collide with one. It also cannot be selected
// like a real device: App.vue drops a marker-select whose id is not numeric.
export const SELF_MARKER_ID = 'me';

// NOT PERSISTED, ON PURPOSE. Every launch starts with the marker off and the
// GPS silent; showing your own position is an explicit, per-session choice.
// Restoring it from storage would mean an app that reads location on boot
// because of a tap the user may not remember making.

// Blue, so it reads as "you" against the tracker palette (#ff0000 alarm,
// #57f491 online, #d1d5db offline — see markerColor in stores/devices.js).
// 'circle' is the package's default glyph — a plain
// bubble, deliberately not a vehicle or person shape, so it reads as a position
// rather than as another tracked asset.
const SELF_MARKER_COLOR = '#0076f5'; // --color-brand
const SELF_MARKER_TYPE = 'circle';
const SELF_MARKER_LABEL = 'Me';

export const useUserLocationStore = defineStore('userLocation', () => {
  const enabled = ref(false);
  const position = ref(null); // { latlon: [lat, lng], accuracy, heading }
  const requesting = ref(false);

  // Native uses the Capacitor plugin; web/PWA uses the browser API directly.
  // The plugin's web implementation wraps the same navigator.geolocation, but
  // going through it on web would mean shipping the plugin's web bundle for no
  // gain — and the permission UX is the browser's either way.
  const isNative = Capacitor.isNativePlatform();
  let watchId = null;

  // Shape expected by @burkaloo/leaflet-vue3's `devices` prop.
  //
  // `bearing` is always a number, never null: the package coerces a missing
  // bearing to 0 in BOTH the key-set watcher and updateMarkerOptions
  // (`next.bearing ?? 0`), so there is no way from out here to suppress the
  // direction pointer. Feeding it the real compass heading when the OS supplies
  // one at least makes the arrow truthful; heading is null whenever the device
  // is stationary or has no compass, and it then points north. Suppressing it
  // properly needs a package change (a `bearing: null` that survives).
  const marker = computed(() => {
    if (!enabled.value || !position.value) return null;
    return {
      id: SELF_MARKER_ID,
      latlon: position.value.latlon,
      bearing: position.value.heading ?? 0,
      color: SELF_MARKER_COLOR,
      label: SELF_MARKER_LABEL,
      type: SELF_MARKER_TYPE,
    };
  });

  function applyPosition(pos) {
    const c = pos?.coords;
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
    const heading = Number.isFinite(c.heading) ? c.heading : null;
    position.value = {
      latlon: [c.latitude, c.longitude],
      accuracy: c.accuracy ?? null,
      heading,
    };
  }

  // One message for every way this can fail. The browser and the plugin both
  // report a denied permission as code 1 / PERMISSION_DENIED; a denial is the
  // only case worth a distinct instruction, because the user has to go to
  // settings and we cannot re-prompt.
  function reportError(err) {
    const toast = useToastStore();
    const denied =
      err?.code === 1 ||
      /denied|permission/i.test(err?.message || '');
    toast.show(
      denied
        ? 'Location permission is off. Enable it in your device settings to show your position.'
        : 'Could not get your location.',
      { variant: 'error' }
    );
  }

  // Position refresh cadence — Google Maps' browsing-grade rate. Only Android
  // honours it: iOS is distance-driven and web fires on whatever the OS reports.
  const WATCH_INTERVAL_MS = 3000;

  async function startWatch() {
    if (isNative) {
      watchId = await Geolocation.watchPosition(
        // interval / minimumUpdateInterval are ANDROID-ONLY (ignored on iOS and
        // web, which have no rate knob). Set explicitly because the defaults are
        // slower than they look: interval falls back to `timeout` (15s) and the
        // floor to 5s, so an unconfigured watch drifts noticeably behind.
        {
          enableHighAccuracy: true,
          timeout: 15000,
          interval: WATCH_INTERVAL_MS,
          minimumUpdateInterval: WATCH_INTERVAL_MS,
        },
        (pos, err) => {
          // The plugin delivers BOTH results through this one callback; a
          // thrown error never surfaces, so an err here has to be handled or
          // a revoked permission mid-session goes silent.
          if (err) { reportError(err); disable(); return; }
          applyPosition(pos);
        }
      );
    } else {
      watchId = navigator.geolocation.watchPosition(
        applyPosition,
        (err) => { reportError(err); disable(); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    }
  }

  function stopWatch() {
    if (watchId === null) return;
    try {
      if (isNative) Geolocation.clearWatch({ id: watchId });
      else navigator.geolocation.clearWatch(watchId);
    } catch {}
    watchId = null;
  }

  async function enable() {
    if (enabled.value || requesting.value) return;

    if (!isNative && !navigator.geolocation) {
      useToastStore().show('This device cannot report its location.', { variant: 'error' });
      return;
    }

    requesting.value = true;
    try {
      if (isNative) {
        // requestPermissions() is what actually shows the OS dialog. Check
        // first so an already-granted session skips straight through.
        let status = await Geolocation.checkPermissions();
        if (status.location !== 'granted') {
          status = await Geolocation.requestPermissions({ permissions: ['location'] });
        }
        if (status.location !== 'granted') {
          reportError({ code: 1 });
          return;
        }
      }

      // A single fix first: watchPosition can take several seconds to produce
      // its first callback, and the marker appearing only after that reads as
      // a dead button.
      const first = isNative
        ? await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
        : await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 30000,
            })
          );
      applyPosition(first);

      enabled.value = true;
      await startWatch();
    } catch (err) {
      reportError(err);
    } finally {
      requesting.value = false;
    }
  }

  function disable() {
    stopWatch();
    enabled.value = false;
    position.value = null;
  }

  function toggle() {
    return enabled.value ? disable() : enable();
  }

  // WHEN-IN-USE MEANS WHEN IN USE. Neither platform is set up to deliver
  // background positions (no ACCESS_BACKGROUND_LOCATION, no location background
  // mode), so the OS would suspend the watch on its own — but a registered
  // watch that the OS is merely ignoring is not the same claim as no watch at
  // all, and on web nothing suspends it. Drop the watch on background and take
  // it back on foreground.
  //
  // `enabled` deliberately survives: the toggle stays lit and the marker stays
  // at its last known position, so returning to the app does not look like the
  // feature turned itself off.
  function suspend() {
    if (!enabled.value) return;
    stopWatch();
  }

  async function resumeFromBackground() {
    if (!enabled.value || watchId !== null) return;
    try {
      await startWatch();
    } catch (err) {
      reportError(err);
      disable();
    }
  }

  return {
    enabled, position, requesting, marker,
    enable, disable, toggle, suspend, resumeFromBackground,
  };
});
