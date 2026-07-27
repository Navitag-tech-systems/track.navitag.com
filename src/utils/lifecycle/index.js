import { useUserStore } from '@/stores/user';
import { useAppGateStore } from '@/stores/appGate';
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

    const userStore = useUserStore();
    session.countryCodePromise = userStore.fetchCountryCode().then(code => {
      if (!code) {
        console.error('❌ Country code required but unavailable after all retries');
        userStore.error = true;
      }
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
