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

// No onBackgroundMessage handler — the api.navitag.net backend (verified
// in PushService.php:71) attaches a `notification` field to every send,
// so Firebase auto-displays system notifications on background pushes
// without a custom handler. Add one here only if/when rich actions,
// custom icons, or deep-link-on-tap are needed.
firebase.messaging();
