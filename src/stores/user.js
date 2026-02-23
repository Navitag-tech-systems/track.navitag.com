import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { setUserId } from '@/utils/analytics';
import { baseUrl } from '@/utils/variables';
import { auth } from '@/firebase'; 
import ky from 'ky';

export const useUserStore = defineStore('user', () => {
  // State
  const user = ref(null);
  const idToken = ref(null);
  const fcmToken = ref(null);
  const countryCode = ref(null);
  const name = ref(null);
  const phone = ref(null);
  const server_url = ref(null); // Now stores domain name only (e.g., "traccar.domain.com")
  const server_token = ref(null);
  const server_connect = ref(false);
  const socket = ref(null);


  // Getters
  const isLoggedIn = computed(() => user.value !== null && user.value !== false);

  const loading = computed(() => {
    if(user.value === null){
      return true;
    } else if(user.value === false){ 
      return countryCode.value === null; 
    } else {
      return !server_connect.value;
    }
  });

  // Watcher: Reactively connect when server_token changes
  watch(server_token, (newToken, oldToken) => {
    if (newToken && newToken !== oldToken && server_url.value) {
      console.log('server_token changed. Triggering serverConnect()...');
      serverConnect();
    }
  });

  async function initPushNotifications() {
    if (window.location.protocol === 'http:') {
      // fail silently
      return false
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
      
      // Send the token to your custom backend
      if (result.token) {
        try {
          await ky.post(`${baseUrl}/user/fcm-token`, {
            json: { fcm_token: result.token },
            headers: { Authorization: `Bearer ${idToken.value}` }
          }).json();
          console.log('Successfully retrieved & saved FCM Token:', result.token);
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
    if (firebaseUser){
      // The plugin provides the token in the user object or via getIdToken()
      const result = await auth.getIdToken();
      idToken.value = result.token;
      initPushNotifications();
      backendSync();
      // set user ID for analytics
      await setUserId(firebaseUser.uid);
    } 
  }

  function clearUser() {
    if (socket.value) socket.value.close();
    user.value = false;
    idToken.value = null;
    server_token.value = null;
    server_connect.value = false;
    socket.value = null;
  }

  async function backendSync(token = null) {

    try {
      const data = { 'country_code': countryCode.value };
      if (name.value) data.name = name.value;
      if (phone.value) data.phone = phone.value;

      let firebaseToken = token == null ? idToken.value : token 

      if(firebaseToken == null) {
        console.log('no token')
        return false
      }

      const syncRes = await ky.post(`${baseUrl}/user/sync`, {
        json: data,
        headers: {
          Authorization: `Bearer ${firebaseToken}`
        }
      }).json();

      if (syncRes.name) name.value = syncRes.name;
      if (syncRes.phone) phone.value = syncRes.phone;

      server_url.value = syncRes.server_url || false;
      server_token.value = syncRes.server_token || false;
    } catch (error) {
      console.error('Backend sync failed:', error);
    }
  }

  async function serverConnect() {
    if (!server_url.value) {
      console.error('Missing server URL for connection');
      server_connect.value = false;
      return;
    }

    // 1. Helper to check if an active session cookie (JSESSIONID) already exists
    const tryExistingSession = async () => {
      try {
        const response = await ky.get(`https://${server_url.value}/api/session`, {
          credentials: 'include' // Tells the browser to send existing cookies
        }).json();
        return response && response.id;
      } catch (e) {
        return false;
      }
    };

    // 2. Helper to attempt login with a specific token and save the new session cookie
    const tryTokenLogin = async (token) => {
      if (!token) return false;
      try {
        const response = await ky.get(`https://${server_url.value}/api/session`, {
          searchParams: { token: token },
          credentials: 'include' // Tells the browser to save the JSESSIONID cookie returned
        }).json();
        return response && response.id;
      } catch (e) {
        return false;
      }
    };

    // 3. Helper to request a new token from your custom backend
    const refreshServerToken = async () => {
      try {
        const tokenRes = await ky.post(`${baseUrl}/server/token`, {
          json: { server_url: server_url.value },
          headers: {
            Authorization: `Bearer ${idToken.value}`
          }
        }).json();

        if (tokenRes.status === 'success' && tokenRes.server_token) {
          server_token.value = tokenRes.server_token;
          return tokenRes.server_token;
        }
      } catch (error) {
        console.error('Failed to generate new server token:', error);
      }
      return null;
    };

    let success = false;

    // STEP 1: Try existing session cookie
    console.log('Checking for active Traccar session...');
    success = await tryExistingSession();

    if (!success) {
      console.log('No active session found. Trying existing token...');
      
      // STEP 2: Try existing saved token
      if (server_token.value) {
        success = await tryTokenLogin(server_token.value);
      }

      // STEP 3: If still no success (no token or invalid token), generate a new one
      if (!success) {
        console.log('Token invalid or missing. Generating new token...');
        const newToken = await refreshServerToken();
        success = await tryTokenLogin(newToken);
      }
    }

    // Finalize connection state
    if (success) {
      console.log('Successfully connected to Traccar session');
      server_connect.value = true;
    } else {
      console.error('Failed to establish Traccar session');
      server_connect.value = false;
    }
  }

  // Socket connection (Appends wss://)
  function connectSocket(onMessageCallback) {
    if (!server_url.value) {
      console.error('Cannot connect socket: No server URL provided.');
      return;
    }

    if (socket.value) {
      socket.value.close();
    }

    // Explicitly use secure websocket protocol
    const socketInstance = new WebSocket(`wss://${server_url.value}/api/socket`);

    socketInstance.onopen = () => {
      console.log('WebSocket connection established.');
    };

    socketInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessageCallback && typeof onMessageCallback === 'function') {
          onMessageCallback(data);
        } else {
          if (data.positions) console.log('Live Positions Received:', data.positions);
          if (data.devices) console.log('Device Status Updates:', data.devices);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    socketInstance.onclose = async (e) => {
      console.log('Traccar WebSocket closed.', e.reason);
      socket.value = null;
      await validateSession(); 
    };

    socketInstance.onerror = async (err) => {
      console.error('Traccar WebSocket error:', err);
      socket.value = null;
      await validateSession(); 
    };

    socket.value = socketInstance;
  }

  // Validate Session (Appends https://)
  async function validateSession() {
    if (!server_url.value || !server_token.value) return;

    try {
      const response = await ky.get(`https://${server_url.value}/api/session`, {
        searchParams: { token: server_token.value }
      }).json();

      if (!response || !response.id) {
        throw new Error('Session response invalid');
      }
      
      console.log('Traccar session is still valid. Waiting for reconnect...');
    } catch (error) {
      console.warn('Traccar session is invalid. Resetting connection state.');
      server_connect.value = false;
      server_token.value = false;
      
      serverConnect();
    }
  }

  return { 
    user, idToken, countryCode, loading, isLoggedIn, 
    setUser, clearUser, serverConnect, connectSocket, server_url, server_token, server_connect, socket, name, phone
  };
});