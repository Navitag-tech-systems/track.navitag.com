import { useUserStore } from '@/stores/user';
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
