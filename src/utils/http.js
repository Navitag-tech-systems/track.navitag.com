import { CapacitorHttp, Capacitor } from '@capacitor/core';
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
  getHeaders(isTraccar = false, token = null, sessionId = null, hasBody = false) {
    const headers = {
      'Accept': 'application/json',
    };

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (!isTraccar && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (isTraccar && Capacitor.isNativePlatform() && sessionId) {
      headers['Cookie'] = `JSESSIONID=${sessionId}`;
    }

    return headers;
  },

  extractSessionId(headers) {
    const setCookie = headers['Set-Cookie'] || headers['set-cookie'] || headers['SET-COOKIE'];
    
    if (setCookie) {
      const cookieString = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;
      const match = cookieString.match(/JSESSIONID=([^;]+)/i);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  },

  async send(options) {
    const { 
      url, 
      method = 'GET', 
      data = null, 
      params = null, 
      isTraccar = false,
      token = null,      
      sessionId = null,  
      onSessionSelect = null,
      simple = false // <--- NEW FLAG
    } = options;

    const isNative = Capacitor.isNativePlatform();
    const hasBody = data !== null && (Object.keys(data).length > 0 || Array.isArray(data));
    const headers = this.getHeaders(isTraccar, token, sessionId, hasBody);

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
        
        if (isTraccar && response.headers && onSessionSelect) {
          const newId = this.extractSessionId(response.headers);
          if (newId) onSessionSelect(newId);
        }

        return response.data;
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
      };

      if (hasBody) kyOptions.json = data;

      try {
        return await ky(url, kyOptions).json();
      } catch (error) {
        console.error(`Web/Simple ${method} Error [${url}]:`, error);
        throw error;
      }
    }
  },

  connectSocket(options, onMessageCallback) {
    const isNative = Capacitor.isNativePlatform();
    const { url, path = '/api/socket', sessionId = null } = options;

    let wsUrl = `wss://${url.replace(/\/$/, '')}${path}`;

    if (isNative) {
      if (!sessionId) {
        console.error('❌ WebSocket Failure: No Session ID provided for Native Auth.');
        return null;
      }
      wsUrl += `?session_id=${sessionId}`;
      console.log('🔹 Native WebSocket connecting with Session ID');
    } else {
      console.log('🔹 Web WebSocket connecting with Browser Cookies');
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
    };

    socketInstance.onerror = (err) => {
      console.error('❌ WebSocket Error detected.');
    };

    return socketInstance;
  }
};