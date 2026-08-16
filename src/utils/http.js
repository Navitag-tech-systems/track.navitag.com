import { CapacitorHttp, Capacitor, CapacitorCookies } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import ky from 'ky';

// --- Traccar session id (JSESSIONID) cache ---
// Native WebSocket auth needs the literal JSESSIONID value to pass as
// ?session_id= (the tserver1 Caddy config turns that param back into a
// Cookie header). On Android, CapacitorCookies.getCookies() can't read the
// value back — it returns same-origin, non-HttpOnly document.cookie, while
// the Traccar cookie is cross-domain + HttpOnly. So we capture the value
// from the Traccar Set-Cookie response (which already passes through send())
// and keep it in memory. @capacitor/preferences persists it across launches
// on both Android and iOS (iOS uses UserDefaults — declared in the app's
// PrivacyInfo.xcprivacy with required-reason CA92.1).
const SESSION_STORAGE_KEY = 'traccar_jsessionid';
let cachedSessionId = null;

// Warm the in-memory cache from native storage at startup so a value
// persisted by a previous launch is usable before the first login.
Preferences.get({ key: SESSION_STORAGE_KEY })
  .then(({ value }) => { if (value && !cachedSessionId) cachedSessionId = value; })
  .catch(() => { /* preferences unavailable */ });

async function rememberSessionId(value) {
  if (!value) return;
  cachedSessionId = value; // set synchronously so connectSocket sees it immediately
  try {
    await Preferences.set({ key: SESSION_STORAGE_KEY, value });
  } catch { /* ignore */ }
}

async function forgetSessionId() {
  cachedSessionId = null;
  try {
    await Preferences.remove({ key: SESSION_STORAGE_KEY });
  } catch { /* ignore */ }
}

async function loadSessionId() {
  if (cachedSessionId) return cachedSessionId;
  try {
    const { value } = await Preferences.get({ key: SESSION_STORAGE_KEY });
    if (value) cachedSessionId = value;
  } catch { /* ignore */ }
  return cachedSessionId;
}

/**
 * Build the Error thrown for a non-2xx response.
 *
 * Non-2xx used to throw a bare `new Error('HTTP 409')`, discarding the body —
 * so an api.navitag.net error envelope never reached the caller. That was
 * tolerable while every backend call was Traccar's opaque 4xx, but the v1 API
 * answers with something useful: `{ error, tier, geofence_limit, current }` on
 * a quota refusal, `{ error, reason, action }` on a half-provisioned account.
 *
 * Additive: `.status` and `.body` are new, and `.message` now prefers the
 * API's own `error` string over "HTTP 409". Nothing matches on the old format
 * (checked), and the several places that surface `err.message` straight to the
 * user get a real sentence instead of a status code.
 */
function httpError(status, body) {
  const apiMessage = (body && typeof body === 'object' && typeof body.error === 'string')
    ? body.error
    : null;
  const err = new Error(apiMessage || `HTTP ${status}`);
  err.status = status;
  err.body = body ?? null;
  return err;
}

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

  // Drop the cached Traccar session id (e.g. on logout) so a stale value
  // is never reused for a new session.
  async clearSession() {
    await forgetSessionId();
  },

  async send(options, _isRetry = false) {
    const {
      url,
      method = 'GET',
      data = null,
      params = null,
      isTraccar = false,
      token = null,
      simple = false, // <--- NEW FLAG
      raw = false // return the response body as-is (text), skip JSON parsing
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
          // Persist Set-Cookie headers into the native cookie jar.
          // CapacitorHttp on Android does not always do this automatically.
          if (isTraccar && response.headers) {
            const setCookie = response.headers['set-cookie'] || response.headers['Set-Cookie'];
            if (setCookie) {
              const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
              for (const raw of cookies) {
                const match = raw.match(/^([^=]+)=([^;]*)/);
                if (match) {
                  const cookieUrl = url.startsWith('http') ? url : `https://${url}`;
                  const cookieKey = match[1].trim();
                  const cookieValue = match[2].trim();
                  await CapacitorCookies.setCookie({
                    url: cookieUrl,
                    key: cookieKey,
                    value: cookieValue,
                  });
                  // Capture the session id for native WebSocket auth — this is
                  // the reliable source on Android (getCookies can't read it back).
                  if (cookieKey === 'JSESSIONID') await rememberSessionId(cookieValue);
                }
              }
            }
          }

          if (raw) return response.data;
          if (response.data === '' || response.data == null) return true;
          return response.data;
        }
        // CapacitorHttp already parsed the body when it is JSON.
        throw httpError(response.status, response.data);
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
          if (raw) return text;
          if (!text) return true;
          try { return JSON.parse(text); } catch { return true; }
        }
        // Read the error body before throwing — ky gives us the response, but
        // the stream is consumed once, so this has to happen here.
        let errBody = null;
        try { errBody = JSON.parse(await res.text()); } catch { /* non-JSON error page */ }
        throw httpError(res.status, errBody);
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

  async connectSocket(url, onMessageCallback, onDisconnectCallback, serverToken = null) {
    const isNative = Capacitor.isNativePlatform();
    let wsUrl = `wss://${url}/api/socket`;

    // WEB: authenticate with the Traccar token rather than the browser cookie.
    //
    // The cookie path only ever worked by accident of deployment. Traccar sets
    // JSESSIONID with no SameSite and no Secure, so Chrome treats it as Lax and
    // withholds it from any cross-site request — and "same-site" here is
    // SCHEMEFUL, so http://local.navitag.com -> wss://tserver1.navitag.com is
    // cross-site too. That is why the socket authenticates from
    // https://track.navitag.com and from nowhere else: not a bug in the app, a
    // property of where it happens to be served.
    //
    // /api/socket accepts ?token= directly (verified against tserver1: 101
    // Switching Protocols, followed immediately by a positions frame carrying
    // both devices), so the token the store already holds is sufficient and the
    // cookie is not needed at all. This also makes web match native, which has
    // always passed credentials in the query string.
    // Falls back to the cookie when no token is available (users.server_token
    // can be false), so this is strictly additive: production keeps working
    // exactly as before in that case, and gains an origin-independent path in
    // every other.
    if (!isNative) {
      if (serverToken) {
        wsUrl += `?token=${encodeURIComponent(serverToken)}`;
        console.log('🔹 Web WebSocket connecting with Traccar token');
      } else {
        console.log('🔹 Web WebSocket connecting with browser cookie (no server token available)');
      }
    }

    if (isNative) {
      // Prefer the value captured from the Traccar Set-Cookie response, then
      // the value persisted by a previous launch, then getCookies (iOS/web
      // fallback — it can't read the cross-domain/HttpOnly cookie on Android).
      const seshCookie = cachedSessionId || await loadSessionId() || await this.getNativeCookie(url);
      if(!seshCookie){
        console.error('❌ WebSocket Failure: No Session ID provided for Native Auth.');
        return null;
      }
      //else attach cookie to wsurl
      wsUrl += `?session_id=${seshCookie}`;
      console.log('🔹 Native WebSocket connecting with Session ID');
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