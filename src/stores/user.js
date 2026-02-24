import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { CapacitorHttp, Capacitor } from '@capacitor/core'; 
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
  const server_url = ref(null); // Domain name only (e.g., "traccar.domain.com")
  const server_token = ref(null);
  const server_connect = ref(false);
  const socket = ref(null);
  const sessionId = ref(null); // Track session for WebSockets if needed

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

    const tryExistingSession = async () => {
      try {
        const response = await CapacitorHttp.get({
          url: `https://${server_url.value}/api/session`
        });
        return response.status === 200 && response.data && response.data.id;
      } catch (e) {
        return false;
      }
    };

    const tryTokenLogin = async (token) => {
      if (!token) return false;
      try {
        const response = await CapacitorHttp.get({
          url: `https://${server_url.value}/api/session`,
          params: { token: token }
        });
        return response.status === 200 && response.data && response.data.id;
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
      await syncSessionId(); 
      server_connect.value = true;
    } else {
      console.error('Failed to establish Traccar session');
      server_connect.value = false;
    }
  }

  async function syncSessionId() {
    if (!server_url.value) return;
    try {
      const response = await CapacitorHttp.getCookies({
        url: `https://${server_url.value}`
      });
      const sessionCookie = response.cookies.find(c => c.key === 'JSESSIONID');
      if (sessionCookie) {
        sessionId.value = sessionCookie.value;
      }
    } catch (e) {
      console.warn('Failed to sync cookies:', e);
    }
  }

  function connectSocket(onMessageCallback) {
    if (!server_url.value) return;
    if (socket.value) socket.value.close();

    let wsUrl = `wss://${server_url.value}/api/socket`;
    if (sessionId.value) {
      wsUrl += `;jsessionid=${sessionId.value}`;
    }

    const socketInstance = new WebSocket(wsUrl);
    socketInstance.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessageCallback) onMessageCallback(data);
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };

    socketInstance.onclose = async () => {
      socket.value = null;
      await validateSession(); 
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
      await syncSessionId();
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