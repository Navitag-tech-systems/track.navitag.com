import { Capacitor } from '@capacitor/core';
import { useInstallStore, INSTALL_TOAST_ENABLED } from '@/stores/install';

export async function registerPwa() {
  if (Capacitor.isNativePlatform()) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(r => r.unregister()))
        .catch(() => {});
    }
    return;
  }

  if (!('serviceWorker' in navigator)) return;

  // Mobile/tablet only: capture the install prompt event so we can either
  // (a) let Chrome's built-in mini-infobar surface during suppression, or
  // (b) render our own toast once INSTALL_TOAST_ENABLED is flipped on.
  // Desktop is intentionally excluded — Chrome/Edge's URL-bar mini-infobar
  // owns desktop self-install per PROPOSED_PWA.md resolved decisions.
  if (window.matchMedia('(pointer: coarse)').matches) {
    const installStore = useInstallStore();

    window.addEventListener('beforeinstallprompt', (e) => {
      // A fresh prompt arriving means the PWA is NOT currently installed
      // (Chrome suppresses this event for installed PWAs). Clear any stale
      // "installed" flag left over from a previous install + OS-level
      // uninstall — without this, the toast would stay hidden forever.
      if (installStore.installed) installStore.clearInstalled();

      if (INSTALL_TOAST_ENABLED) {
        // Re-enabled state: suppress Chrome's mini-infobar so our toast
        // owns the install promotion.
        e.preventDefault();
      }
      // Suppression state: do NOT preventDefault — Chrome shows its
      // mini-infobar naturally. We still stash the event for future
      // programmatic .prompt() if suppression is later flipped off
      // mid-session (rare; usually a fresh page load anyway).
      installStore.setDeferred(e);
    });

    window.addEventListener('appinstalled', () => {
      installStore.markInstalled();
    });
  }

  const { registerSW } = await import('virtual:pwa-register');
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) watchForUpdates(registration);
    },
  });
}

// The browser only re-checks sw.js on a navigation. An installed PWA that is
// resumed from the background (iOS/Android keep it in memory) never
// navigates, so it would keep running the old build. Check on every return to
// the foreground (and hourly while open); with registerType 'autoUpdate' a new
// build installs, activates and the page reloads into it — same as a cold open.
const UPDATE_MIN_GAP_MS = 60_000;
const UPDATE_INTERVAL_MS = 60 * 60_000;

export function watchForUpdates(registration) {
  let last = 0;
  const check = () => {
    if (navigator.onLine === false) return;
    const now = Date.now();
    if (now - last < UPDATE_MIN_GAP_MS) return;
    last = now;
    registration.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  // Restored from the back/forward cache: also no navigation fetch.
  window.addEventListener('pageshow', (e) => { if (e.persisted) check(); });
  setInterval(check, UPDATE_INTERVAL_MS);
}
