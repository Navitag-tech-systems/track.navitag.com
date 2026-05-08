// VERSION SYNC: the version below MUST match package.json
// -> dependencies.firebase resolved version (`npm ls firebase`).
// Skew between this SW and the bundled SDK silently breaks background
// notifications for some users. See PROPOSED_PWA.md Phase 8 ->
// "Firebase version-sync protocol" for the maintenance rule.
importScripts('https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging-compat.js');

// Config duplicated from src/firebase.js by design — the SW cannot import
// bundled modules. Firebase web config values are NOT secrets (apiKey is
// intended to be embedded in client code, gated by Firebase Security Rules).
firebase.initializeApp({
  apiKey: "AIzaSyBlPBeK-kc2jKhYJzG1d70QWiuWLTr62LM",
  authDomain: "track.navitag.com",
  projectId: "track-navitag-com",
  storageBucket: "track-navitag-com.firebasestorage.app",
  messagingSenderId: "729666105352",
  appId: "1:729666105352:web:5bde3b1e1b78bb280ca1bd"
});

// ---------------------------------------------------------------------------
// Branded background notifications.
//
// We register our own `push` listener BEFORE calling firebase.messaging() so
// our listener fires first. We call stopImmediatePropagation() to block the
// Firebase SDK's auto-display path, then render the notification ourselves
// with explicit icon/badge so the same branding shows on Android Chrome PWA
// regardless of FCM SDK quirks. iOS PWA push (16.4+) honors apple-touch-icon
// for the small icon — the explicit icon here is for Android.
//
// Backend sends `notification: { title, body }` plus optional `data`. We do
// not parse data fields beyond an optional `tag` for grouping; the backend
// controls everything else.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return; // not JSON — let downstream listeners handle
  }

  // Only take over for messages with a notification field. Pure data-only
  // messages can be added later via firebase.messaging().onBackgroundMessage
  // without conflicting with this branch.
  if (!payload || !payload.notification) return;

  event.stopImmediatePropagation();

  const title = payload.notification.title || 'Navitag';
  const body  = payload.notification.body  || '';
  const tag   = (payload.data && (payload.data.tag || payload.data.device_id)) || 'navitag';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag,
      data: payload.data || {},
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const targetUrl = new URL('/', self.location.origin).href;

    const matchedClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    // Focus an existing PWA window on our origin if one is open. Avoids
    // spawning a duplicate window every tap.
    for (const client of matchedClients) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          if ('focus' in client) {
            await client.focus();
            // Best-effort send the user back to "/" inside the focused window.
            if ('navigate' in client) {
              try { await client.navigate(targetUrl); } catch {}
            }
            return;
          }
        }
      } catch {}
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

// firebase.messaging() must still be initialized so the SW participates in
// FCM token validation / refresh. Token registration itself happens in the
// main app via getToken() — this is just lifecycle plumbing.
firebase.messaging();
