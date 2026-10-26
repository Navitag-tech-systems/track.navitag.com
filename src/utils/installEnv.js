// Which install path a browser can take. Pure, so it is unit-tested against
// real user-agent strings (installEnv.test.js).
//
// iOS has no install API: the only path is Safari's own Share -> Add to Home
// Screen (Chrome/Edge/Firefox on iOS 16.4+ have it too, in their share menu).
// In-app browsers (Messenger, Facebook, Instagram, ...) have no path at all and
// also break Google sign-in, so they are steered out to Safari first.
//
// kind:
//   'installed'      running as the installed PWA (standalone)
//   'ios-safari'     iOS Safari — guided Add to Home Screen
//   'ios-browser'    Chrome / Edge / Firefox on iOS — works, Safari preferred
//   'ios-inapp'      in-app web view on iOS — must open in Safari
//   'android'        Android browser — one-tap install when the prompt is available
//   'android-inapp'  in-app web view on Android — must open in Chrome
//   'desktop'        anything else — scan a QR with the phone

const INAPP_RE = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|Messenger|MicroMessenger|TikTok|musical_ly|BytedanceWebview|Snapchat|Twitter|LinkedInApp|GSA\//;

export function detectInstallEnv(ua = '', { standalone = false, maxTouchPoints = 0 } = {}) {
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);

  if (standalone) return { kind: 'installed', isIOS, isIPad, isAndroid, safariMajor: null };

  if (isIOS) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
    // A real iOS browser carries the "Safari/" token; WKWebView-based in-app
    // browsers usually drop it, which catches apps not named in INAPP_RE.
    const inApp = INAPP_RE.test(ua) || (!otherBrowser && !/Safari\//.test(ua));
    const m = ua.match(/Version\/(\d+)/);
    const safariMajor = m ? Number(m[1]) : null;
    const kind = inApp ? 'ios-inapp' : otherBrowser ? 'ios-browser' : 'ios-safari';
    return { kind, isIOS, isIPad, isAndroid, safariMajor };
  }

  if (isAndroid) {
    const inApp = INAPP_RE.test(ua) || /; wv\)/.test(ua);
    return { kind: inApp ? 'android-inapp' : 'android', isIOS, isIPad, isAndroid, safariMajor: null };
  }

  return { kind: 'desktop', isIOS, isIPad, isAndroid, safariMajor: null };
}

// Safari 26 (iOS 26) moved Share into the ••• menu in the default compact tab
// bar; earlier versions show the Share button directly in the toolbar.
export function usesMoreMenu(env) {
  return env.kind === 'ios-safari' && (env.safariMajor ?? 0) >= 26;
}

// Opens the same URL in Safari from an iOS in-app browser (iOS 17+ honours the
// scheme; older versions or apps that block it do nothing — the page also
// offers copy-link).
export function safariUrl(httpsUrl) {
  return httpsUrl.replace(/^https:\/\//, 'x-safari-https://');
}

// Android: hand the URL to Chrome (or the chooser when Chrome is absent).
export function chromeIntentUrl(httpsUrl) {
  const rest = httpsUrl.replace(/^https:\/\//, '');
  return `intent://${rest}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`;
}
