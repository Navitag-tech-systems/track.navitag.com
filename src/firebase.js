import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Capacitor } from "@capacitor/core";

// 1. Your Web Config from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyBlPBeK-kc2jKhYJzG1d70QWiuWLTr62LM",
  authDomain: "track.navitag.com",
  projectId: "track-navitag-com",
  storageBucket: "track-navitag-com.firebasestorage.app",
  messagingSenderId: "729666105352",
  appId: "1:729666105352:web:5bde3b1e1b78bb280ca1bd",
  measurementId: "G-47PTDFYLHH"
};

// 2. Initialize App
const app = initializeApp(firebaseConfig);

// 3. App Check — WEB ONLY. The public apiKey above lets anyone hit the
// identitytoolkit accounts:signUp REST endpoint directly, which is how the
// bot-spam signups get in (they never load this app, so no frontend check
// stops them). App Check makes Firebase require a reCAPTCHA-v3 attestation
// token on auth requests; scripts can't mint one, so once enforcement is
// turned on in the Firebase console the endpoint slams shut for them.
//
// v3 (classic) is used deliberately — it's FREE with no per-assessment
// metering, so a bot flood costs $0. Do NOT swap in ReCaptchaEnterpriseProvider
// (that one meters). Native (iOS/Android) is intentionally skipped: it attests
// via its own SDKs, and reCAPTCHA has no place in the native webview. Since 99%
// of the bot traffic is web, web attestation is what matters here.
//
// NOTE: this only starts MINTING tokens. It is non-breaking on its own. Bots
// are blocked only once you flip enforcement (Firebase console → App Check →
// Authentication → Enforce). Enforcement is global across platforms, so do NOT
// enforce until native also sends App Check tokens, or native logins break.
const RECAPTCHA_V3_SITE_KEY = import.meta.env.VITE_APPCHECK_RECAPTCHA_V3_SITE_KEY || '';

if (!Capacitor.isNativePlatform()) {
  // Localhost review harness: reCAPTCHA won't run on an unregistered origin,
  // so allow a debug token in dev. First run prints a token to the console —
  // register it under Firebase console → App Check → Apps → Manage debug
  // tokens (set VITE_APPCHECK_DEBUG_TOKEN to pin a stable one).
  if (import.meta.env.DEV) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN =
      import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }

  if (RECAPTCHA_V3_SITE_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    console.warn(
      '[AppCheck] VITE_APPCHECK_RECAPTCHA_V3_SITE_KEY not set — App Check disabled on web. ' +
      'Set it once you register the web app (reCAPTCHA v3) in the Firebase console.'
    );
  }
}

export const auth = FirebaseAuthentication;

