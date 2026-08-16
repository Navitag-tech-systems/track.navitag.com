import { useUserStore } from '@/stores/user';
import { useAppGateStore } from '@/stores/appGate';
import { useBootStore } from '@/stores/boot';
import { session } from './session';
import { registerAuthListeners } from './listeners/auth';
import { registerAppStateListener } from './listeners/appState';
import { registerNetworkListener } from './listeners/network';

let isInitialized = false;

export const LifecycleService = {
  init() {
    if (isInitialized) return;
    isInitialized = true;

    console.log('🚀 Lifecycle Service Initialized');

    // Version gate, first and unawaited.
    //
    // BEFORE the auth listeners on purpose: once a build is blocked, its login
    // and token refresh fail with an opaque backend error, and whichever of the
    // two resolves first is what the user sees. The gate has to be in flight
    // before auth can produce that error, or the wall loses the race to a
    // meaningless "sign-in failed".
    //
    // Not awaited, because boot must not wait on the network — the store starts
    // at 'ok' and only ever escalates once a verdict actually arrives.
    useAppGateStore().check();

    // Open the cold-boot progress run. Both steps below are already in flight
    // by the time the first frame paints, so the bar starts moving immediately
    // rather than sitting at 0 through Firebase's auth restore.
    const boot = useBootStore();
    boot.reset('cold');
    boot.begin('auth');
    boot.begin('region');

    const userStore = useUserStore();
    session.countryCodePromise = userStore.fetchCountryCode().then(code => {
      if (!code) {
        // NOT a dead end. This used to set userStore.error = true, which raised
        // the non-recoverable <Error /> screen ("refresh the page or restart the
        // app") before the user had even signed in — locking them out of login
        // and signup because Cloudflare's trace endpoint was unreachable.
        //
        // The country code has exactly one hard consumer: /user/sync, which uses
        // it to assign a Traccar server to a NEW account. An existing user's
        // server_url does not depend on it, and signup carries a manual country
        // picker (views/signup/index.vue) as the fallback. So a failure here is
        // recorded and carried forward — startSession decides what it means, at
        // the point where it actually matters.
        console.error('❌ Country lookup failed after all retries — continuing without it');
      }
      boot.done('region', { degraded: !code });
      return code;
    });

    registerAuthListeners(session);
    registerAppStateListener(session);
    registerNetworkListener(session);
  },

  startSession: (...args) => session.startSession(...args),
  stopSession: (...args) => session.stopSession(...args),
  checkConnectionAndReconnect: (...args) => session.checkConnectionAndReconnect(...args),
  reloadAndReconnect: (...args) => session.reloadAndReconnect(...args),
};
