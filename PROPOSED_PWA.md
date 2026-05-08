# Proposed PWA Deployment Plan

Status: **Proposal — prerequisites verified, ready for Phase 1**
Owner: TBD
Last updated: 2026-05-07

**Resolved decisions (was §8):**
- SW updates: `registerType: 'autoUpdate'` (silent). No update toast.
- Install-funnel analytics: **not wired**. `utils/analytics.js` untouched.
- `vite-plugin-pwa` version: pin to `^1.3.0` — declared peer range covers Vite 7 (and Vite 8). No compatibility risk.
- FCM service worker scope: **background notifications, Option A (`importScripts` from gstatic).** See Phase 8 for the SW body and the version-sync maintenance protocol.
- Install target: **mobile and tablet only.** Desktop browsers do not get our install UI. We do not listen for `beforeinstallprompt` on desktop, so Chrome/Edge's built-in mini-infobar surfaces unmodified — motivated desktop users can self-install via that or the browser menu, but we don't promote it.
- **Install toast: temporarily disabled at launch.** The install scaffolding from Phase 4 still ships — `beforeinstallprompt` is captured + stashed, `appinstalled` is handled, the iOS coachmark detection still runs — but the install toast and the iOS coachmark **do not render** in the initial release. Mobile/tablet users on Android/Chromium can still self-install via the browser's mini-infobar / menu (same path desktop takes); iOS users can still self-install via Safari's Share → Add to Home Screen. Rationale: ship the PWA quietly first, validate FCM round-trip and standalone-mode behavior on real devices, then turn the prompt on once we're confident. Re-enabling later is one render-condition flip in `App.vue`'s `currentToast` computed; no scaffolding teardown.

  **The web notification toast is explicitly NOT affected by this suppression.** It continues to render per its existing rules (logged-in + web + permission state in `{prompt, default}` + 7-day dismiss cooldown). Notifications are the load-bearing PWA-only feature for this stopgap; suppressing them too would defeat the point.

  **What users actually see on each platform during suppression** (verified against Chrome 121+ and current iOS Safari):

  - **Android Chrome (Xiaomi/HyperOS, Pixel, Samsung, etc.):** **no automatic install UI surfaces.** Chrome 76+ removed the bottom mini-infobar; the modern affordance is the three-dots menu → "Install app" / "Add to Home screen." Chrome may also show a small ambient install icon in the URL bar at its own discretion (driven by Site Engagement Score). With `preventDefault()` not called, Chrome decides whether to show any of this — typically nothing automatic appears for a brand-new visit.
  - **Desktop Chrome / Edge:** small install icon appears in the URL bar once installability is detected. User clicks it to install. This is the only "automatic" surface across any platform during suppression.
  - **iOS Safari:** **no install UI of any kind.** Apple does not expose a `beforeinstallprompt` equivalent. Users must manually use Share → Add to Home Screen.

  **Net install-rate expectation at launch: very low (~internal testers + URL-bar-icon noticers).** This matches the intended quietly-shipping behavior. The previously documented "mini-infobar surfaces on mobile" was based on outdated Chrome behavior and has been corrected.

  Reviewers: do not flag missing install UI on mobile as a bug — Chrome's modern behavior is no-auto-prompt unless the page calls `.prompt()`, which the suppression flag prevents. The install path during suppression is the browser's three-dots menu, not any in-page UI.

**Landed pre-Phase-1 (already in main):**
- **No deep-linking from `https://track.navitag.com/*`.** Resolved policy: links to `track.navitag.com` always open in the browser, never auto-route into the PWA or native app. Concrete repo changes:
  - Deleted `public/.well-known/assetlinks.json` (was a placeholder stub anyway). Stops Android App Links delegation file from being served from the web origin.
  - Removed the `<intent-filter android:autoVerify="true">` for `https://track.navitag.com` from `android/app/src/main/AndroidManifest.xml` (was at the old line 67-72). Without this filter, Android cannot intercept matching links into the app — they flow to the user's default browser.
  - **Do not add `capture_links` to `manifest.webmanifest`** when Phase 1 rebuilds it. Default behavior (browser opens, optional "Open in app" pill from Chrome's PWA opener affordance) is exactly what we want.
  - **Do not publish `apple-app-site-association`** to the web origin. iOS Universal Links are inert without it; default behavior is Safari opens the link.

  Closes the §8 `assetlinks.json` open question and neutralizes the §7.5 Universal Link / App Link collision pitfall.

- **Web push permission gesture-gating + App.vue toast.** Phase 8's "gate `requestPermissions()` behind a user gesture" and "render the web permission toast in App.vue" steps shipped early to stop unsolicited prompts on web today (the auto-call from `setUser` was firing `requestPermissions()` without a user gesture, getting Chrome quiet-UI demoted and Safari auto-denied). Concrete changes:
  - `src/stores/user.js`: added `showPushEnableToast` state, extracted token retrieval into `retrieveAndPersistFcmToken()` helper (wraps `getToken` in try/catch since it throws on web until the FCM SW lands), modified `initPushNotifications()` to defer to a gesture on web, added `enablePushFromGesture()` action.
  - `src/views/account/index.vue`: account-page `togglePush` now calls `enablePushFromGesture()` so the existing user-gesture path keeps working on web.
  - `src/App.vue`: toast rendered inline (no separate component file). Position **top of screen** (`top-[calc(env(safe-area-inset-top)+12px)]`), site-wide visibility — no route-based hiding. Cooldown 7 days. Computed `showPushToast` enforces remaining suppression rules.
  - **Until Phase 8 ships the FCM SW**, the toast Enable button on web grants permission successfully but `getToken` throws and returns `'token-error'`. Permission state stays `'granted'`, so when the SW eventually lands the next `initPushNotifications` run will skip straight to token retrieval — no second prompt.

## 1. Goals

Ship the existing Vue 3 + Capacitor app as an installable PWA from `https://track.navitag.com`, **as a temporary stopgap while native Android/iOS store releases are delayed.** Single `dist/` bundle ships to web, Android, and iOS.

Minimum feature parity for the installed PWA:

- View live tracking
- Add device (QR scan + manual IMEI)
- Device settings configuration
- History generation and plotting
- Push notifications (Android + iOS 16.4+ installed PWA)
- Persistent login

## 2. Non-goals

- Background location / "be tracked" mode in the PWA. Out of scope.
- Forking the build pipeline. One bundle ships to web, Android, and iOS.
- **Offline support.** This app is dependent on an active internet connection and will not function offline. The existing in-app disconnect / error screen handles network loss — no offline-first UX, no queued actions, no offline fallback page, no service-worker-served offline shell. The SW exists to satisfy installability criteria and to host the FCM background-push handler (Phase 8); it is **not** an offline-resilience layer. Reviewers: do not flag missing `navigateFallback`, missing offline page, NetworkFirst-without-cache-fallback, or first-launch-offline failures as issues — they are intentional.
- **Deep linking from `https://track.navitag.com/*`.** No URL on the web origin is intended to auto-route into the PWA or the native apps. All such links open in the user's browser. See the "Landed pre-Phase-1" block above and §7.5 for the regression-prevention rules. Reviewers: do not flag missing Android App Links, missing Universal Links, missing `assetlinks.json`, or missing `apple-app-site-association` as issues — they are intentionally absent.
- **Sunset / migration UX once native apps go live in stores.** New-install suppression, store-redirect CTAs, in-PWA migration prompts, and `prefer_related_applications` manifest handling are explicitly out of scope here. They will be planned and tracked separately when native release is closer to confirmed. This plan covers only getting the PWA installable and functional now.

## 3. Coexistence rules (the hard gate)

`capacitor.config.json:6-7` uses `androidScheme: "https"` / `iosScheme: "https"`, meaning the WebView serves from `https://localhost`. **Service workers can register on that scheme.** Without explicit gating, PWA additions will activate inside the native apps and cause:

- Stale asset caching across native app updates
- Conflicts between the web FCM service worker and the native `@capacitor-firebase/messaging` push handler
- An "Install app" banner appearing inside the already-installed native app

### The single rule

Every PWA-only side effect must check both:

```js
import { Capacitor } from '@capacitor/core';
const isPwaContext = !Capacitor.isNativePlatform() && 'serviceWorker' in navigator;
```

`Capacitor.isNativePlatform()` is `true` only inside the Capacitor-built `.apk`/`.ipa`. It is `false` in any browser context — including a PWA installed to the home screen and launched in `display-mode: standalone`. The installed PWA therefore takes the **web path** through `utils/http.js` and inherits all browser cookie/CORS behavior, not the manual native-injection path.

Apply the gate to:
- Service worker registration (Workbox + firebase-messaging-sw)
- `beforeinstallprompt` capture
- `<InstallPrompt />` render guard
- `useInstallState()` first branch
- Any `display-mode: standalone` matchMedia check

### Defensive cleanup

Run unconditionally at app startup. No-ops on a clean native install; cleans up if a buggy build ever leaked an SW into the WebView:

```js
if (Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .catch(() => {});
}
```

## 4. Per touch-point coexistence audit

| Change | Native impact | Mitigation |
|---|---|---|
| `manifest.webmanifest` linked in `<head>` | Inert — WebView ignores manifest | None needed |
| `apple-mobile-web-app-*` meta tags | Inert in WKWebView (only Safari reads) | None needed |
| `<link rel="apple-touch-icon">` | Inert in WKWebView | None needed |
| Workbox service worker registration | Would register in WebView | Hard gate |
| `firebase-messaging-sw.js` registration | Would conflict with native push | Hard gate |
| `beforeinstallprompt` listener | Never fires in WebView | Safe; still gate |
| Inline install/notification toasts in `App.vue` | Would show banner inside native app | Early-return on `isNativePlatform()` |
| `display-mode: standalone` matchMedia | Returns false in WebView | Check `isNativePlatform()` first |
| Camera/QR scan | Unchanged — `@capacitor/barcode-scanner` already dual-mode (`linkDevice/start.vue:24`); web fallback uses `getUserMedia` which SW doesn't intercept | Verified safe |
| `utils/http.js` web/native branching | Already exists and untouched | None needed |
| Firebase auth (`utils/auth.js`) | Already uses `signInMode = 'redirect'` on web, untouched on native | See §5 — needs standalone-PWA test |
| Bundle output | Same `dist/` ships to both | All gating is runtime |

## 5. Per-feature feasibility

| Requirement | Verdict | Notes |
|---|---|---|
| View live tracking | ✅ Verified | `utils/http.js` web path uses `ky` + `credentials:'include'`. Same-site cookie flow between `track.navitag.com` and `tserver1.navitag.com` (shared eTLD+1 = `navitag.com`) means default `SameSite=Lax` permits cookie attachment cross-origin. Currently working in production browsers. WebSocket inherits the same cookie path. |
| Add device (QR scan) | ✅ Fully | `linkDevice/start.vue:24` already pre-checks `getUserMedia`; manual IMEI fallback exists. Requires HTTPS (have it). |
| Device settings | ✅ Fully | Pure HTTP, no native deps. |
| History + plotting | ✅ Fully | Same HTTP + Leaflet stack. |
| Push notifications | ⚠️ Conditional | Android Chrome/installed PWA: full parity. iOS Safari 16.4+: only after Add to Home Screen. iOS < 16.4: not supported. The Capawesome `@capacitor-firebase/messaging` plugin's web fallback accepts `getToken({ vapidKey, serviceWorkerRegistration })` — confirmed against the plugin docs. Existing `retrieveAndPersistFcmToken()` in `stores/user.js` needs a web branch to pass `serviceWorkerRegistration` to `getToken()` (see Phase 8). |
| Persistent login | ⚠️ Mostly | Firebase: persists in IndexedDB, redirect mode already used (`utils/auth.js:9`). **Open: Capawesome auth doc warns redirect mode "can be problematic in installed PWAs due to app lifecycle interruptions."** Needs a real-device test inside `display-mode: standalone`; if `getRedirectResult()` is dropped, switch to popup specifically when standalone. iOS Safari ITP purges site data after 7 days idle → forced re-login (handled by existing token-refresh path). |

## 5.5 Prompt behavior spec (install + notifications)

Both prompts are **toasts at the top of the screen** (`top-[calc(env(safe-area-inset-top)+12px)] left-4 right-4 z-50`). Both are **site-wide / PWA-wide** — no route-based hiding. Suppression of one in favor of the other is sequencing-driven, not route-driven.

### Decision tree — which toast (if any) to show

Evaluated as a single computed in `App.vue`. **For the initial release the install toast is suppressed (see resolved decisions at top); the tree below documents the full design but currently the INSTALL branch is short-circuited to render nothing, so notification toast eligibility is evaluated immediately on web.**

```
if running in native app                     → render nothing
if not logged in                             → render nothing
if already installed (display-mode standalone)
  └─ permission state in {prompt, default}
     and no notification cooldown active     → render NOTIFICATION toast
  └─ otherwise                               → render nothing
else (web, not installed)
  ├─ install eligible (mobile/tablet, beforeinstallprompt
  │  fired, install cooldown clear)          → render INSTALL toast    ← SUPPRESSED at launch
  └─ otherwise (install resolved or skipped)
     and permission state in {prompt, default}
     and no notification cooldown active     → render NOTIFICATION toast
```

With the install toast suppressed, the effective tree collapses to:

```
if running in native app                     → render nothing
if not logged in                             → render nothing
if permission state in {prompt, default}
   and no notification cooldown active       → render NOTIFICATION toast
otherwise                                    → render nothing
```

Re-enabling the install toast later is a one-line revert: drop the suppression flag in the `currentToast` computed and the full tree above takes effect again. All listeners and stores already in place from Phase 4 — no migration.

### Install toast

- Renders only on web (not standalone PWA, not native).
- Mobile/tablet only: gated by `matchMedia('(pointer: coarse)').matches` (see §3 / Phase 3).
- Requires a captured `beforeinstallprompt` event (`installStore.deferred !== null`) — never shows during the cooldown-expired-but-no-refire gap.
- Two actions:
  - **Install** → calls `installStore.deferred.prompt()`, awaits `userChoice`, regardless of `accepted`/`dismissed` clears `deferred` and treats install as resolved (the next computed evaluation will fall through to notification toast logic).
  - **Dismiss** → writes `pwa_install_dismissed_at = Date.now()` to `localStorage`, treats install as resolved.
- Cooldown after dismissal: **3 days.** If user dismisses, install toast doesn't reappear for 3 days.
- After install completes (`appinstalled` fires), `localStorage.setItem('pwa_installed', 'true')` — install toast permanently suppressed (the `display-mode: standalone` check on next launch handles this anyway, but the flag covers the immediate post-install render before the next launch).

### Notification toast

- Renders on both web (post-install-resolved) and installed PWA (immediately, no install step).
- Same component / template as the existing push toast that landed pre-Phase-1 (top position, Enable / Dismiss buttons).
- Shows only when `pushPermission === 'prompt'` (or `'default'`). `'granted'` and `'denied'` suppress.
- Cooldown after dismissal: **7 days.** Already implemented via `pwa_push_dismissed_at` localStorage key.

### Sequencing — what "install resolved" means

The install toast is "resolved" when **any** of:
- User tapped Install and `userChoice` settled (regardless of accepted/dismissed)
- User tapped Dismiss
- `appinstalled` fired
- Install was never eligible in the first place (desktop, in-app webview, iOS, beforeinstallprompt never fired)

Once resolved within a session, the notification toast becomes eligible to render on the next computed evaluation. Implementation: a session-scoped flag (e.g. `installStore.resolvedThisSession = true`) that the computed checks. Doesn't need to persist across sessions — each new session re-evaluates from scratch.

### Why top-of-screen

Bottom positioning conflicts with `<BottomNav>` (when shown) and with map controls (when on map routes). Top positioning sits in or just below the safe-area inset, doesn't overlap any existing UI, and matches platform toast conventions (iOS/Android system toasts default to top).

### Why site-wide / PWA-wide

User directive. No `route.meta.fullscreen` flag is needed for prompt suppression — that requirement is dropped. The flag may still find use later for other overlay decisions, but neither toast reads it.

## 6. Implementation TODOs

Ordered by dependency. Each phase is independently testable.

### Phase 1 — Manifest + service worker scaffold

- [ ] **Overwrite the existing broken `public/manifest.webmanifest`.** Current file references `../icons/icon-*.webp` paths that don't exist, and lies about MIME (`image/png` declared on `.webp` files). Not currently linked from `index.html`. Replace wholesale.
- [ ] Add `vite-plugin-pwa@^1.3.0` to `vite.config.js` with `injectRegister: null` and `registerType: 'autoUpdate'`. Manual registration only.
- [ ] Configure manifest fields: `name`, `short_name`, `start_url: '/'`, `scope: '/'`, `display: 'standalone'`, `theme_color`, `background_color`, `id`.
- [ ] Generate icons 192×192 and 512×512 PNG plus a 512 with `purpose: 'maskable'`. Use PNG, not WebP — iOS PWA install does not reliably accept WebP icons. **The maskable variant must use a center safe-zone of 80% — `@capacitor/assets` source art does not account for this and will get clipped on Android adaptive icons. Generate maskable separately or pad the source.** Output to `public/icons/` (does not currently exist).
- [ ] Add `<link rel="manifest" href="/manifest.webmanifest">` to `index.html` (currently bare).
- [ ] Use vite-plugin-pwa's default `generateSW` precaching of bundled assets (hashed JS/CSS/HTML/icons). `NetworkFirst` navigation handler so online users always see the latest `index.html`. No precache of API or Traccar. **No `navigateFallback` and no offline fallback page** — per §2 non-goals, the app requires internet and the existing in-app disconnect screen owns the offline UX. The SW is here for installability + FCM hosting, not offline resilience.
- [ ] Create `src/utils/pwa.js` exporting `registerPwa()` that runs the hard gate and dynamic-imports `virtual:pwa-register`. Call site is one line: `registerSW({ immediate: true })` — no `onNeedRefresh`/`onOfflineReady` hooks needed.
- [ ] Call `registerPwa()` from `main.js`. Order relative to `LifecycleService.init()` is irrelevant — the gate uses `Capacitor.isNativePlatform()` which works pre-init.
- [ ] Add the defensive native-side unregister loop in the same `pwa.js` file.

### Phase 2 — iOS-specific HTML head

Add to `index.html` (inert in WKWebView, so safe to ship in native too):

- [ ] `<link rel="apple-touch-icon" sizes="180x180" href="...">`
- [ ] `<meta name="apple-mobile-web-app-capable" content="yes">`
- [ ] `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` — **`black-translucent` (not `default`) so the Leaflet canvas can extend under the status bar; mirrors the existing `adjustMarginsForEdgeToEdge` config in `capacitor.config.json:15`.**
- [ ] `<meta name="apple-mobile-web-app-title" content="Navitag">`
- [ ] *(Optional — high effort, skip unless designer-led)* `apple-touch-startup-image` per device size.

### Phase 3 — Install-state detection

- [ ] Create `src/composables/useInstallState.js` returning one of: `native | installed | androidReady | iosManual | unsupported`. **No `desktop` state** — desktop falls into `unsupported` (see resolved decisions at top).
- [ ] First branch: if `Capacitor.isNativePlatform()` → `'native'`. Hides everything.
- [ ] Installed: `matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`.
- [ ] **Mobile/tablet gate (load-bearing):** `matchMedia('(pointer: coarse)').matches`. If false → `'unsupported'`. This is the single signal that maps "primarily a touch device" to "we promote install here." Phones + tablets pass; desktop with mouse/trackpad fails; Surface-style touch laptops fail (their primary pointer is still mouse). All subsequent state checks happen *only after* this gate passes.
- [ ] iOS detection: `/iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)` (iPadOS 13+ pretends to be Mac).
- [ ] iOS-Safari-only: UA must NOT include `CriOS|FxiOS|EdgiOS`.
- [ ] In-app browser detection (concrete patterns): `FBAN|FBAV|FB_IAB` (Facebook/Messenger), `Instagram`, `musical_ly|BytedanceWebview` (TikTok), `Line`, `Twitter`. → `'unsupported'`.

### Phase 4 — Install prompt flow (Android + tablet Chromium)

**Status note for the initial release: the install toast is suppressed (see resolved decisions at top). The listeners and store wiring below STILL ship — capturing `beforeinstallprompt` is cheap, harmless, and keeps the deferred event ready for the day we flip the suppression off. What does NOT ship at launch is the toast render and the dismissal-cooldown plumbing; both are wired up but `currentToast` returns `null` for the install branch unconditionally.**

- [ ] In `pwa.js` (gated by both the §3 native gate AND `matchMedia('(pointer: coarse)').matches`): listen for `beforeinstallprompt`, stash event in a Pinia store (`stores/install.js` — fields: `deferred`, `resolvedThisSession`, `installed`). **Conditionally `preventDefault()` based on `INSTALL_TOAST_ENABLED`:**
  - When `INSTALL_TOAST_ENABLED === false` (launch state): **do NOT call `e.preventDefault()`.** Let Chrome surface its built-in mini-infobar so motivated mobile users can self-install via the same path desktop users get. The event still gets stashed in `installStore.deferred` for future re-enable; Chrome's mini-infobar handles the actual installation flow in this state.
  - When `INSTALL_TOAST_ENABLED === true` (re-enabled later): **call `e.preventDefault()`** to suppress Chrome's mini-infobar so our custom toast owns the install promotion.

  **Desktop is intentionally excluded from this listener** regardless of state — Chrome/Edge's built-in mini-infobar always surfaces unmodified on desktop for self-install. See resolved decisions at top. *Ships at launch even though our toast is suppressed — the deferred event needs to be captured for future re-enable, and the conditional preventDefault keeps Chrome's mini-infobar functional in the meantime.*
- [ ] Listen for `appinstalled` → `installStore.installed = true`, set `localStorage.setItem('pwa_installed', 'true')`, clear `deferred`. (No analytics — see resolved decisions at top.) *Ships at launch — users who self-install via the browser's mini-infobar still need this so the PWA-installed state is recorded.*
- [ ] **Toast visibility (load-bearing — closes the cooldown-no-refire gap; not in effect at launch — see status note above):** the install toast renders only when **all** are true:
  1. Web context (not native, not already installed)
  2. `matchMedia('(pointer: coarse)').matches`
  3. `installStore.deferred !== null` (a live captured event we can call)
  4. `installStore.resolvedThisSession === false`
  5. `localStorage.pwa_install_dismissed_at` is older than 3 days (or absent)
  6. `localStorage.pwa_installed !== 'true'`

  Without rule 3, when the cooldown expires but Chrome hasn't yet refired `beforeinstallprompt`, the button would render with `deferred = null` and tapping it would silently no-op. Hide instead until refire.
- [ ] Install action → `installStore.deferred.prompt()`, `await deferred.userChoice`, set `deferred = null` and `resolvedThisSession = true` regardless of accepted/dismissed.
- [ ] Dismiss action → `localStorage.setItem('pwa_install_dismissed_at', Date.now())`, set `resolvedThisSession = true`.
- [ ] **Re-prompt mechanics: the captured event is single-use.** After dismissal, the original event is spent. Listen for the next `beforeinstallprompt` fire (Chrome refires after engagement heuristics) to re-arm `installStore.deferred` — do not assume the original event can be reused.
- [ ] Sequencing — when the install toast resolves (`resolvedThisSession = true`), the next computed evaluation in `App.vue` falls through to the notification toast logic if push permission is in `'prompt'` state. See §5.5 decision tree.

### Phase 5 — iOS coachmark

**Status note for the initial release: the iOS coachmark is suppressed alongside the install toast (see resolved decisions at top). Build the component if convenient, but do not render it. iOS users who want to install can still self-serve via Safari's built-in Share → Add to Home Screen — same path as desktop self-install.**

- [ ] Modal/bottomsheet component: tap Share icon → "Add to Home Screen" → "Add". Use the actual iOS Share glyph SVG. *Optional at launch — defer until install prompts are re-enabled.*
- [ ] Render only when state === `'iosManual'` *and* the install-toast suppression flag is off.
- [ ] Detection of dismissal relies on next-launch `display-mode: standalone` flip — no programmatic confirmation. Acceptable; the Phase 6 cooldown is the only suppression mechanism on iOS.

### Phase 6 — UX gating

- [ ] **Value-moment gate is dropped per the §5.5 spec.** Both prompts are site-wide / PWA-wide; gating reduces to "logged in" plus the per-toast eligibility rules. The map-rendered / has-device pre-conditions previously listed here are no longer used. (Rationale: user directive — install + notification prompts are visible immediately once logged in, sequenced by the §5.5 decision tree.)
- [ ] Persist install dismissal: `localStorage` key `pwa_install_dismissed_at`, **3-day cooldown** (per §5.5).
- [ ] Persist notification dismissal: `localStorage` key `pwa_push_dismissed_at`, **7-day cooldown** (per §5.5; already implemented in the landed App.vue toast).
- [ ] **Note: iOS Safari ITP purges `localStorage` after ~7 days of inactivity**, so the effective iOS cooldown for the 7-day notification window collapses to ~7 days max regardless and the 3-day install window is largely unaffected. Acceptable; document but do not work around.
- [ ] Hard-suppress install toast forever after `appinstalled` (`localStorage.pwa_installed = 'true'`).
- [ ] Suppress both toasts inside iframes (`window.top !== window.self`).

### Phase 7 — Component placement

- [ ] No separate `<InstallPrompt />` component file. Both toasts live inline in `App.vue` (matches the pattern of the already-landed notification toast). Each toast is a `<div v-if="...">` block; visibility is driven by a single `currentToast` computed that returns `'install' | 'notification' | null` per the §5.5 decision tree. **At launch, the `currentToast` computed short-circuits the `'install'` branch to `null` (see resolved decisions at top) — concretely, the first check in the computed is `const INSTALL_TOAST_ENABLED = false;` (or equivalent named flag) and the install-eligible branch returns `null` when that's false. Re-enabling later: flip the constant to `true`. Notification-toast logic is unaffected by the flag.**
- [ ] **Site-wide / PWA-wide visibility — no `route.meta.fullscreen` flag.** Per resolved decisions, both prompts show on every authenticated route. Top-of-screen positioning avoids conflict with `<BottomNav>` and map controls.
- [ ] *(Optional)* Add a "Install app" link in `views/account/index.vue` that calls `installStore.deferred.prompt()` if available, or re-opens the iOS coachmark on demand. Useful for users who dismissed and want to install later within the cooldown window.

### Phase 8 — Push notification SW (separate from Workbox)

- [ ] **Place `firebase-messaging-sw.js` at `public/firebase-messaging-sw.js`.** Vite copies `public/` to `dist/` root unprocessed. The Capawesome doc requires this file at the **domain root** (`/firebase-messaging-sw.js`), not a subpath.
- [ ] **Populate the SW for background notifications (Option A — `importScripts` from gstatic).** Foreground-only is rejected: tracking notifications are inherently background events, and Chrome's "must show notification" rule will surface generic "site updated in background" toasts if push events arrive at a registered SW that doesn't display anything. SW body:

  ```js
  // public/firebase-messaging-sw.js
  // VERSION SYNC: keep the version in the URLs below in lockstep with
  // package.json -> dependencies.firebase. See "Firebase version-sync protocol"
  // at the end of Phase 8.
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

  firebase.messaging();
  ```

  No `onBackgroundMessage` handler at first — Firebase auto-displays system notifications when the FCM payload includes `notification` fields. **Verified against backend (2026-05-08):** every push in `../api.navitag.net/v1` flows through `Services/PushService.php::sendToToken()`, which unconditionally attaches `->withNotification(FirebaseNotification::create($title, $body))` at line 71. `PushService` is the **only** call site for `CloudMessage` / `getMessaging()->send()` in the backend — grep-confirmed no other path exists. The auto-display path is therefore safe; reviewers should not flag this as unverified. Add a custom handler later if and only if rich actions, custom icons, or deep-link-on-tap are required (none of which are in scope for the stopgap).
- [ ] **Replace the protocol heuristic at `stores/user.js:94, 111`** (`window.location.protocol === 'http:'`) with `FirebaseMessaging.isSupported()`. The plugin's capability check correctly returns false on iOS Safari < 16.4, missing Push API, non-installed iOS PWAs, etc. Per Capawesome doc, `isSupported()` always returns true on Android/iOS native, so it's a no-op on the existing native path.

- [x] ~~**Gate `requestPermissions()` behind a user gesture on web.**~~ **Landed pre-Phase-1 — see "Landed pre-Phase-1" block at the top of this doc.** The existing check-then-request pattern in `initPushNotifications` (`stores/user.js:116-119`) protects already-granted users from re-prompting, but first-time web users (state = `'prompt'`) hit `requestPermissions()` directly with no user gesture behind it. Chrome demotes this to "quiet UI" (a near-invisible URL-bar icon); iOS Safari requires a gesture for `Notification.requestPermission()` and silently auto-denies without one. Recovery on iOS requires the user to dig into Settings → Safari → site permissions, so the cost of getting this wrong is high.

  **Implementation — minimal change:**

  Add a single `if (!Capacitor.isNativePlatform())` branch immediately before the existing `requestPermissions()` call at line 118. On the web branch: do not call `requestPermissions()` here. Instead, set a Pinia flag (e.g. `userStore.showPushEnableToast = true`) that surfaces a custom clickable toast. The toast's onClick handler — which **runs synchronously inside a user gesture** — calls a new exported action `enablePushFromGesture()` that performs the actual `requestPermissions()` + `getToken()` + backend persist.

  Sketch:

  ```js
  // stores/user.js — initPushNotifications, replacing the existing line 117-119
  let status = await FirebaseMessaging.checkPermissions();
  if (status.receive !== 'granted') {
    if (!Capacitor.isNativePlatform()) {
      // Web: defer permission request to a user gesture.
      // Toast onClick will call enablePushFromGesture() below.
      pushPermission.value = status.receive;
      showPushEnableToast.value = true;
      return status.receive;
    }
    status = await FirebaseMessaging.requestPermissions();
  }
  pushPermission.value = status.receive;
  // ... existing token retrieval continues unchanged
  ```

  ```js
  // stores/user.js — new exported action, called from the toast's @click
  async function enablePushFromGesture() {
    const status = await FirebaseMessaging.requestPermissions();
    pushPermission.value = status.receive;
    showPushEnableToast.value = false;
    if (status.receive === 'granted') {
      // Same token-retrieval block currently at lines 123-145.
      // Extract into a helper so initPushNotifications and this action
      // share one code path, no duplication.
      await retrieveAndPersistFcmToken();
    }
  }
  ```

- [x] ~~**Render the web permission toast directly in `App.vue`.**~~ **Landed pre-Phase-1.** Inline toast in `App.vue` (no separate component), positioned at top-of-screen, site-wide visibility, 7-day dismiss cooldown. The actual landed implementation supersedes the original sketch in earlier revisions of this doc — see `src/App.vue` (toast markup, `showPushToast` computed, `dismissPushToast` helper) and `src/stores/user.js` (`showPushEnableToast` state, `enablePushFromGesture` action) for the source of truth. Behavior rules are documented in §5.5 Prompt behavior spec.
- [ ] **Add the web branch to `stores/user.js:123`.** Existing call:
  ```js
  FirebaseMessaging.getToken({ vapidKey: '...' })
  ```
  Web requires the SW registration too:
  ```js
  const options = { vapidKey: '...' };
  if (Capacitor.getPlatform() === 'web') {
    options.serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  }
  const result = await FirebaseMessaging.getToken(options);
  ```
- [ ] **Send the full payload shape to `/user/fcm-token`.** Backend at `../api.navitag.net/v1/src/Controllers/User.php:399` accepts `{ fcm_token, platform, device_label }`. The current call in `stores/user.js:118-124` only sends `{ fcm_token }`, leaving `platform` and `device_label` null — backend tolerates this via COALESCE upserts but loses per-token attribution (which device installed the PWA, which platform, etc.) which becomes useful when debugging push delivery failures or pruning stale device entries.

  Update the POST body to include `platform` (always) and `device_label` (best-effort):
  ```js
  // stores/user.js — inside retrieveAndPersistFcmToken, replacing the
  // existing data: { fcm_token: result.token } body
  const platform = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'
  const deviceLabel = (() => {
    if (Capacitor.isNativePlatform()) {
      // Native: leave undefined; backend stores null. Could be enriched
      // later via @capacitor/device if useful, but not blocking.
      return undefined;
    }
    // Web: a coarse UA-derived label is plenty — the goal is human
    // recognizability in the backend admin UI ("Chrome on Android",
    // "Safari on iPhone"), not a fingerprint.
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'Safari (iOS web)';
    if (/Android/.test(ua))          return 'Chrome (Android web)';
    if (/Mac/.test(ua))              return 'Safari (macOS web)';
    if (/Windows/.test(ua))          return 'Chrome (Windows web)';
    return 'Web';
  })();

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
  ```

  This is a small two-property addition. Backend already handles missing fields gracefully (User.php:416 — `null` fallback + UPSERT COALESCE preserves prior values), so old installations remain intact when the new code first runs against them.
- [ ] **Verify two SWs coexist by scope.** Workbox SW registers at `/sw.js` with scope `/`. The FCM SDK registers `firebase-messaging-sw.js` with scope `/firebase-cloud-messaging-push-scope`. They don't race because push events route only to the FCM SW. One sentence in code comments to prevent future confusion.
- [ ] Verify the existing `notificationReceived` listener at `stores/user.js:143` still fires on web (it should — Capawesome's plugin proxies to the JS SDK's `onMessage`). Per Capawesome doc, `notificationActionPerformed` is Android/iOS only, so don't add a tap-handler listener for web.
- [ ] *(Optional)* Add `FirebaseAuthentication.setPersistence({ persistence: 'local' })` on web in `src/firebase.js`. Firebase's default is already IndexedDB; explicit is safer for the persistent-login goal.

#### Firebase version-sync protocol (maintenance)

Option A keeps the Firebase SDK version pinned in **two** places that must stay aligned:

1. `package.json` → `dependencies.firebase` (drives the bundled `src/firebase.js`)
2. `public/firebase-messaging-sw.js` → the two `importScripts(...)` URLs (drives the SW)

A version skew between these is a real maintenance trap: the SW silently keeps loading the old version from gstatic while the bundled SDK upgrades. In practice the Firebase compat surface is stable across minor versions and skew rarely manifests as a runtime bug — but when it does, the symptom (background notifications silently stop firing for some users) is annoying to track down.

**Rules of the road:**

- **Whenever `package.json`'s `firebase` version changes, update both `importScripts` URLs in `firebase-messaging-sw.js` in the same commit.** Do not split across commits — that creates a deploy window where the two are out of sync.
- **The SW URLs must use the exact resolved version**, not a range. `^12.8.0` in `package.json` may resolve to `12.8.3`; the SW URL must read `12.8.3`, not `12.8.0`. Check the resolved version via `npm ls firebase` after `npm install`.
- **Add a guard comment at the top of `firebase-messaging-sw.js`** (already shown in the SW body above) so the next person editing it sees the rule.
- **On every Firebase upgrade PR, the reviewer must visually verify both files moved together.** Treat the SW as part of the upgrade, not an afterthought.
- **Optional belt-and-suspenders:** add a one-line build-time check (e.g. a tiny Node script in a `prebuild` npm script, or a lint rule) that reads `package.json`'s firebase version, greps the SW for that version string, and fails the build on mismatch. ~10 lines. Worth it once the team has churned a few Firebase upgrades and felt the pain.
- **If we ever need to escape this trap entirely**, the migration path is Option B (bundled SW via `vite-plugin-pwa` `injectManifest` mode) — the modular SDK imports give a single source of truth. Out of scope for the stopgap PWA but documented here for future reference.

### Phase 9 — README maintenance documentation

After the implementation phases land, add a `PWA maintenance` subsection to `README.md` (under the existing `## Project Status`, alongside `Lifecycle Service`, `Auth / SSO`, etc.). Goal: capture the operational knowledge a future contributor needs **without** requiring them to re-read this proposal — `PROPOSED_PWA.md` will eventually be archived; the README is the durable artifact.

Length target: ~80 lines. If a topic needs more, link to `PROPOSED_PWA.md` while it still exists, then copy the relevant content into README at archive time.

Sections to add, each as a short paragraph or bullet group:

- [ ] **Stopgap framing.** One sentence: PWA was added as a temporary stopgap during the native store release delay. Sunset / migration to native stores will be planned separately. Don't invest in PWA-only features beyond the §1 minimum parity list.

- [ ] **The hard gate.** `Capacitor.isNativePlatform()` separates PWA-only code paths from native. Any new service-worker registration, `beforeinstallprompt` handler, `display-mode` check, or web-only push code must respect this gate. Point to `src/utils/pwa.js` for the canonical pattern. One paragraph + the 2-line code sketch from §3.

- [ ] **Two service workers, separate scopes.** Workbox at `/sw.js` (scope `/`) handles app-shell caching. FCM at `/firebase-messaging-sw.js` (scope `/firebase-cloud-messaging-push-scope`) handles background push. They don't conflict — push events route only to the FCM SW. One sentence so the next person doesn't try to merge or "consolidate" them.

- [ ] **Firebase version-sync rule (load-bearing).** Short form of the Phase 8 protocol:
  - When bumping `firebase` in `package.json`, update **both** `importScripts` URLs in `public/firebase-messaging-sw.js` to the **same resolved version** (`npm ls firebase`) in the **same commit**.
  - Reviewer must verify the SW moved with the package on every Firebase upgrade PR.
  - The guard comment at the top of `firebase-messaging-sw.js` exists for exactly this reason.

  Cross-link to PROPOSED_PWA.md Phase 8 while it exists; copy the rule body into README at archive time.

- [ ] **SW kill-switch protocol.** Never rename or delete `sw.js` or `firebase-messaging-sw.js` without first deploying a stub SW that calls `self.registration.unregister()` + `clients.claim()`. Otherwise installed users are stuck on the old SW indefinitely — Vercel's SPA fallback will serve `index.html` at the missing path, the browser will fail to parse HTML as JS, and the old SW will keep running. Two sentences in README + procedure outline.

- [ ] **Asset regeneration warning.** PWA icons live at `public/icons/icon-{192,512,512-maskable}.png` and `public/apple-touch-icon.png` — hand-authored PNG. **Do not run `npx capacitor-assets generate` against the PWA target** — it produced the originally broken `manifest.webmanifest` (wrong MIME on `.webp` files, missing icon files, incorrect maskable safe-zone). Use `@capacitor/assets` for native icons/splashes only. Document the source art locations: `assets/logo.png` (full-bleed), `assets/icon-foreground.png` + `assets/icon-background.png` (maskable layers).

- [ ] **Native regression smoke test.** Condensed version of §7.3 — the fast checks to run after any PWA-touching change before merging:
  1. Native console at startup shows no SW registration messages
  2. `navigator.serviceWorker.getRegistrations()` returns `[]` on native after the defensive unregister
  3. No "Install app" banner anywhere in the native app
  4. FCM push received via native plugin (not web SW)
  5. QR scanner opens the native scanner UI, not the `getUserMedia` overlay

  Full matrix lives in PROPOSED_PWA.md §7.3 / future test plan; this is the 5-minute version.

- [ ] **Vercel deploy / cache headers.** One-liner: SW files (`sw.js`, `firebase-messaging-sw.js`) must be served with `Cache-Control: public, max-age=0, must-revalidate`. Vercel's default for non-hashed static files already handles this — do not override in `vercel.json` without re-confirming SW headers.

- [ ] **No deep-linking (regression-prevention rule).** `track.navitag.com/*` links are intentionally configured to always open in the browser, never to auto-route into the PWA or native app. Three things stay coordinated to keep this true:
  1. `android/app/src/main/AndroidManifest.xml` MUST NOT contain an `<intent-filter>` for `https://track.navitag.com`.
  2. `public/.well-known/assetlinks.json` MUST NOT exist (or, if added, MUST NOT include this app's package + fingerprint).
  3. `public/manifest.webmanifest` MUST NOT include a `capture_links` field.
  4. No `apple-app-site-association` file should be published to the web origin.

  If any of these change, links will silently start routing differently and users will be confused. Treat this as load-bearing project policy, not a default.

- [ ] **Testing entry points.** Pointer to full functional/install/regression test matrix in PROPOSED_PWA.md §7.1–§7.4 while it exists. Quick smoke listed: Lighthouse PWA audit, Chrome DevTools → Application → Manifest (no warnings, "Installable"), "Add to Home Screen" flow on Android Chrome and iOS Safari 16.4+.

- [ ] **Cross-link from `## TODO`.** Add a one-liner under the existing TODO checklist: "PWA maintenance — see PWA maintenance section under Project Status." Keeps the section discoverable from the top of the README.

Execution note: Phase 9 should land in the same PR as Phase 8 (or immediately after), not deferred — the SW kill-switch and version-sync rules are most valuable *before* the team has the chance to violate them. A README that documents protocols nobody knew existed is the cheapest insurance in the plan.

## 7. Testing tasks

### 7.1 PWA functional tests (web only)

- [ ] Chrome DevTools → Application → Manifest: no warnings, "Installable" status.
- [ ] Lighthouse PWA audit passes (installable + PWA optimized).
- [ ] Service worker registers on first load; no errors in console.
- [ ] Hard reload after a code change: SW activates new version (autoUpdate behavior).
- [ ] Live tracking works in PWA tab and after Add to Home Screen launch.
- [ ] QR scan opens `getUserMedia` overlay; manual entry fallback works.
- [ ] Device settings save and reload correctly.
- [ ] History generation renders polylines on Leaflet.
- [ ] FCM token mints on web; backend `/user/fcm-token` POST returns 200.
- [ ] Background push received with app closed (Android only at first).
- [ ] **SSO redirect-mode in `display-mode: standalone`** — open the installed PWA, sign out, sign in via Google or Apple. Confirm `getRedirectResult()` round-trips correctly. If broken, switch redirect→popup when `matchMedia('(display-mode: standalone)').matches`.

### 7.2 Install prompt tests

- [ ] **Android Chrome (real device):** install toast renders site-wide once `beforeinstallprompt` fires (per §5.5 — no value-moment gate), install completes, app opens in standalone, icon on home screen, splash renders. Repeat in Edge.
- [ ] **iOS Safari 16.4+ (real device):** coachmark renders, manual install completes, icon + splash render correctly, `display-mode: standalone` is true after re-launch from home screen.
- [ ] **iOS Chrome (CriOS):** coachmark suppressed (Chrome on iOS can't install). Verify no prompt shown.
- [ ] **Already-installed device:** no prompt shown on re-visit.
- [ ] **Dismissed:** install toast suppressed for 3 days (per §5.5); notification toast suppressed for 7 days. iOS Safari ITP may purge `localStorage` after ~7 days idle, collapsing both windows on iOS.
- [ ] **In-app webview** (open URL from Slack/Messenger/Instagram): no prompt shown.
- [ ] **Iframe embed:** no prompt shown.

### 7.3 Native regression tests (the coexistence proof)

These are the tests that prove the PWA work didn't break the native apps. All must pass on a fresh `npm run build && npx cap sync && npx cap run <platform>`.

#### Android

- [ ] Console at startup shows no service worker registration messages.
- [ ] `navigator.serviceWorker.getRegistrations()` returns `[]` after the defensive unregister has run.
- [ ] No "Install app" banner anywhere in the app.
- [ ] FCM push notification received via native plugin (not via web SW).
- [ ] QR scanner opens the **native** barcode scanner UI, not the `getUserMedia` overlay.
- [ ] Google + Apple SSO complete via native flow.
- [ ] Traccar session cookie attaches to `/api/socket` WebSocket via `session_id` query param.
- [ ] Backgrounding and resuming the app does not show stale data from a SW cache.

#### iOS

- [ ] Same console / SW / install-banner checks as Android.
- [ ] `apple-mobile-web-app-*` meta tags do not affect WKWebView rendering (status bar, viewport unchanged).
- [ ] FCM push (APNs) received via native plugin.
- [ ] QR scanner opens native scanner.
- [ ] SSO completes via native flow.

#### Build artifacts

- [ ] `dist/` after `npm run build` contains `manifest.webmanifest` and `sw.js` — confirms web build is correct.
- [ ] After `npx cap sync`, those files are present in `android/app/src/main/assets/public/` and `ios/App/App/public/` — they're harmless there because the runtime gate prevents activation. Small APK/IPA size hit, negligible.

### 7.4 Backend / infra prerequisites

**All verified working — no action required.**

- ✅ `track.navitag.com` SPA history-mode fallback on Vercel — confirmed via `curl https://track.navitag.com/some/random/path` returning the `index.html` shell with `200 text/html`. Vercel's Vite framework preset handles this.
- ✅ Vercel cache headers for SW files — Vercel's default for non-hashed static files is `Cache-Control: public, max-age=0, must-revalidate`, which is exactly what `sw.js` and `firebase-messaging-sw.js` need. Edge cache purges on every deploy.
- ✅ `api.navitag.net` and `tserver1.navitag.com` CORS — both emit `Access-Control-Allow-Credentials: true` and `Access-Control-Allow-Origin: https://track.navitag.com` (verified via OPTIONS preflight).
- ✅ Traccar session cookie attachment — `JSESSIONID` is emitted with `Path=/; HttpOnly` only, but because `track.navitag.com` and `tserver1.navitag.com` share the eTLD+1 `navitag.com`, browsers treat the request as **same-site, cross-origin**. `SameSite=Lax` (the implicit default) permits the cookie. The web path through `utils/http.js` and the WebSocket at `:172` both work today in production.
- ✅ Firebase web SDK initialized — `src/firebase.js:18` calls `initializeApp(firebaseConfig)`. No additional setup needed before adding the FCM SW.
- ✅ No conflicting `@capacitor/push-notifications` package — confirmed not in `package.json`. The Capawesome `capacitor-push-notifications` skill documents this as a hard requirement.

### 7.5 Pitfalls to document, not block on

- ~~**Universal Link / App Link collision check.**~~ **Resolved: deep-linking is disabled across the project (Android intent-filter removed, `assetlinks.json` stub deleted, no `apple-app-site-association` to publish).** Links to `track.navitag.com/*` always open in the user's browser — the PWA shell loads from there. See "Landed pre-Phase-1" block at the top of this doc. *Audit retained as a regression check: if anyone re-adds an intent filter or republishes `assetlinks.json` in the future, link routing will silently break.*
- **SW kill-switch protocol.** Once Phase 8 ships, never rename or remove `sw.js` / `firebase-messaging-sw.js` without first deploying a stub SW that calls `self.registration.unregister()` and `clients.claim()`. Otherwise installed users will be stuck on the old SW indefinitely — Vercel's SPA fallback will serve `index.html` at the missing path, the browser will fail to parse HTML as JS, and the old SW will keep running.

## 8. Open questions

- ~~Analytics: do we want install-funnel events wired into `utils/analytics.js`?~~ **Resolved: no.**
- ~~Versioning: silent `autoUpdate` or "new version available" toast?~~ **Resolved: `autoUpdate` (silent).** Mid-session split-version risk is mitigated by Vite's content-hashed chunk filenames — old chunks remain fetchable until the next hard reload, so route navigation mid-update will not 404.
- SSO redirect vs popup in installed standalone PWA — resolve via real-device test in §7.1, not blocking Phase 1.
- ~~`assetlinks.json` policy.~~ **Resolved: no deep-linking. Stub deleted, Android intent-filter removed.** See "Landed pre-Phase-1" block at the top of this doc.

## 9. Rollout plan

**Direct to production — no staging environment, no staged rollout.** Acceptable for the stopgap PWA because (a) the §3 hard gate keeps the PWA bits inert inside the existing native apps, (b) there is no unauthenticated public surface to dark-launch to, (c) install-funnel analytics are out of scope so there's nothing to A/B against, and (d) the install toast is suppressed at launch (per resolved decisions at top), so install rate is expected to be very low — primarily internal testers — which keeps the blast radius of any first-deploy SW regression small in absolute terms.

### 9.1 Pre-merge mitigation steps (load-bearing — these are the substitutes for a missing staging environment)

Before merging the **first** PR that introduces a service worker (i.e., the Phase 1 SW scaffold), the implementer must complete each of the following:

- [ ] **Local build verification.** Run `npm run build` and confirm it succeeds with vite-plugin-pwa added. Adding the plugin to `vite.config.js` changes the build pipeline; if a peer or transitive plugin conflict exists (low probability but nonzero), this is where it surfaces — better here than in production.
- [ ] **Inspect `dist/` output after build.** Confirm the following exist and are non-empty: `dist/manifest.webmanifest`, `dist/sw.js`, `dist/icons/icon-192.png`, `dist/icons/icon-512.png`, `dist/icons/icon-512-maskable.png`, `dist/apple-touch-icon.png`. Confirm the SW file's first ~20 lines reference the precache manifest (auto-generated; sanity check, not a deep audit).
- [ ] **Native regression locally** via `npx cap sync && npx cap run android` (and iOS if available). Run §7.3 checklist. Specifically verify the defensive unregister loop at startup leaves `navigator.serviceWorker.getRegistrations() === []` on the native console.
- [ ] **Lighthouse PWA audit on a Vercel preview deploy** (not the local dev server — `vite dev` does not register the SW the same way as a production build). Open the preview URL in incognito Chrome → DevTools → Lighthouse → "Progressive Web App" category. Status should read "Installable" with no warnings. This is the single most useful pre-merge check; preview deploys are free on Vercel and exercise the actual built artifact, the actual cache headers, and the actual SW scope.

If any of these fails, do not merge. Diagnose first.

### 9.2 First-SW-deploy gating (recommended, not strictly required)

The riskiest single moment in the entire rollout is the first deploy that registers a service worker for live web users. Today there is no SW; tomorrow every web visitor gets one. If that SW has a bug, recovery requires deploying a stub SW that calls `self.registration.unregister()` + `clients.claim()` (the §7.5 kill-switch protocol) — a procedure that has never been exercised in this project.

To de-risk this single deploy, **gate `registerPwa()` behind a query-string feature flag for the first deploy only**:

```js
// src/utils/pwa.js — first-deploy version
export async function registerPwa() {
  if (Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) return;
  // FIRST DEPLOY ONLY: gate behind ?pwa=1 to limit blast radius. Remove
  // this gate in the immediate follow-up deploy once the flagged session
  // verifies the SW registers cleanly and unregisters cleanly via DevTools.
  const params = new URLSearchParams(window.location.search);
  if (!params.has('pwa')) return;

  const { registerSW } = await import('virtual:pwa-register');
  registerSW({ immediate: true });
}
```

Workflow:

1. Deploy with the gate. No regular user gets a SW.
2. Open `https://track.navitag.com/?pwa=1` yourself, walk through DevTools → Application → Service Workers + Manifest. Verify "Installable" status, verify the SW activates, verify a hard reload picks up changes, verify the SW unregisters cleanly via DevTools.
3. Open the same URL on a real Android device, install the PWA, verify `display-mode: standalone` and the existing in-app behavior.
4. Once you're satisfied, push a follow-up deploy that removes the `if (!params.has('pwa')) return;` line. SW now registers for everyone.
5. Monitor crash logs / Sentry / whatever is wired up for ~24h post-removal.

Cost: one extra deploy. Benefit: first-time SW exposure is opt-in for the implementer, not forced on every visitor on day one. **This is worth doing.**

### 9.3 Phase ordering

1. Land Phases 1–2 (manifest + SW scaffold + iOS head tags) **with the §9.2 first-deploy gate.** Run §9.1 mitigation steps. Run §7.3 native regression locally before merging.
2. **Follow-up deploy: remove the §9.2 gate.** Smallest possible diff (one line). Re-verify Lighthouse on prod URL after deploy.
3. Land Phases 3–4 (install state detection + Android listener wiring). Install toast remains suppressed via `INSTALL_TOAST_ENABLED = false` (per resolved decisions). Real-device test: confirm Chrome's mini-infobar surfaces on mobile (since Phase 4 no longer calls `preventDefault` during suppression), confirm our toast does NOT render.
4. Land Phase 8 (FCM SW + `retrieveAndPersistFcmToken` web branch + full payload to `/user/fcm-token`). Validate FCM round-trip in a deployed browser session: open `https://track.navitag.com` in Chrome, enable notifications via the existing toast, verify a backend-triggered push reaches the SW and renders a system notification.
5. Land Phase 9 (README maintenance docs) in the same PR as Phase 8.
6. Phase 5 (iOS coachmark) deferred until install promotion is re-enabled.

Final §7.3 native regression pass on `main` before/after each deploy. Monitor crash logs post-deploy; no install funnel to monitor (per resolved decisions).

Phases may be bundled into fewer PRs at the implementer's discretion, **except** that §9.1 mitigation steps and §9.2 first-deploy gate apply to whichever PR first introduces the SW — those cannot be skipped or deferred to a "we'll verify after merging" pass.

## 10. References

- Capawesome `capacitor-push-notifications` skill: `~/.claude/plugins/marketplaces/capawesome-skills/skills/capacitor-push-notifications/`
- Capawesome `capacitor-vue` skill: `~/.claude/plugins/marketplaces/capawesome-skills/skills/capacitor-vue/`
- Capawesome FCM plugin docs: https://capawesome.io/docs/plugins/firebase/cloud-messaging/
- Capawesome Auth plugin docs: https://capawesome.io/docs/plugins/firebase/authentication/
