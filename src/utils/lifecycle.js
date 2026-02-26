import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { auth } from '@/firebase';
import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';

let isInitialized = false;

export const LifecycleService = {
  async init() {
    if (isInitialized) return;
    isInitialized = true;

    const userStore = useUserStore();

    userStore.internet = (await Network.getStatus()).connected // get initial network status

    console.log('🚀 Lifecycle Service Initialized');

    // 0. PRE-INIT: Fetch Country Code
    // We await this so that countryCode is available for backendSync when Auth listener fires
    await userStore.fetchCountryCode();

    // ADD if fail to get country code. reroute to error page with locaton

    // 1. AUTH LISTENER (The Entry Point)
    auth.addListener('authStateChange', async (data) => {
      const firebaseUser = data.user;
      
      if (firebaseUser) {
        console.log('✅ Auth State: Logged In');
        // A. Set User
        await userStore.setUser(firebaseUser);
        
        if (!firebaseUser.emailVerified) {
          // Optional: Handle verification logic
        }

        // B. Start The Data Sequence
        await this.startSession();
      } else {
        console.log('🛑 Auth State: Logged Out');
        this.stopSession();
      }
    });

    // 2. APP STATE LISTENER (Background/Foreground)
    App.addListener('appStateChange', async ({ isActive }) => {
      console.log(`📱 App State Changed: ${isActive ? 'Active' : 'Background'}`);
      
      if (isActive) {
        // Resume: Reconnect socket and refresh data if logged in
        if (userStore.isLoggedIn) {
          await this.checkConnectionAndReconnect();
        }
      } else {
        // Pause: Close socket to save battery, but keep data
        if (userStore.socket) {
          console.log('⏸️ Pausing: Closing WebSocket');
          userStore.socket.close();
        }
      }
    });

    // 3. NETWORK LISTENER (Offline/Online)
    Network.addListener('networkStatusChange', async (status) => {
      console.log(`📡 Network Status: ${status.connected ? 'Online' : 'Offline'}`);
      
      if (status.connected && userStore.isLoggedIn) {
        // Reconnect logic when internet comes back
        await this.checkConnectionAndReconnect();
      }
    });
  },

  /**
   * The "Happy Path" sequence to boot up the app data
   */
  async startSession() {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    // Step 1: Sync with Custom Backend (Get Traccar URL/Token)
    // This sends countryCode fetched in init()
    const synced = await userStore.backendSync(); 
    if (synced === false) return; // Explicit check for failure

    // Step 2: Connect to Traccar (Get Session ID)
    const connected = await userStore.serverConnect();
    if (!connected) return;

    // Step 3: Fetch Static Data (Devices, Geofences)
    await deviceStore.fetchAll();

    // Step 4: Connect Realtime Socket
    // We pass the processor from deviceStore to the connector in userStore
    userStore.connectSocket(deviceStore.processSocketData); // Ensure processSocketData is exposed in deviceStore
  },

  /**
   * Cleanup logic for Logout
   */
  stopSession() {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();
    
    userStore.clearUser();
    deviceStore.clearData();
  },

  /**
   * Smart Reconnect: Used on App Resume or Network Reconnect
   */
  async checkConnectionAndReconnect() {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    // 1. Ensure Session is valid
    const sessionValid = await userStore.serverConnect(); // Checks valid session or refreshes it

    
    if (sessionValid) {
      // 2. Refresh Data (in case things moved while backgrounded)
      await deviceStore.fetchAll();
      
      // 3. Re-establish Socket
      userStore.connectSocket(deviceStore.processSocketData);
    }
  }
};