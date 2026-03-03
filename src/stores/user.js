import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Capacitor } from '@capacitor/core'; 
import { setUserId } from '@/utils/analytics';
import { baseUrl } from '@/utils/variables';
import { auth } from '@/firebase'; 
import { request } from '@/utils/http'; 
import { useRouter } from 'vue-router'

export const useUserStore = defineStore('user', () => {
  // State
  const user = ref(null);
  const idToken = ref(null);
  const fcmToken = ref(null);
  const countryCode = ref(null);
  const name = ref(null);
  const phone = ref(null);
  const server_url = ref(null); 
  const server_token = ref(null);
  const server_connect = ref(false);
  const socket = shallowRef(null);
  const router = useRouter()

  
  const error = ref(false); // assume theres no error
  const internet = ref(true); // assume theres internet
  
  const isLoggedIn = computed(() => user.value !== null && user.value !== false);

  const loading = computed(() => {
    if (user.value === null) {
      return true;
    } else if (user.value === false) { 
      return countryCode.value === null; 
    } else {
      return !server_connect.value;
    }
  });

  // --- ACTION: Fetch Country Code ---
  async function fetchCountryCode() {
    const token = 'f1b39e92820d53';
    console.log('🌍 Fetching Country Code...');
    
    try {
      // Step 1: Get IP
      const ipData = await request.send({
        url: 'https://api.ipify.org?format=json',
        simple: true 
      });
      
      if (ipData && ipData.ip) {
        // Step 2: Get Country Info
        const countryData = await request.send({
          url: `https://api.ipinfo.io/lite/${ipData.ip}?token=${token}`,
          simple: true
        });

        if (countryData && countryData.country_code) {
          countryCode.value = countryData.country_code;
          console.log('✅ Country Code Detected:', countryCode.value);
          return countryCode.value;
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to retrieve location data:', error);
    }
    
    // FALLBACK: If IP lookup fails, assign an empty string so the `loading` 
    // computed property evaluates to false and unlocks the Login screen.
    if (countryCode.value === null) {
      countryCode.value = 'Unknown';
    }
    
    return null;
  }

  async function initPushNotifications() {
    const platform = Capacitor.getPlatform();
    if (platform === 'web' && window.location.protocol === 'http:') {
      return false;
    }

    let status = await FirebaseMessaging.checkPermissions();
    if (status.receive !== 'granted') {
      status = await FirebaseMessaging.requestPermissions();
    }
    
    if (status.receive === 'granted') {
      const result = await FirebaseMessaging.getToken({
        vapidKey: 'BNfYDc6R8T-d0Mbmv8Idhmu0Ufl5zqiK9GSty0XNKDkp38ETHDV74t2BwmjiEd4aN-GYobZbLq-r_I_ga25a--Q',
      });
      fcmToken.value = result.token;
      
      if (result.token) {
        try {
          await request.send({
            url: `${baseUrl}/user/fcm-token`,
            method: 'POST',
            data: { fcm_token: result.token },
            token: idToken.value
          });
          console.log('Successfully retrieved & saved FCM Token');
        } catch (err) {
          console.error('Failed to send FCM token to backend:', err);
        }
      }
      
      FirebaseMessaging.addListener('notificationReceived', (event) => {
        console.log('Notification:', event.notification);
      });
    }
  }

  // Actions
  async function setUser(firebaseUser) {
    user.value = firebaseUser;
    if (firebaseUser) {
      const result = await auth.getIdToken();
      idToken.value = result.token;
      
      initPushNotifications();
      await setUserId(firebaseUser.uid);
      return true; 
    } 
    return false;
  }

  function clearUser() {
    if (socket.value) socket.value.close();
    user.value = false;
    idToken.value = null;
    server_token.value = null;
    server_connect.value = false;
    socket.value = null;
    error.value = false;
  }

  async function backendSync(token = null) {
    try {
      const data = { 'country_code': countryCode.value };
      if (name.value) data.name = name.value;
      if (phone.value) data.phone = phone.value;

      const useToken = token || idToken.value;
      if (!useToken) return false;

      const syncRes = await request.send({
        url: `${baseUrl}/user/sync`,
        method: 'POST',
        data: data,
        token: useToken
      });

      if (syncRes.name) name.value = syncRes.name;
      if (syncRes.phone) phone.value = syncRes.phone;

      server_url.value = syncRes.server_url || false;
      server_token.value = syncRes.server_token || false;
      return true;
    } catch (err) {
      console.error('Backend sync failed:', err);
      return false;
    }
  }

  async function serverConnect() {
    if (!server_url.value) {
      console.error('Missing server URL for connection');
      server_connect.value = false;
      return false;
    }

    //try to cookie that is saved
    const tryExistingSession = async () => {
      try {
        const data = await request.send({
          url: `https://${server_url.value}/api/session`,
          isTraccar: true,
        });
        
        return data && data.id;
      } catch (e) {
        return false;
      }
    };

    //try the token that is saved
    const tryTokenLogin = async (token) => { // fetches session wih
      if (!token) return false;
      try {
        const data = await request.send({
          url: `https://${server_url.value}/api/session`,
          params: { token: token },
          isTraccar: true,
        });
        
        return data && data.id;
      } catch (e) {
        return false;
      }
    };

    const generateToken = async () => {
      try {
        if (!idToken.value || !server_url.value) return false;
        const tokenRes = await request.send({
          url: `${baseUrl}/server/token`,
          method: 'POST',
          data: {server_url: server_url.value},
          token: idToken.value
        });

        if("server_token" in tokenRes){
          return tokenRes.server_token 
        } else {
          console.log('Server responded with empty token', tokenRes)
          return false;
        }
      } catch (err) {       
        return false;
      }
    }

    
    let success = false;
    console.log('Checking for active Traccar session...');
    success = await tryExistingSession();

    if (!success) {
      console.log('No active session found. Trying existing token...');
      if (server_token.value) {
        success = await tryTokenLogin(server_token.value);
      }
    }

    if (success) {
      console.log('Successfully connected to Traccar session');
      server_connect.value = true;
      return true;
    } else {
      //no session and invalid token. ask for new token from backend
      const newtoken = await generateToken()

      if(newtoken){
        server_token.value = newtoken
        success = await tryTokenLogin(newtoken);
        if (success) {
          console.log('Successfully connected to Traccar session');
          server_connect.value = true;
          return true;
        } else {
          console.error('new token login has failed');
          server_connect.value = false;
          return false;  
        }
      } else {
        console.error('Failed to mint new server token');
        server_connect.value = false;
        return false;
      }
    }
  }

  // --- ACTION: Safe Disconnect ---
  function disconnectSocket() {
    if (socket.value) {
      console.log('Closing existing socket intentionally...');
      // Remove listeners so it doesn't trigger the auto-reconnect watcher
      socket.value.onclose = null;
      socket.value.onerror = null;
      socket.value.close();
      socket.value = null;
    }
  }

  // --- ACTION: Connect Socket ---
  function connectSocket(onMessageCallback, onDisconnectCallback) {
    if (!server_url.value) return;
    
    disconnectSocket(); // Ensure any existing socket is cleanly removed first

    const socketInstance = request.connectSocket(
      server_url.value,
      onMessageCallback,
      onDisconnectCallback // Pass the watcher down to the HTTP utility
    );

    if (socketInstance) {
      router.push('/')
      socket.value = socketInstance;
    } else {
      console.log('final socket connection failed')
      error.value = true
    }
  }

  // --- ACTION: Clear User (Update this to use disconnectSocket) ---
  function clearUser() {
    disconnectSocket(); // Use the safe disconnect here
    user.value = false;
    idToken.value = null;
    server_token.value = null;
    server_connect.value = false;
    error.value = false; 
  }

  return { 
    user, idToken, countryCode, loading, isLoggedIn, internet, error,
    setUser, clearUser, serverConnect, connectSocket, fetchCountryCode, backendSync, disconnectSocket,
    server_url, server_token, server_connect, socket, name, phone
  };
});