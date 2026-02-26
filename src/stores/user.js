import { defineStore } from 'pinia';
import { ref, computed } from 'vue'; // Removed 'watch' import
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Capacitor } from '@capacitor/core'; 
import { setUserId } from '@/utils/analytics';
import { baseUrl } from '@/utils/variables';
import { auth } from '@/firebase'; 
import { request } from '@/utils/http'; 

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
  const socket = ref(null);
  const sessionId = ref(null);
  
  // App states
  // Getters
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
      
      if (!ipData || !ipData.ip) return null;

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
    } catch (error) {
      console.warn('⚠️ Failed to retrieve location data:', error);
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
      
      // We initialize push notifications, but we DO NOT call backendSync here.
      // LifecycleService will call backendSync immediately after this returns.
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
    sessionId.value = null;
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
    } catch (error) {
      console.error('Backend sync failed:', error);
      return false;
    }
  }

  async function serverConnect() {
    if (!server_url.value) {
      console.error('Missing server URL for connection');
      server_connect.value = false;
      return false;
    }

    const updateSession = (newId) => {
      console.log('✅ Session ID updated:', newId);
      sessionId.value = newId;
    };

    const tryExistingSession = async () => {
      try {
        const data = await request.send({
          url: `https://${server_url.value}/api/session`,
          isTraccar: true,
          sessionId: sessionId.value,
          onSessionSelect: updateSession
        });
        
        return data && data.id;
      } catch (e) {
        return false;
      }
    };

    const tryTokenLogin = async (token) => {
      if (!token) return false;
      try {
        const data = await request.send({
          url: `https://${server_url.value}/api/session`,
          params: { token: token },
          isTraccar: true,
          onSessionSelect: updateSession
        });
        
        return data && data.id;
      } catch (e) {
        return false;
      }
    };

    // Note: refreshServerToken is defined but only used if needed logic is added
    // Currently relying on the flow: Sync -> Token -> Login
    
    let success = false;
    console.log('Checking for active Traccar session...');
    success = await tryExistingSession();

    if (!success) {
      console.log('No active session found. Trying existing token...');
      if (server_token.value) {
        success = await tryTokenLogin(server_token.value);
      }
      
      // If needed, you could add logic here to refresh token from backend
      // if the current server_token fails.
    }

    if (success) {
      console.log('Successfully connected to Traccar session');
      server_connect.value = true;
      return true;
    } else {
      console.error('Failed to establish Traccar session');
      server_connect.value = false;
      return false;
    }
  }

  function connectSocket(onMessageCallback) {
    if (!server_url.value) return;
    
    if (socket.value) {
      console.log('Closing existing socket...');
      socket.value.close();
    }

    const socketInstance = request.connectSocket(
      { 
        url: server_url.value,
        sessionId: sessionId.value
      },
      onMessageCallback
    );

    if (socketInstance) {
      socket.value = socketInstance;
    }
  }

  return { 
    user, idToken, countryCode, loading, isLoggedIn, 
    setUser, clearUser, serverConnect, connectSocket, fetchCountryCode, backendSync,
    server_url, server_token, server_connect, socket, name, phone, sessionId
  };
});