import { defineStore } from 'pinia';
// 1. Swapped markRaw for shallowRef
import { ref, computed, shallowRef } from 'vue'; 
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Capacitor, CapacitorCookies } from '@capacitor/core';
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
  const pushPermission = ref('unknown');
  const showPushEnableToast = ref(false);
  // User explicitly turned off push on this device. Persisted because OS-level
  // permission stays 'granted' after we delete the token, so we'd otherwise
  // auto-resubscribe on the next initPushNotifications() call.
  const pushDisabledLocally = ref(
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('pwa_push_disabled') === 'true'
  );
  const countryCode = ref(null);
  const ipLocation = ref(null);
  const name = ref(null);
  const phone = ref(null);
  const email = ref(null);
  const server_url = ref(null);
  const server_token = ref(null);
  const server_connect = ref(false);
  const notifications = ref([]);
  
  // 2. THIS IS THE CRITICAL FIX: Declare as a shallowRef
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

    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
    ]);

    const attempt = async () => {
      const countryData = await withTimeout(
        request.send({ url: `https://api.ipinfo.io/lite/me?token=${token}`, simple: true }),
        8000
      );
      if (!countryData?.country_code) return null;

      countryCode.value = countryData.country_code;
      if (countryData.latitude && countryData.longitude) {
        ipLocation.value = [countryData.latitude, countryData.longitude];
      }
      console.log('✅ Country Code Detected:', countryCode.value);
      return countryCode.value;
    };

    // Retry up to 5 times with increasing delay
    for (let i = 0; i < 5; i++) {
      try {
        const result = await attempt();
        if (result) return result;
      } catch (error) {
        console.warn(`⚠️ IP lookup attempt ${i + 1}/5 failed:`, error.message);
      }
      if (i < 4) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }

    // All retries exhausted
    console.error('❌ All IP lookup attempts failed');
    if (countryCode.value === null) {
      countryCode.value = null;
    }
    return null;
  }

  async function isPushSupportedHere() {
    // FirebaseMessaging.isSupported() returns true on Android/iOS native and
    // checks for Push API + Notification API + ServiceWorker on web. Replaces
    // the old `protocol === 'http:'` heuristic which mis-classified iOS
    // Safari < 16.4 and other unsupported environments.
    try {
      const result = await FirebaseMessaging.isSupported();
      return result?.isSupported === true;
    } catch {
      return false;
    }
  }

  function describeWebDevice() {
    if (Capacitor.isNativePlatform()) return undefined;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/iPad|iPhone|iPod/.test(ua)) return 'Safari (iOS web)';
    if (/Android/.test(ua))          return 'Chrome (Android web)';
    if (/Mac/.test(ua))              return 'Safari (macOS web)';
    if (/Windows/.test(ua))          return 'Chrome (Windows web)';
    return 'Web';
  }

  async function checkPushPermission() {
    if (!(await isPushSupportedHere())) {
      pushPermission.value = 'unsupported';
      return 'unsupported';
    }
    try {
      const status = await FirebaseMessaging.checkPermissions();
      pushPermission.value = status.receive;
      return status.receive;
    } catch (err) {
      console.error('checkPushPermission failed:', err);
      pushPermission.value = 'unknown';
      return 'unknown';
    }
  }

  async function retrieveAndPersistFcmToken() {
    try {
      const options = {
        vapidKey: 'BNfYDc6R8T-d0Mbmv8Idhmu0Ufl5zqiK9GSty0XNKDkp38ETHDV74t2BwmjiEd4aN-GYobZbLq-r_I_ga25a--Q',
      };
      if (Capacitor.getPlatform() === 'web') {
        // Web requires an FCM SW registration to mint a token. Native plugin
        // handles its own SW equivalent internally.
        //
        // EXPLICIT SCOPE is load-bearing: without it, default scope is `/`
        // (the SW file is at root), which would replace the Workbox SW
        // registered at the same scope. `/firebase-cloud-messaging-push-scope`
        // is Firebase JS SDK's standard FCM scope and isolates the two SWs.
        options.serviceWorkerRegistration = await navigator.serviceWorker.register(
          '/firebase-messaging-sw.js',
          { scope: '/firebase-cloud-messaging-push-scope' }
        );
      }
      const result = await FirebaseMessaging.getToken(options);
      fcmToken.value = result.token;

      if (result.token) {
        try {
          const platform = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'
          const deviceLabel = describeWebDevice();
          await request.send({
            url: `${baseUrl}/user/fcm-token`,
            method: 'POST',
            data: {
              fcm_token: result.token,
              platform,
              ...(deviceLabel ? { device_label: deviceLabel } : {}),
            },
            token: idToken.value
          });
          console.log('Successfully retrieved & saved FCM Token');
        } catch (err) {
          console.error('Failed to send FCM token to backend:', err);
          return 'token-error';
        }
      }

      FirebaseMessaging.addListener('notificationReceived', (event) => {
        console.log('Notification:', event.notification);
      });
      return 'granted';
    } catch (err) {
      console.warn('FCM token retrieval failed:', err);
      return 'token-error';
    }
  }

  async function initPushNotifications() {
    if (!(await isPushSupportedHere())) {
      pushPermission.value = 'unsupported';
      return 'unsupported';
    }

    // User explicitly disabled push on this device. Track current OS-level
    // permission for UI accuracy but don't auto-resubscribe. Re-enable goes
    // through the toggle / toast which calls enablePushFromGesture().
    if (pushDisabledLocally.value) {
      try {
        const status = await FirebaseMessaging.checkPermissions();
        pushPermission.value = status.receive;
      } catch {
        pushPermission.value = 'unknown';
      }
      return pushPermission.value;
    }

    let status = await FirebaseMessaging.checkPermissions();
    if (status.receive !== 'granted') {
      if (!Capacitor.isNativePlatform()) {
        // Web: defer permission request to a user gesture. Browsers (Safari
        // especially) auto-deny Notification.requestPermission() calls that
        // aren't tied to a click. The toast in App.vue calls
        // enablePushFromGesture() below from a real click handler.
        pushPermission.value = status.receive;
        showPushEnableToast.value = true;
        return status.receive;
      }
      status = await FirebaseMessaging.requestPermissions();
    }
    pushPermission.value = status.receive;

    if (status.receive === 'granted') {
      return await retrieveAndPersistFcmToken();
    }
    return status.receive;
  }

  async function enablePushFromGesture() {
    // Must run synchronously inside a user-gesture event handler so Safari
    // accepts the permission request. Called from the App.vue toast Enable
    // button and from the account-page push toggle.
    const status = await FirebaseMessaging.requestPermissions();
    pushPermission.value = status.receive;
    showPushEnableToast.value = false;
    if (status.receive === 'granted') {
      // User just opted in — clear the local-disable flag so future inits
      // can resubscribe normally if the token is ever lost.
      if (pushDisabledLocally.value) {
        pushDisabledLocally.value = false;
        try { localStorage.removeItem('pwa_push_disabled'); } catch {}
      }
      return await retrieveAndPersistFcmToken();
    }
    return status.receive;
  }

  async function disablePushOnThisDevice() {
    const tokenToDelete = fcmToken.value;

    // Set the local-disable flag first so any concurrent init can't race us
    // into resubscribing.
    pushDisabledLocally.value = true;
    try { localStorage.setItem('pwa_push_disabled', 'true'); } catch {}

    // Tell backend to forget this device's token. Empty token short-circuits
    // server-side to "wipe all" — guard against that by only sending if we
    // have a token.
    if (tokenToDelete) {
      try {
        await request.send({
          url: `${baseUrl}/user/logout`,
          method: 'POST',
          data: { fcm_token: tokenToDelete },
          token: idToken.value
        });
      } catch (err) {
        console.warn('Failed to delete FCM token from backend:', err);
      }
    }

    // Best-effort revocation at FCM. If this fails the token still gets
    // pruned server-side on the next failed send (PushService auto-prune).
    try {
      await FirebaseMessaging.deleteToken();
    } catch (err) {
      console.warn('FirebaseMessaging.deleteToken failed:', err);
    }

    fcmToken.value = null;
    return 'disabled';
  }

  // Actions
  async function getFreshToken() {
    try {
      const result = await auth.getIdToken({ forceRefresh: true });
      idToken.value = result.token;
      return result.token;
    } catch (err) {
      console.error('Failed to refresh Firebase ID token:', err);
      return null;
    }
  }

  async function setUser(firebaseUser) {
    user.value = firebaseUser;
    if (firebaseUser) {
      await getFreshToken();
      initPushNotifications();
      await setUserId(firebaseUser.uid);
      return true;
    }
    return false;
  }

  async function backendSync(token = null) {
    try {
      // Ensure we have a fresh Firebase token before calling the backend
      if (!token) await getFreshToken();

      const data = { 'country_code': countryCode.value };

      if (name.value) data.name = name.value;
      if (user.value.displayName) data.name = user.value.displayName;
      // Fallback: Apple name cached in localStorage from first sign-in
      if (!data.name) {
        const cachedName = localStorage.getItem('apple_pending_name');
        if (cachedName) data.name = cachedName;
      }
      if (phone.value) data.phone = phone.value;
      if (user.value.phoneNumber) data.phone = user.value.phoneNumber;
      // Include email from user object or stored email (for SSO users whose JWT may not have it yet)
      if (user.value.email) data.email = user.value.email;
      else if (email.value) data.email = email.value;

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
      localStorage.removeItem('apple_pending_name');

      server_url.value = syncRes.server_url || false;
      server_token.value = syncRes.server_token || false;
      if (server_url.value && !Capacitor.isNativePlatform()) {
        localStorage.setItem('server_url', server_url.value);
      }
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
        // Refresh Firebase token before minting a new Traccar token
        await getFreshToken();
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
  async function disconnectSocket() {
    if (socket.value) {
      console.log('Closing existing socket intentionally...');
      
      // If the socket is currently a pending Promise, wait for it to become a real WebSocket
      let activeSocket = socket.value;
      if (activeSocket instanceof Promise) {
        activeSocket = await activeSocket;
      }

      // Now we know for a fact we are dealing with the real object
      if (activeSocket) {
        activeSocket.onclose = null;
        activeSocket.onerror = null;
        
        if (typeof activeSocket.close === 'function') {
          activeSocket.close();
        }
      }
      
      socket.value = null;
    }
  }

  // --- ACTION: Connect Socket ---
  async function connectSocket(onMessageCallback, onDisconnectCallback) {
    if (!server_url.value) return;
    
    // Safely close any existing sockets first
    await disconnectSocket();

    try {
      // Add 'await' so we get the actual WebSocket, not a Promise
      const socketInstance = await request.connectSocket(
        server_url.value,
        onMessageCallback,
        onDisconnectCallback 
      );

      if (socketInstance) {
        socket.value = socketInstance;
      } else {
        console.error('final socket connection failed');
        error.value = true;
      }
    } catch (err) {
      console.error('Socket connection threw an error:', err);
      error.value = true;
    }
  }

  async function traccarLogout() {
    const url = server_url.value || (!Capacitor.isNativePlatform() && localStorage.getItem('server_url'));
    if (!url) return;
    try {
      await request.send({
        url: `https://${url}/api/session`,
        method: 'DELETE',
        isTraccar: true,
      });
    } catch (err) {
      console.warn('Traccar session DELETE failed (may already be expired):', err.message);
    }
    if (Capacitor.isNativePlatform()) {
      // Clear the native cookie jar for this server
      try {
        await CapacitorCookies.clearCookies({ url: `https://${url}` });
      } catch (err) {
        console.warn('Failed to clear native cookies:', err.message);
      }
    } else {
      localStorage.removeItem('server_url');
    }
  }

  function clearUser() {
    disconnectSocket();
    user.value = false;
    idToken.value = null;
    server_url.value = null;
    server_token.value = null;
    server_connect.value = false;
    notifications.value = [];
    email.value = null;
    error.value = false;
  }

  return {
    user, idToken, countryCode, ipLocation, loading, isLoggedIn, internet, error,
    setUser, clearUser, traccarLogout, serverConnect, connectSocket, fetchCountryCode, backendSync, disconnectSocket, getFreshToken, initPushNotifications, enablePushFromGesture, disablePushOnThisDevice, checkPushPermission,
    server_url, server_token, server_connect, notifications, socket, name, phone, email,
    fcmToken, pushPermission, showPushEnableToast, pushDisabledLocally
  };
});