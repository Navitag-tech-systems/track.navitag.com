import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { auth } from '@/firebase';
import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';
import router from '@/router';

let isInitialized = false;

export const LifecycleService = {
  reconnectTimer: null,
  isReconnecting: false, // Lock to prevent concurrent overlapping sequences
  isStartingSession: false, // Lock to prevent duplicate startSession calls

  init() {
    if (isInitialized) return;
    isInitialized = true;

    const userStore = useUserStore();

    Network.getStatus().then(status => {
      userStore.internet = status.connected;
    });

    console.log('🚀 Lifecycle Service Initialized');

    this.countryCodePromise = userStore.fetchCountryCode().then(code => {
      if (!code) {
        console.error('❌ Country code required but unavailable after all retries');
        userStore.error = true;
      }
      return code;
    });

    auth.addListener('authStateChange', async (data) => {
      const firebaseUser = data.user;

      if (firebaseUser) {
        console.log('✅ Auth State: Logged In');

        // Check for missing email BEFORE setUser so needsEmail is true
        // before user.value becomes truthy — prevents the loading overlay
        // from flashing over the collect-email view.
        if (!firebaseUser.email) {
          console.warn('⚠️ SSO user has no email — prompting for collection');
          userStore.needsEmail = true;
        }

        await userStore.setUser(firebaseUser);

        if (userStore.needsEmail) {
          userStore.error = false;
          router.replace('/collect-email');
          return;
        }

        const sessionStarted = await this.startSession();
        if (sessionStarted) {
          router.replace('/');
        }
      } else {
        console.log('🛑 Auth State: Logged Out');
        if (userStore.isLoggedIn) {
          this.stopSession();
        } else {
          // Clear any leftover Traccar session from a previous session
          userStore.traccarLogout().catch(() => {});
          userStore.clearUser();
          // Cold boot with no user — redirect to login only if on a protected route
          if (router.currentRoute.value.meta.requiresAuth) {
            router.replace('/login');
          }
        }
      }
    });

    auth.addListener('idTokenChange', async (data) => {
      if (data.user) {
        const result = await auth.getIdToken();
        userStore.idToken = result.token;
        console.log('🔑 ID Token refreshed');
      }
    });

    App.addListener('appStateChange', async ({ isActive }) => {
      console.log(`📱 App State Changed: ${isActive ? 'Active' : 'Background'}`);

      // Prevent running background socket logic on Web
      if (!Capacitor.isNativePlatform()) return;

      if (isActive) {
        if (userStore.isLoggedIn && !userStore.needsEmail) {
          await this.checkConnectionAndReconnect();
        }
      } else {
        if (userStore.socket) {
          console.log('⏸️ Pausing: Closing WebSocket');
          userStore.disconnectSocket();
        }
      }
    });

    Network.addListener('networkStatusChange', async (status) => {
      console.log(`📡 Network Status: ${status.connected ? 'Online' : 'Offline'}`);
      userStore.internet = status.connected;

      if (status.connected && userStore.isLoggedIn && !userStore.needsEmail) {
        await this.checkConnectionAndReconnect();
      }
    });
  },

  async startSession() {
    if (this.isStartingSession) return false;
    this.isStartingSession = true;

    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    if (userStore.needsEmail) {
      this.isStartingSession = false;
      return false;
    }

    try {
      if (this.countryCodePromise) {
        await this.countryCodePromise;
      }

      const synced = await userStore.backendSync();
      if (!synced) {
        // Retry once with a force-refreshed token before giving up
        console.warn('⚠️ Backend Sync Failed — retrying with fresh token...');
        const freshToken = await userStore.getFreshToken();
        const retried = freshToken ? await userStore.backendSync(freshToken) : false;
        if (!retried) {
          console.error('❌ Backend Sync Failed after retry');
          userStore.error = true;
          return false;
        }
      }

      const connected = await userStore.serverConnect();
      if (!connected) {
        console.error('❌ Server Connect Failed');
        userStore.error = true;
        return false;
      }

      // Fetch both stores in parallel to cut loading time in half
      const fetched = await deviceStore.fetchAll()

      if (fetched === 'no_devices') {
        // User has no linked devices — redirect already handled, stop the session chain
        return false;
      }

      if (!fetched) {
        console.error('❌ Failed to fetch devices or geofences');
        userStore.error = true;
        return false;
      }

      userStore.connectSocket(
        deviceStore.processSocketData,
        () => this.handleSocketDisconnect()
      );

      return true;
    } finally {
      this.isStartingSession = false;
    }
  },

  async stopSession() {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    userStore.disconnectSocket();
    await userStore.traccarLogout();
    userStore.clearUser();
    deviceStore.clearData();
    this.isReconnecting = false;
    this.isStartingSession = false;
    console.log('logout');
    router.replace('/login');
  },

  async checkConnectionAndReconnect() {
    if (this.isReconnecting) return;

    const userStore = useUserStore();
    if (userStore.needsEmail || !userStore.server_url) return;

    this.isReconnecting = true;
    const deviceStore = useDevicesStore();

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    try {
      const sessionValid = await userStore.serverConnect(); 
      
      if (sessionValid) {
        const fetched = await deviceStore.fetchAll()

        if (!fetched) {
          console.error('❌ Failed to fetch devices or geofences');
          userStore.error = true;
          return;
        }
        
        userStore.connectSocket(
          deviceStore.processSocketData,
          () => this.handleSocketDisconnect()
        );
      } else {
        userStore.error = true;
      }
    } finally {
      this.isReconnecting = false;
    }
  },

  async reloadAndReconnect() {
    if (this.isReconnecting) {
      console.warn('⚠️ Reconnect already in progress. Ignoring manual reload.');
      return;
    }
    this.isReconnecting = true;

    const userStore = useUserStore();
    const deviceStore = useDevicesStore();
    

    console.log('🔄 Initiating manual data reload and socket cycle...');

    try {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

      if (userStore.socket) {
        console.log('🔌 Disconnecting current socket...');
        userStore.disconnectSocket();
      }

      console.log('📥 Fetching latest devices and geofences...');
      // Fetch both stores in parallel to cut loading time in half
      const fetched = await deviceStore.fetchAll()

      if (!fetched) {
        console.error('❌ Failed to fetch devices or geofences');
        userStore.error = true;
        return;
      }

      console.log('🔌 Reconnecting socket...');
      userStore.connectSocket(
        deviceStore.processSocketData,
        () => this.handleSocketDisconnect()
      );

      console.log('✅ Data reloaded and socket reconnected successfully!');

    } catch (error) {
      console.error('❌ Error during reload and reconnect sequence:', error);
      userStore.error = true;
    } finally {
      this.isReconnecting = false;
    }
  },

  handleSocketDisconnect() {
    const userStore = useUserStore();
    
    if (!userStore.isLoggedIn || !userStore.internet) return;

    console.log('🔄 Socket dropped. Attempting to reconnect in 5 seconds...');
    
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(async () => {
      console.log('🔄 Firing auto-reconnect sequence...');
      await this.checkConnectionAndReconnect();
    }, 5000); 
  }
};