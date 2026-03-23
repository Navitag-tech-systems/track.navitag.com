import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { auth } from '@/firebase';
import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';

let isInitialized = false;

export const LifecycleService = {
  reconnectTimer: null, // Track the timer to prevent duplicates

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
        console.log('error')
        userStore.error = true;
      }
      return code;
    });

    auth.addListener('authStateChange', async (data) => {
      const firebaseUser = data.user;
      
      if (firebaseUser) {
        console.log('✅ Auth State: Logged In');
        await userStore.setUser(firebaseUser);
        await this.startSession(firebaseUser);
        } else {
        console.log('🛑 Auth State: Logged Out');
        this.stopSession();
      }
    });

    App.addListener('appStateChange', async ({ isActive }) => {
      console.log(`📱 App State Changed: ${isActive ? 'Active' : 'Background'}`);
      
      if(Capacitor.isNativePlatform() === false) return // only stop if native not web


      if (isActive) {
        if (userStore.isLoggedIn) {
          await this.checkConnectionAndReconnect();
        }
      } else {
        if (userStore.socket) {
          console.log('⏸️ Pausing: Closing WebSocket');
          // Use the safe disconnect so it doesn't trigger a reconnect while in background
          userStore.disconnectSocket(); 
        }
      }
    });

    Network.addListener('networkStatusChange', async (status) => {
      console.log(`📡 Network Status: ${status.connected ? 'Online' : 'Offline'}`);
      userStore.internet = status.connected;
      
      if (status.connected && userStore.isLoggedIn) {
        await this.checkConnectionAndReconnect();
      }
    });
  },

  async startSession(firebaseUser) {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    if (this.countryCodePromise) {
      await this.countryCodePromise;
    }

    const synced = await userStore.backendSync(); 
    if (!synced) {
      console.log('error')
      userStore.error = true;
      return; 
    }

    const connected = await userStore.serverConnect();
    if (!connected) {
      console.log('error')
      //userStore.error = true;
      return;
    } else {
      //Ge
    }

    const fetched = await deviceStore.fetchAll();
    if (!fetched) {
      console.log('error')
      userStore.error = true;
      return;
    }

    // Connect with the disconnect watcher attached
    userStore.connectSocket(
      deviceStore.processSocketData,
      () => this.handleSocketDisconnect()
    ); 
  },

  stopSession() {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();
    
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
    userStore.clearUser();
    deviceStore.clearData();
  },

  async checkConnectionAndReconnect() {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const sessionValid = await userStore.serverConnect(); 
    
    if (sessionValid) {
      const fetched = await deviceStore.fetchAll();
      if (!fetched) {
        userStore.error = true;
        return;
      }
      
      // Connect with the disconnect watcher attached
      userStore.connectSocket(
        deviceStore.processSocketData,
        () => this.handleSocketDisconnect()
      );
    } else {
      userStore.error = true;
    }
  },

  // --- NEW: Socket Error Watcher ---
  handleSocketDisconnect() {
    const userStore = useUserStore();
    
    // Do not attempt to reconnect if the user is logged out or the internet is completely offline
    if (!userStore.isLoggedIn || !userStore.internet) return;

    console.log('🔄 Socket dropped. Attempting to reconnect in 5 seconds...');
    
    // Clear any existing timer to prevent multiple reconnect attempts stacking up
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(async () => {
      console.log('🔄 Firing auto-reconnect sequence...');
      await this.checkConnectionAndReconnect();
    }, 5000); // 5 second backoff
  }
};