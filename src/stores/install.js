import { defineStore } from 'pinia';
import { ref } from 'vue';

// When true, render our custom install toast (Phase 4/7). When false,
// Chrome's built-in mini-infobar surfaces naturally on mobile because the
// beforeinstallprompt listener does NOT preventDefault during suppression.
// See PROPOSED_PWA.md resolved decisions block. Re-enable later by flipping
// to true; no other migration needed.
export const INSTALL_TOAST_ENABLED = false;

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

  function markResolved() {
    resolvedThisSession.value = true;
  }

  return {
    deferred,
    installed,
    resolvedThisSession,
    setDeferred,
    markInstalled,
    markResolved,
  };
});
