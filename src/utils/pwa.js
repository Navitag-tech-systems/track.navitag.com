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

  // First-deploy gate: until the SW is verified cleanly registering /
  // updating / unregistering in production, only sessions arriving with
  // ?pwa=1 get the SW. Remove the next two lines in the follow-up deploy
  // once verified. See PROPOSED_PWA.md §9.2.
  const params = new URLSearchParams(window.location.search);
  if (!params.has('pwa')) return;

  // Mobile/tablet only: capture the install prompt event so we can either
  // (a) let Chrome's built-in mini-infobar surface during suppression, or
  // (b) render our own toast once INSTALL_TOAST_ENABLED is flipped on.
  // Desktop is intentionally excluded — Chrome/Edge's URL-bar mini-infobar
  // owns desktop self-install per PROPOSED_PWA.md resolved decisions.
  if (window.matchMedia('(pointer: coarse)').matches) {
    const installStore = useInstallStore();

    window.addEventListener('beforeinstallprompt', (e) => {
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
  registerSW({ immediate: true });
}
