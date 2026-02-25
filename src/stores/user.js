import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { CapacitorHttp, Capacitor, CapacitorCookies } from '@capacitor/core'; 
import { setUserId } from '@/utils/analytics';
import { baseUrl } from '@/utils/variables';
import { auth } from '@/firebase'; 

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

  // Watcher: Reactively connect when server_token changes
  watch(server_token, (newToken, oldToken) => {
    if (newToken && newToken !== oldToken && server_url.value) {
      console.log('server_token changed. Triggering serverConnect()...');
      serverConnect();
    }
  });

  // --- HELPER: Extract Session ID from Set-Cookie Header ---
  const extractSessionIdFromHeaders = (response) => {
    const headers = response.headers;
    // Headers can be capitalized differently depending on platform
    const setCookie = headers['Set-Cookie'] || headers['set-cookie'] || headers['SET-COOKIE'];

    if (!setCookie) return false;

    // Handle cases where Set-Cookie might be an array or a single string
    const cookieString = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;
    
    // Regex to find JSESSIONID value
    const match = cookieString.match(/JSESSIONID=([^;]+)/i);
    
    if (match && match[1]) {
      sessionId.value = match[1];
      console.log('✅ Extracted JSESSIONID from headers:', sessionId.value);
      return true;
    }
    return false;
  };

  async function initPushNotifications() {
    const platform = Capacitor.getPlatform();
    // Only skip on actual web browser (http), not native webview (http://localhost)
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
          await CapacitorHttp.post({
            url: `${baseUrl}/user/fcm-token`,
            headers: { 
              'Authorization': `Bearer ${idToken.value}`,
              'Content-Type': 'application/json' 
            },
            data: { fcm_token: result.token }
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
      backendSync();
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
    sessionId.value = null;
  }

  async function backendSync(token = null) {
    try {
      const data = { 'country_code': countryCode.value };
      if (name.value) data.name = name.value;
      if (phone.value) data.phone = phone.value;

      let firebaseToken = token == null ? idToken.value : token;
      if (!firebaseToken) return false;

      const response = await CapacitorHttp.post({
        url: `${baseUrl}/user/sync`,
        headers: {
          'Authorization': `Bearer ${firebaseToken}`,
          'Content-Type': 'application/json'
        },
        data: data
      });

      const syncRes = response.data;
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

    // 1. Try Existing Session
    const tryExistingSession = async () => {
      try {
        const response = await CapacitorHttp.get({
          url: `https://${server_url.value}/api/session`
        });
        
        if (response.status === 200 && response.data && response.data.id) {
          extractSessionIdFromHeaders(response);
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    };

    // 2. Try Token Login
    const tryTokenLogin = async (token) => {
      if (!token) return false;
      try {
        const response = await CapacitorHttp.get({
          url: `https://${server_url.value}/api/session`,
          params: { token: token }
        });
        
        if (response.status === 200 && response.data && response.data.id) {
          const found = extractSessionIdFromHeaders(response);
          if (!found) {
             console.warn('Login success, but no Set-Cookie header found. Falling back to native store check.');
             await syncSessionId();
          }
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    };

    const refreshServerToken = async () => {
      try {
        const response = await CapacitorHttp.post({
          url: `${baseUrl}/server/token`,
          headers: {
            'Authorization': `Bearer ${idToken.value}`,
            'Content-Type': 'application/json'
          },
          data: { server_url: server_url.value }
        });

        if (response.data.status === 'success' && response.data.server_token) {
          server_token.value = response.data.server_token;
          return response.data.server_token;
        }
      } catch (error) {
        console.error('Failed to generate new server token:', error);
      }
      return null;
    };

    let success = false;
    console.log('Checking for active Traccar session...');
    success = await tryExistingSession();

    if (!success) {
      console.log('No active session found. Trying existing token...');
      if (server_token.value) {
        success = await tryTokenLogin(server_token.value);
      }

      if (!success) {
        console.log('Token invalid or missing. Generating new token...');
        const newToken = await refreshServerToken();
        success = await tryTokenLogin(newToken);
      }
    }

    if (success) {
      console.log('Successfully connected to Traccar session');
      // If we still don't have a session ID in memory (failed extraction), check the store
      if (!sessionId.value) {
        await syncSessionId();
      }
      server_connect.value = true;
    } else {
      console.error('Failed to establish Traccar session');
      server_connect.value = false;
    }
  }

  async function syncSessionId() {
    if (!server_url.value) return;
    try {
      // Use CapacitorCookies (Native) instead of Http
      // NOTE: server_url is just the domain, so we prepend https://
      const cookiesMap = await CapacitorCookies.getCookies({
        url: `https://${server_url.value}`
      });
      
      // Access direct property. getCookies returns { "KEY": "VALUE" } object.
      // There is no .cookies array or .find() method.
      const sessionValue = cookiesMap['JSESSIONID'];
      
      if (sessionValue) {
        sessionId.value = sessionValue;
        console.log('Synced Traccar Session ID from Native Store:', sessionId.value);
      } else {
        console.warn('No JSESSIONID found in native cookies.');
      }
    } catch (e) {
      console.warn('Failed to sync cookies:', e);
    }
  }

  function connectSocket(onMessageCallback) {
    if (!server_url.value) return;
    
    if (socket.value) {
      console.log('Closing existing socket...');
      socket.value.close();
    }

    // 1. Prepare URLs (Strip protocol just in case server_url has it)
    let wsPath = '/api/socket';

    // --- AUTHENTICATION STRATEGY: QUERY PARAMETER (Handled by Caddy) ---
    // Caddy will take ?session_id=... and inject it as a Cookie header
    if (!sessionId.value) {
      console.error('❌ CRITICAL: No Session ID available. WebSocket will fail.');
      return
    }

    const wsUrl = `wss://${server_url.value}${wsPath}${sessionId.value ? `?session_id=${sessionId.value}` : ''}`;
    const probeUrl = `https://${server_url.value}${wsPath}${sessionId.value ? `?session_id=${sessionId.value}` : ''}`; 

    console.log('🔹 Preparing WebSocket connection:', wsUrl);

    // 2. DIAGNOSTIC PROBE: Check URL with HTTP first to see real error
    (async () => {
      console.log('🔎 Probing connection authentication...');
      try {
        const response = await CapacitorHttp.get({
          url: probeUrl,
          headers: {
            'Accept': 'application/json' 
          }
        });

        console.log(`🔎 Probe Result: Status ${response.status}`);
        
        if (response.status === 401 || response.status === 403) {
          console.error('❌ AUTH FAILURE: Server rejected session during probe. Your JSESSIONID is likely invalid or expired.');
        } else if (response.status === 200 || response.status === 404 || response.status === 400) {
          // 404/400 is "Success" for a GET probe on a Socket endpoint (means auth passed)
          console.log('✅ Auth appears valid. Opening real socket...');
          openRealSocket(wsUrl, onMessageCallback);
        } else {
          console.warn('⚠️ Unexpected Probe Status:', response.status);
          openRealSocket(wsUrl, onMessageCallback); 
        }

      } catch (err) {
        console.error('❌ NETWORK/SSL ERROR during probe:', err.message);
      }
    })();
  }

  // 3. The actual WebSocket logic
  function openRealSocket(url, onMessageCallback) {
    const socketInstance = new WebSocket(url);

    socketInstance.onopen = () => {
      console.log('✅ WebSocket connection established!');
    };

    socketInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessageCallback) onMessageCallback(data);
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };

    socketInstance.onclose = (e) => {
      console.log(`⚠️ WebSocket closed. Code: ${e.code}, Reason: "${e.reason}"`);
      socket.value = null;
    };
    
    socketInstance.onerror = (err) => {
       console.error('❌ WebSocket Error Event (Hidden details). See Probe logs above.');
    };

    socket.value = socketInstance;
  }

  async function validateSession() {
    if (!server_url.value || !server_token.value) return;

    try {
      const response = await CapacitorHttp.get({
        url: `https://${server_url.value}/api/session`,
        params: { token: server_token.value }
      });

      if (response.status !== 200 || !response.data?.id) {
        throw new Error('Invalid session');
      }
      
      extractSessionIdFromHeaders(response);
      if(!sessionId.value) await syncSessionId();

    } catch (error) {
      server_connect.value = false;
      server_token.value = false;
      serverConnect();
    }
  }

  return { 
    user, idToken, countryCode, loading, isLoggedIn, 
    setUser, clearUser, serverConnect, connectSocket, 
    server_url, server_token, server_connect, socket, name, phone
  };
});