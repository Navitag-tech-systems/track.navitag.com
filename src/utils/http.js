import { CapacitorHttp, Capacitor, CapacitorCookies } from '@capacitor/core';
import ky from 'ky';

/**
 * Centralized Request Maker
 * Native: Uses CapacitorHttp + Manual Cookie Injection for Session persistence.
 * Web: Uses ky with { credentials: 'include' } for automatic browser cookie handling.
 * * Option 'simple': If true, forces use of ky (Web Path) without credentials. 
 * Use this for public APIs (ipify, ipinfo) to avoid CORS errors.
 */

export const request = {
  // Helper to generate standard headers
  async getHeaders(isTraccar = false, token = null, url = null, hasBody = false) {
    const headers = {
      'Accept': 'application/json',
    };

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (!isTraccar && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (isTraccar && Capacitor.isNativePlatform() && url) {
      // Retrieve the cookie directly from the native jar for the target URL

      const seshCookie = await this.getNativeCookie(url)
      if(seshCookie) headers['Cookie'] = `JSESSIONID=${seshCookie}`;
    }

    return headers;
  },

  async getNativeCookie(url){
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const cookies = await CapacitorCookies.getCookies({ url: fullUrl });
      if (cookies.JSESSIONID) {
        return cookies.JSESSIONID
      } else {
        return false
      }
  },

  async send(options, _isRetry = false) {
    const {
      url,
      method = 'GET',
      data = null,
      params = null,
      isTraccar = false,
      token = null,
      simple = false // <--- NEW FLAG
    } = options;

    const isNative = Capacitor.isNativePlatform();
    const hasBody = data !== null && (Object.keys(data).length > 0 || Array.isArray(data));

    // Await headers and dynamically fetch the native cookie if required
    const headers = await this.getHeaders(isTraccar, token, url, hasBody);

    // If 'simple' is true, we force the Web/ky path to avoid CapacitorHttp overhead/CORS issues on public APIs
    if (isNative && !simple) {
      // --- CAPACITOR NATIVE PATH ---
      const httpOptions = {
        url,
        method: method.toUpperCase(),
        headers: headers,
        params: params || {},
        data: data || {},
        withCredentials: true,
      };

      try {
        const response = await CapacitorHttp.request(httpOptions);

        // 401 retry: refresh Firebase token and retry once for non-Traccar requests
        if (response.status === 401 && !_isRetry && !isTraccar && !simple) {
          return await this._retryWithFreshToken(options);
        }

        if (response.status >= 200 && response.status < 300) {
          if (response.data === '' || response.data == null) return true;
          return response.data;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        console.error(`Native ${method} Error [${url}]:`, error);
        throw error;
      }
    } else {
      // --- WEB / SIMPLE PATH (Universal ky) ---
      const kyOptions = {
        method: method.toUpperCase(),
        headers: headers,
        searchParams: params || {},
        // If simple, do NOT include credentials (cookies).
        // This fixes the "Credential is not supported... Origin is '*'" error.
        credentials: simple ? undefined : 'include',
        throwHttpErrors: false, // Handle status codes manually for retry logic
      };

      if (hasBody) kyOptions.json = data;

      try {
        const res = await ky(url, kyOptions);

        // 401 retry: refresh Firebase token and retry once for non-Traccar requests
        if (res.status === 401 && !_isRetry && !isTraccar && !simple) {
          return await this._retryWithFreshToken(options);
        }

        if (res.status >= 200 && res.status < 300) {
          const text = await res.text();
          if (!text) return true;
          try { return JSON.parse(text); } catch { return true; }
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        console.error(`Web/Simple ${method} Error [${url}]:`, error);
        throw error;
      }
    }
  },

  async _retryWithFreshToken(options) {
    console.log('🔄 Got 401 — refreshing Firebase token and retrying...');
    const { useUserStore } = await import('@/stores/user');
    const userStore = useUserStore();
    const freshToken = await userStore.getFreshToken();
    if (freshToken) {
      return this.send({ ...options, token: freshToken }, true);
    }
    throw new Error('HTTP 401 — token refresh failed');
  },

  async connectSocket(url, onMessageCallback, onDisconnectCallback) {
    const isNative = Capacitor.isNativePlatform();
    let wsUrl = `wss://${url}/api/socket`;

    if (isNative) {
      const seshCookie = await this.getNativeCookie(url)
      if(!seshCookie){
        console.error('❌ WebSocket Failure: No Session ID provided for Native Auth.');
        return null;
      }
      //else attach cookie to wsurl
      wsUrl += `?session_id=${seshCookie}`;
      console.log('🔹 Native WebSocket connecting with Session ID', wsUrl);
    } else {
      console.log('🔹 Web WebSocket connecting with Browser Cookies', wsUrl);
    }

    const socketInstance = new WebSocket(wsUrl);

    socketInstance.onopen = () => {
      console.log('✅ WebSocket connection established:', wsUrl);
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
      if (onDisconnectCallback) onDisconnectCallback(); // Trigger watcher
    };

    socketInstance.onerror = (err) => {
      console.error('❌ WebSocket Error detected.');
      if (onDisconnectCallback) onDisconnectCallback(); // Trigger watcher
    };

    return socketInstance;
  }
};