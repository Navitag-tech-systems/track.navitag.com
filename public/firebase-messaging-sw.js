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

// Initialize messaging so the SW participates in FCM token validation /
// refresh lifecycle. Display branding (icon, badge, click target) is owned
// by the backend's WebPushConfig — see PushService::sendToToken which sends
// webpush.notification.icon|badge plus webpush.fcm_options.link. The FCM
// SDK auto-displays system notifications using those overrides; this SW
// does not need an onBackgroundMessage handler for that path.
firebase.messaging();

// notificationclick: focus an existing PWA window if one is open, otherwise
// fall through to the default behavior (FCM honors webpush.fcm_options.link
// which the backend sets to "/"). Without this handler, every tap would
// spawn a duplicate window even when the PWA is already open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const targetUrl = new URL('/', self.location.origin).href;

    const matchedClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of matchedClients) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(targetUrl); } catch {}
          }
          return;
        }
      } catch {}
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
