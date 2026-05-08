import { defineStore } from 'pinia';
import { ref } from 'vue';

// Kill switch for our custom install toast. When true, the toast owns the
// install promotion on mobile/tablet web and we preventDefault the browser's
// mini-infobar. When false, Chrome's built-in infobar surfaces naturally
// because the beforeinstallprompt listener does NOT preventDefault. Flip to
// false to disable the toast without code changes (e.g., during incidents).
export const INSTALL_TOAST_ENABLED = true;

export const useInstallStore = defineStore('install', () => {
  const deferred = ref(null);
  const installed = ref(
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('pwa_installed') === 'true'
  );
  const resolvedThisSession = ref(false);

  function setDeferred(event) {
    deferred.value = event;
  }

  function markInstalled() {
    installed.value = true;
    deferred.value = null;
    resolvedThisSession.value = true;
    try {
      localStorage.setItem('pwa_installed', 'true');
    } catch {}
  }

  // Called when a fresh beforeinstallprompt arrives — that event only fires
  // for non-installed PWAs, so a stale "installed" flag (e.g., user uninstalled
  // the PWA at the OS level, leaving our localStorage flag behind) must be
  // cleared. Without this, the install toast would never show after reinstall.
  function clearInstalled() {
    installed.value = false;
    try {
      localStorage.removeItem('pwa_installed');
    } catch {}
  }

  function markResolved() {
    resolvedThisSession.value = true;
  }

  return {
    deferred,
    installed,
    resolvedThisSession,
    setDeferred,
    markInstalled,
    clearInstalled,
    markResolved,
  };
});
