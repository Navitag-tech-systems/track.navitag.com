### PROJECT OVERVIEW AND STATUS

# Navitag Track - GPS Tracking Frontend

Vue 3 + Capacitor 8 mobile app for GPS device tracking. Connects to `api.navitag.net` (PHP/Slim backend) and Traccar servers (GPS tracking backend behind Caddy reverse proxy).

**Stack:** Vue 3, Capacitor 8, Tailwind CSS, Pinia, Vue Router, Leaflet (leaflet-vue3)

---

## TODO

**Lifecycle / session — manual regression tests before shipping:**
- [ ] Logout → sockets close, stores clear, redirected to `/login`
- [ ] Cold boot while logged in (persisted session) → silent reconnect
- [ ] Native: background the app → socket disconnects; foreground → `checkConnectionAndReconnect` fires
- [ ] Toggle airplane mode while logged in → `networkStatusChange` triggers reconnect on recovery (no `<Error />` flash on recovery)
- [ ] Simulate socket drop (kill server / drop WS) → 5s auto-reconnect via `handleSocketDisconnect`
- [ ] Simulate posbroker drop (close the broker WS from devtools) → 5s broker reconnect with token refresh; shared-to-me positions resume
- [ ] Leave the app open > 1 hour, then force a broker drop → token-refresh-then-reconnect lands a valid CONNACK
- [ ] `linkDevice/success` flow → `reloadAndReconnect` refetches devices and reconnects socket
- [ ] Concurrent trigger (foreground + network recover same moment) → only one reconnect runs (lock works)
- [ ] 401 during `startSession` → token refresh retry succeeds on second attempt

**PWA maintenance — see "PWA maintenance" subsection under Project Status.**

## Project Status

### Deployment (CI/CD via Codemagic)

App-store releases run through **Codemagic** (`codemagic.yaml`, free tier, macOS M2) — no Mac required. Workflows:
- **`release`** — combined, **all-or-nothing**: builds the Android AAB + iOS IPA, stamps them with one aligned version (from `package.json`) and one aligned build number (`max(latest Play versionCode, latest TestFlight build) + 1`), then uploads to TestFlight and publishes to Google Play (internal track). The iOS upload **gates** the Play publish, so either both ship or neither does.
- **`ios-testflight`** / **`android-google-play`** — single-platform variants. `android-google-play` computes its own `versionCode` (`google-play get-latest-build-number` + 1) and publishes **live** to the internal track (`submit_as_draft: false`) — no manual finalize. (Earlier it lacked the build-number step and Play rejected the upload with "version code already used".)

**First joint release: v5.0.0 (build 2)** is live on both Google Play (internal testing) and TestFlight.

**v5.0.1** — Android-only patch (notification small-icon fix, see "Notification Icon"). Marketing version bumped on **both** platforms to stay aligned, but only the `android-google-play` workflow is deployed (no iOS changes this round).

**v5.0.2 (build 6)** — joint release via the `release` workflow: geofence drawing-step top bar removed (full-height map while drawing). Live on Google Play internal + TestFlight.

**v5.0.3 (build 7)** — joint release: fix geofence drawing-step layout regression — with the top bar gone, the `justify-between` root parked the bottom sheet at the top; `mt-auto` pins it back to the bottom.

Requirements baked into the workflows (do not regress): **Node 22** (Capacitor 8 CLI), **JDK 21** (Capacitor 8 compiles to source release 21), an **executable `gradlew`**, and an iOS distribution **certificate private key** passed to `fetch-signing-files --create`. Trigger a release locally with `node secrets/cm-run.mjs release main`. All signing material lives in gitignored `secrets/` + `.env`.

> **Follow-up:** the iOS `CERTIFICATE_PRIVATE_KEY` is injected at API trigger time, so iOS builds started from the **Codemagic UI** will fail signing until that key is also added as a persistent Codemagic environment variable.

### iOS map-tile loading (RESOLVED)

iOS builds rendered **blank map tiles** while Android worked. **Root cause: LocationIQ's HTTP-referrer allow-list.** iOS WKWebView sends **no `Referer`** for the app's local `https://localhost` origin, so LocationIQ rejected the tile `<img>` requests with **403** (Android's Chromium sends `https://localhost`, which matched the `*localhost*` entry). Confirmed on-device with a temporary diagnostic build (eruda + `window.netcheck()`): OSM tiles loaded in the webview, LIQ tiles 403'd on **both** the native (CapacitorHttp) and webview paths, and forcing `<meta name="referrer" content="unsafe-url">` did **not** help — WKWebView won't attach a referrer at all. This also ruled out `WKAppBoundDomains` (per Apple WWDC20 #10188 it gates *interaction*, not resource *loading*).

**Fix:** opened the LocationIQ token's referrer allow-list (server-side) so no-referrer requests are accepted. ⚠️ Trade-off: the `pk.` token ships in the JS bundle, so allowing no-referrer makes it usable by any client — the referrer allow-list only ever blocked cross-site browser embeds, not script abuse. **Recommended hardening:** proxy tiles through Caddy/`api.navitag.net` with the key injected server-side (key never client-side, no referrer needed).

Diagnostics removed for the 5.1.0 release (`VITE_DEBUG_CONSOLE` dropped from `ios-testflight`; `unsafe-url` meta removed). `src/utils/debug/netcheck.js` + the gated eruda init in `main.js` are kept dormant (tree-shaken unless `VITE_DEBUG_CONSOLE=true`) for future on-device diagnosis. `WKAppBoundDomains` remains as all wildcards (`*.navitag.net`, `*.navitag.com`, `*.tile.openstreetmap.org`, `*.locationiq.com`) — harmless and confirmed to cover every host.

### Native Splash Screen

- **Android 12+ system splash** (`android/app/src/main/res/values/styles.xml` → `AppTheme.NoActionBarLaunch`): the OS `SplashScreen` API paints a solid background + a centered icon and **ignores** the legacy full-screen `@drawable/splash` bitmap. Left unset it falls back to white/grey + the upscaled (pixelated) launcher icon. Now configured explicitly with `windowSplashScreenBackground` = `@color/splash_background` (navitag beige `#F7F4EF`, defined in `values/colors.xml`, matches the `color-surface` token in `src/style.css`) and `windowSplashScreenAnimatedIcon` = `@drawable/splash_icon` — a high-res transparent logo at `drawable-nodpi/splash_icon.png`. The logo is sized to ~58% diameter so it renders crisply (downscale-only) **and** clears Android 12's circular icon mask (no top-right clipping). Pre-12 still uses the full-screen `@drawable/splash` (already beige).
- **iOS** (`ios/App/App/Base.lproj/LaunchScreen.storyboard`): the `Splash` image fills the screen via `scaleAspectFill`; the view background is also set to beige as a safeguard. (Not Mac-verified.)

### Launcher Icon (Android adaptive)

- Adaptive icon XML (`mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_round.xml`): the **background** layer fills the full 108dp canvas (no inset) so it reaches every edge of the launcher's mask; the **foreground** logo keeps a `16.7%` inset to stay inside the safe zone. Previously the background was *also* inset 16.7%, so the masked shape's edges had no fill and showed the home-screen through as dark lines on the right/bottom.

### Notification Icon (Android)

- Android renders the notification **small icon** from its **alpha channel only** (color is discarded; the system tints the silhouette). With no dedicated icon, FCM fell back to `@mipmap/ic_launcher` — an opaque square — so the status-bar/notification icon showed as a solid white **blob** (very visible on Xiaomi/MIUI, but standard Android 5.0+ behavior, not a device bug).
- Fix: `ic_stat_navitag.png` — a **white arrow silhouette on transparent** at all 5 densities (`drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}`, 24→96 px, glyph at ~86% fill), generated from `assets/icon-foreground.png` by `scripts/gen-notification-icon.cjs`. Registered in `AndroidManifest.xml` via `com.google.firebase.messaging.default_notification_icon` + `default_notification_color` (`@color/notification_color` = navitag blue `#1E88E5`). Requires a fresh build to take effect.
- **iOS** needs no equivalent: iOS notifications always display the full-color **app icon** (`AppIcon-512@2x.png`, 1024², no alpha) automatically — there is no monochrome small-icon concept, so the blob issue does not occur.

### Manifest / Play data safety

- `android/app/src/main/AndroidManifest.xml` strips the advertising-ID permissions auto-merged by Firebase Analytics (`com.google.android.gms.permission.AD_ID` and `android.permission.ACCESS_ADSERVICES_AD_ID`) via `tools:node="remove"`. We don't use the advertising ID, so the Play Console advertising-ID declaration is answered **"No"** (verified gone from the merged release manifest).

### Lifecycle Service

`src/utils/lifecycle/` — split into focused modules:

```
src/utils/lifecycle/
  index.js              public facade — LifecycleService.init() + method delegates
  session.js            startSession, stopSession, checkConnectionAndReconnect,
                        reloadAndReconnect, handleSocketDisconnect + locks/timer
  listeners/
    auth.js             Firebase authStateChange + idTokenChange
    appState.js         Capacitor App foreground/background
    network.js          Capacitor Network status + change
```

- Singleton state (`isStartingSession`, `isReconnecting`, `reconnectTimer`, `countryCodePromise`) lives on the `session` object in `session.js` — single owner for all lock mutations.
- Each listener file registers one Capacitor/Firebase listener and delegates to `session`.
- **Logout:** `stopSession` calls `POST ${baseUrl}/user/logout` with the user's `idToken` before `traccarLogout()`. Wrapped in try/catch — a failure warns but never blocks Traccar teardown, store cleanup, or `/login` redirect.

### Boot progress (`src/stores/boot.js`)

Startup is six discrete phases, but they used to collapse into two booleans (`userStore.loading || deviceStore.loading`) rendered as an indeterminate spinner. `boot.js` records when each phase starts and finishes so the splash can show real progress.

- **A checklist, not a cursor.** Steps are marked independently and may complete out of order — the region lookup starts in `LifecycleService.init()` but is only awaited in `startSession()`, so it can land before or after auth restore. Progress is the sum of completed weights; ordering never matters.
- **Two flows.** `cold` = `auth, region, account, server, devices, live` (weights sum to 100). `warm` = `server, devices, live`, normalized ×(100/60) so a reconnect still reaches 100%. `startSession` uses `ensureFlow('cold')` (no-op on first boot; resets if a warm run or a failed run preceded it); `checkConnectionAndReconnect` / `reloadAndReconnect` always `reset('warm')`.
- **Never stalls, never rewinds.** Between milestones the value eases asymptotically toward `settled + inFlight × 0.9` and never reaches it. `ceiling` is strictly increasing because completing a step adds its full weight to `settled` while removing only 90% of it from `inFlight`.
- **Instrumentation** is ~12 one-line calls at points that already existed: `lifecycle/index.js` (region), `listeners/auth.js` (auth), `session.js` (account, server), `devices.js` (`fetchAll` → devices; `processSocketData` → live). Marking devices/live inside the store means all three `fetchAll` callers get them for free.
- `degraded` records non-fatal step failures (currently only region); `fail()` is terminal and freezes the bar; `markStalled()` is called by the live watchdog. All three make `inProgress` false, which is what removes the bar from the screen.
- **Only `begin()` opens a run.** `done()` and `fail()` deliberately do not set `started`. The country lookup resolves on its own timeline and can land after the run was stood down (user sat on the login screen); if `done()` could re-open a run, `inProgress` would never go false and the rAF loop would spin forever behind the login form.

### Boot splash (`src/components/loading.vue`)

Two variants off one store. `cold` = full-screen blocking splash (logo + determinate bar + live step label). `warm` = a 3px line under the safe-area inset that never blocks. The `msg` prop is gone — it existed but `App.vue` never passed it, so every wait rendered the same dead string ("Navitag Track").

- **The cold/warm split is `hasRenderedOnce` in `App.vue`**, a latch set the first time `masterLoading` goes false while logged in **and** `deviceStore.hasLoadedOnce`. It is deliberately **not** `hasLoadedOnce` alone: that flips when the device list arrives, while `masterLoading` stays true through the wait for the first position — using it would tear the splash away at ~85% and drop the user onto an empty map, which is the exact gap the splash exists to cover. The `hasLoadedOnce` half of the condition matters on the failure path: a fetch that threw releases `masterLoading` without ever producing data, and must not count as "we've been up", or the retry would return as a hairline over an empty list instead of a proper splash.
- **No CSS transition on the bar width** — the store already eases on rAF, and layering a transition on a per-frame update reads as rubber-banding. The `boot-fade` leave transition is what produces the "hold at 100%" beat: the bar has already snapped to 100 by the time the `v-if` flips.
- **The map is mounted on `deviceStore.hasLoadedOnce`, not `masterLoading`.** The old gate tore the entire Leaflet instance down and rebuilt it — tiles, markers, geoman layers — on **every** foreground self-heal. Mounting early is safe: `leafletMap` watches its device key-set (`leafletMap.vue:752`) and creates markers as `processSocketData` populates them. Side benefit: the map now initialises *behind* the splash, so tiles are already in flight when it lifts.
- **`showNav` lists the blocking overlays explicitly.** It previously inferred them from `masterLoading`, which happened to be true during a failed reconnect (`server_connect` false) — the only reason the nav wasn't already painting on top of `<Error />`, since it renders later in the DOM at the same `z-50`. `<NoNet />` never got that protection at all. Both, plus the `appGate` block wall, are now handled on purpose.

> ⚠️ **Warm reconnects no longer block the UI.** A foreground self-heal keeps the map and nav live under a hairline progress bar instead of raising a full-screen splash. The tradeoff is that briefly-stale data stays interactive during the reconnect.

### Inline loaders (`src/components/InlineLoader.vue`)

Every in-page busy indicator goes through one component — **41 call sites across 21 files**. There were four idioms before: a bordered `animate-spin` div, a hand-rolled inline `<svg class="animate-spin">`, `fa-circle-notch fa-spin`, and `fa-spinner fa-spin`; `signup/index.vue` had no spinner at all while creating an account (it does now).

- **API is two props**: `label` (omit for the icon-only form) and `size` (the Tailwind text-size suffix verbatim — `xs`…`4xl`). Size is a prop, not a pass-through class, because the inner `<i>` carries its own size and would beat anything inherited.
- **Colour is inherited** via `currentColor`, so the call site owns it with an ordinary `text-*` class. No `tone` prop to drift from the palette.
- **Keep it a single root.** Most call sites pass a spacing/colour class through; a `v-if`/`v-else` pair at the root would make it a fragment, which silently disables attribute inheritance and drops all of them.
- **No stacked/`block` variant**, deliberately. Every stacked site (history report, both geofence sheets) colours the spinner and its caption differently — brand icon, grey caption — which one inherited colour on one root cannot express. Those keep their own `<p>`.
- **Accessibility**: with a label it is a `role="status"` live region; without one it is `aria-hidden`, because the icon-only form sits inside buttons whose own text already swaps to "Saving…".
- **Copy normalized**: `…` not `...`, sentence case, bare "Loading…" for passive fetches and verb-specific for user-initiated actions. Gone: `SYNCING...`, `Loading device data...`, `Loading notifications…`, `Saving to server...`, `Creating Account...`, `Scanner Active...`.

### Pre-mount shell (`index.html`)

`#app` was empty, so on web nothing painted until the Vue bundle had downloaded, parsed and mounted — a white flash whose length is set by the user's connection, before any loading UI exists to say otherwise. It now ships a static inline shell (beige `#f7f4ef`, the 192px mark, and an **empty** progress groove) that Vue clears on mount; no teardown code needed.

Geometry mirrors `components/loading.vue` (80px mark, 36px gap, 248px track, 6px groove) so the handover is seamless — the groove stays put and the fill appears inside it. **There is deliberately no fill in the shell**: nothing is measurable before the JS runs, and any non-zero width would have to rewind once the real bar starts from 0. Styles are inline because an external stylesheet is another round trip that would flash identically. Native is unaffected (the storyboard / Android 12 splash already covers this window).

### Loading-state ownership (fixed)

- **`deviceStore.loading` has one owner: `fetchAll`.** It is set on entry and released either by the first socket frame (`processSocketData`, after a 1s hold so the map can paint markers) or by the failure path. It previously fell through the `catch` still `true`, so any throw from `fetchDevices`/`fetchGeofences` stranded the user on the splash — and the `<Error />` overlay covering it cleared on retry while the splash underneath did not.
- **Live watchdog (20s).** Armed after a successful fetch, disarmed by the first socket frame. A socket that connects but never speaks used to mean a permanent full-screen splash; now the gate is released and `boot.markStalled()` fires.
- **The geofence views no longer touch `deviceStore.loading`.** `map/geofence.vue` raised the global boot splash over its own "Saving to server…" sheet spinner; `map/geofenceEdit.vue` set it `true` with **no matching `false` on any path**, so a rejected edit dismissed its alert onto a permanent splash. Both now rely on their scoped `isSaving` spinner.
- **Both geofence views call `deviceStore.fetchGeofences()` after a save**, not `LifecycleService.startSession()` — which re-ran the entire boot pipeline (`/user/sync`, Traccar reconnect, full device fetch, socket cycle) to pick up one polygon, and raced `geofence.vue`'s own `finally` for the loading flag.
- **`deviceStore.hasLoadedOnce`** separates "still loading" from "no such device". `deviceById.vue`, `deviceSettings.vue` and `deviceShare.vue` shared one message ("Device not found or loading…"), so a genuinely missing device showed a loading string forever.
- **Retry actually retries.** `retryConnection()` in `App.vue` called `checkConnectionAndReconnect()`, which bails on its own `if (!userStore.server_url) return` guard — and a failed `/user/sync` (the most common route to `<Error />`) is exactly the case where `server_url` was never set. It now falls back to `startSession()` when there is no Traccar session to resume.

> ⚠️ **The country lookup no longer gates the login screen.** `userStore.loading`'s logged-out branch returned `countryCode === null`, holding a first-time visitor on the splash for up to **60s** (5 attempts × 8s timeout + 20s backoff — see `fetchCountryCode`), and `lifecycle/index.js` set `userStore.error = true` on total failure, giving a non-recoverable "refresh the page" screen instead of a sign-in form. The lookup has one hard consumer — `/user/sync`, which assigns a Traccar server to a **new** account — and that runs after login, gated in `startSession`. Signup's manual country picker is the fallback. **Open:** whether `startSession` should hard-require it at all; an existing user's `server_url` does not depend on it.

### Auth / SSO

- **Providers:** Google SSO, Apple SSO, email/password. (Facebook SSO removed.)
- **Email is required** for backend user creation (Traccar requires email). All current SSO providers return an email, so the in-app email-collection flow has been removed.
- **Apple name capture** (`src/utils/auth.js`): Apple only provides the user's display name on the very first sign-in. The name is captured immediately and persisted to `localStorage` (`apple_pending_name`). `backendSync()` in `src/stores/user.js` reads the cached name as a fallback when Pinia state and `firebaseUser.displayName` are both empty, and cleans up the cache after successful sync. The backend (`api.navitag.net` — `User.php`) also sets Firebase `displayName` via the Admin SDK during sync, making the name permanently available on future logins.
- **Web SSO** uses redirect mode; same-origin Firebase auth handler used for mobile web.
- **App Check (anti-bot signups)** — `src/firebase.js` initializes Firebase App Check on **web only** (reCAPTCHA v3, guarded off native via `!Capacitor.isNativePlatform()`) to close the public `identitytoolkit accounts:signUp` REST endpoint that bots hit directly (bypassing all frontend validation). Site key ← `VITE_APPCHECK_RECAPTCHA_V3_SITE_KEY` (set in Vercel; no-ops if unset). Localhost passes via a debug token. **Monitor mode only — NOT enforced**: it mints/attaches tokens but blocks nothing yet, because enforcement is project-wide (shared with navitag.com + native) and would reject native logins until native App Check ships. Deployed 2026-07-22 (commit `91d2cc6`). navitag.com (www-v3) shares the same Firebase project and has the matching web App Check.
- **Native version gate (force-update wall)** — `src/stores/appGate.js` asks `GET /app/config` (public, unauthenticated) what to do with this binary and stores a verdict; `App.vue` renders `components/updateRequired.vue` as a non-dismissible wall on `block`, or a dismissible toast on `warn`. Native only, and `import.meta.env.DEV` is exempt (a compile-time flag, deliberately not a version test — local builds would otherwise be gated by any armed threshold). **The app sends `platform` + `version` and performs no comparison of its own**: every rule lives in `api.navitag.net/v1/src/Controllers/AppConfig.php`, because a comparator shipped in a binary is frozen there for exactly the users who can never be patched.
  - **Gates on the marketing version only — build numbers are not sent or compared.** The version comes from one place (`package.json`) and the `release` workflow stamps it onto both platforms, whereas `android-google-play` computes its own `versionCode`, so the build sequences drift apart whenever a single-platform workflow runs. Comparison is numeric-segment-wise (`5.10.0` > `5.9.0`) with missing segments treated as zero (`5.2` == `5.2.0`). Thresholds stay per-platform because a release is not always published to both stores (v5.0.1 was Android-only) — requiring a version that never reached a store would wall off that platform with no update able to satisfy it.
  - **The trade:** two builds of the same version are indistinguishable to the gate. Anything that might ever need forcing must get a version bump — ship the hotfix as `5.2.1`, not as a second `5.2.0`.
  - Fails open on every path (unknown platform, unparseable/missing version, request failure). Comparator truth table: `scripts/app-gate/test_gate_logic.php` — run it before any arming deploy; it also prints whether the shipped constants are armed.
  - ⚠️ **Currently INERT** (thresholds empty) and **not present in any released build** — the App Store's build 17 (`ff8c5e8`) predates the gate, so it cannot be walled. The gate's value begins with the first build that contains it; for build 17 the only proactive channels are FCM push, email, and natural auto-update.

### Ecommerce Removed

Shop, cart, and payment flows have been removed from the app. Deleted: `src/views/shop/`, `src/views/payment/`, `src/stores/cart.js`, `xendit-components-web` dependency, and the shop tab in `bottomNav.vue`. Device purchasing is handled entirely on the marketing site (`navitag.com/shop`) via external CTA links in `lists/devices.vue` and `linkDevice/addOrBuy.vue`. Regression checks complete.

### iOS App Review — Guideline 3.1.1 (Payments)

v5.1.0 (build 11) was **rejected** under 3.1.1: the app surfaced an externally-purchased paid plan with no In-App Purchase. Resolution (iOS-only, gated on `Capacitor.getPlatform() === 'ios'`; **Android/web keep all plan surfaces**):

- **`deviceSettings.vue`** — Status card hides the **Plan** row, **Expiration** row, and **Top Up** button on iOS (`isIos` const). The Active/Disabled toggle stays. `openTopUp()` (external `navitag.com/top-up/:imei`) is now unreachable on iOS.
- **`geofenceLimitModal.vue`** — neutral copy on iOS ("You have reached your geofence limit for this device.") instead of "upgrade to the Pro plan". Plan-based gating logic is unchanged — only the purchase-directing wording is suppressed. *(**Reverted 2026-07** now that IAP exists — the "upgrade to Pro" prompt is back on all platforms; see below.)*

The physical-device-service framing (the plan is cellular/data connectivity for owned tracker hardware, cf. 3.1.3(e)) is captured in `appstore-3.1.1-reply.md` for the Resolution Center reply.

**Real StoreKit IAP implemented** via `@revenuecat/purchases-capacitor` (`^13.2.3`, Capacitor 8-compatible). RevenueCat project "Navitag" (`proj81f87efd`) already has the iOS app (bundle `com.navitag.track`), 6 consumable products (`com.navitag.track_dataplan_{basic,pro}_{3,6,12}`, matching the Medusa `DATAPLAN-<TIER>-<MONTHS>` SKU convention), and a "Navitag Data Plans" offering with one package per product (`$rc_custom_<basic|pro>_<months>month`).

- **`src/utils/iap.js`** — RevenueCat wrapper plus a localhost web **review mode**. `configureIap()` (once from `main.js`, iOS-only, anonymous at boot), `iapLogIn(uid)`/`iapLogOut()` (from the Firebase `authStateChange` listener), `getPlanOffering()`, and `purchasePlan({device,tier,months,pkg})`. `purchasePlan()` creates the Medusa cart **first** (see `utils/medusa.js`), stashes its id as the RevenueCat **`pending_cart_id`** subscriber attribute, then charges via StoreKit — matching the deployed webhook, which completes that pre-created cart and does **no** IMEI lookup. (This replaced an earlier WIP approach that set a `device_imei` attribute and never created a cart — which the live webhook would have rejected as `no pending_cart_id`.) `isIapPreview()` (=`import.meta.env.DEV && web`) and `isIapUiEnabled()` (=iOS or preview) drive the review harness: in preview the offering is mocked with the real App Store PH prices and purchases are simulated (no charge/StoreKit/cart), so the whole flow is reviewable via `npm run dev`. Production web/Android are unaffected (DEV=false).
- **`src/utils/medusa.js`** — minimal Medusa Store client (Firebase→Medusa JWT exchange, region + variant resolution, `createTopUpCart({device,tier,months})`), a faithful port of the web top-up recipe (`www-v3 .../top-up/[imei].vue`): create a cart on the Hidden sales channel with `metadata.device_imei` + Digital Delivery, add the tier/months line item. **Native-only; not yet verified against live Medusa / on-device.**
- **`src/components/PlanPurchaseSheet.vue`** — "Top-Up" bottom sheet. Opens showing only the device's **current `plan_level`** durations (3/6/12 months) under a "Your plan" header, with a single **Upgrade to Pro / Change plan** button that reveals the other tier. Shows a "Preview" badge + simulated-purchase note in the review build; after a purchase it optimistically updates the plan row (preview) or polls `fetchDeviceExpirations()` (6× / 2.5s, real) since fulfillment lands asynchronously via webhook.
- **`deviceSettings.vue`** — Plan/Expiration rows shown on **all platforms**; the **Top-Up** button opens `PlanPurchaseSheet` on iOS + localhost review and keeps the external Medusa web-checkout (`Browser.open`) on production web/Android.
- **`geofenceLimitModal.vue`** — the "upgrade to the Pro plan" copy is **reinstated on all platforms** (the 3.1.1 neutral-copy softening is reverted now that IAP exists). iOS + localhost review additionally show a "View Plans" CTA (routes to `/list/devices`; the geofence limit is account-wide, so the user picks which device to Top-Up from its Settings).

**⚠️ Verify before shipping:** the RevenueCat → `https://shopapi.navitag.com/hooks/revenuecat` webhook is **built and deployed** — it completes the `pending_cart_id` cart, which flows into the existing `data-renew` fulfillment chain (end-to-end validated via a simulated webhook, order `display_id 46`). Still to confirm on a real device / TestFlight sandbox purchase: (1) `medusa.js` region + variant resolution against live Medusa, (2) that the manual-provider capture emits `order.payment_captured`, and (3) the resulting `device_inventory` plan/expiration update. A completed IAP will charge via Apple, so verify fulfillment before production release.

**App Store Connect:** the 6 consumables are **created, en-US localized, and priced** (PH territory) in App Store Connect, and the Paid Apps Agreement is **active**. The only remaining gate is the **review screenshot** Apple requires for a first IAP submission — it needs the purchase UI in a real build. Resubmit via the `ios-testflight` Codemagic workflow with a bumped build number once the screenshot is captured.

**TestFlight — build 13 (v5.1.0):** the first build carrying the IAP flow is uploaded and `VALID` in App Store Connect (Codemagic `6a60bbdf...`). ⚠️ **NOT yet tested on-device** — no sandbox IAP purchase has been run against it, so the real purchase → webhook → `data-renew` → `device_inventory` chain is still unverified (see "Verify before shipping" above). Next: sandbox-test a purchase on build 13, capture the review screenshot from it, then attach + resubmit.

### Account Settings

- Email field is read-only in the account page (`src/views/account/index.vue`)
- Users can update their name (phone number field removed)
- Password change available for email/password users
- **Delete Data and Account** card (before Log Out): two-step confirm button (grey "Delete" → red "Confirm Delete") that `POST`s to `/user/delete-account` (no body; identity from the Firebase token), then `signOut()`s. The backend wipes local records + the Firebase user; the auth-state listener runs the normal `stopSession` teardown and redirects to `/login`.

### Signup

- Country server selector with searchable modal (`src/views/signup/index.vue`)
- Country list shared via `src/utils/countryList.js` (used by both signup and account pages)

### Device Settings (`src/views/lists/deviceSettings.vue`)

- **Profile card**: Device name, map icon category, and speed limit.
  - **Speed limit**: input in km/h with "No speed limit" toggle. Traccar stores `device.attributes.speedLimit` in knots, so the view converts at the boundary (`KNOTS_PER_KPH = 1 / 1.852`). Toggle ON → `speedLimit` key deleted from attributes on save; toggle OFF → requires 1–300 km/h. Input is `type="text"` with `inputmode="numeric"` (no native spinners) and three-layer input guards (`keydown`/`input`/`paste`) that block non-digits, strip leading zeros, and clamp at 300.
- **Notifications card** (between Profile and Status): per-device notification rules sourced from the navitag backend via `notifStore` (`src/stores/notifications.js`). The curated event-type list comes from `GET /notification/events`; each row toggles a `(device_imei, event_type)` rule idempotently via `PUT /notification/permissions/rule`. Per-row `busy` state prevents double-clicks and a failure surfaces an inline error. No Traccar endpoints are involved.
- **Status card**: Active/disabled toggle, plan level display, expiration date, and Top Up button linking to `https://www.navitag.com/top-up/:imei`
- Plan level and expiration data fetched from `GET /user/device-expiration` and mapped onto device objects in the Pinia store

### Geofences (`src/views/lists/geofences.vue`, `src/views/map/geofence.vue`)

- **Plan-based limits** (centralized in `src/stores/devices.js` as `geofenceLimit` / `canCreateGeofence` / `hasProPlan` computeds): non-Pro users get **2** geofences, Pro users get **10**.
- Entry-point gating: all "create geofence" buttons (`geofences.vue` × 3, `linkDevice/select.vue` × 1) check `canCreateGeofence` and pop `components/geofenceLimitModal.vue` instead of routing to `/addgeo` when over limit.
- Background reconciliation: `enforceGeofenceLimit()` runs fire-and-forget at every lifecycle complete (`startSession` / `checkConnectionAndReconnect` / `reloadAndReconnect` in `utils/lifecycle/session.js`). Sorts geofences by Traccar ID descending (highest = newest) and `DELETE`s the excess so server state always matches the user's tier.
- **Geofence creation** (`views/map/geofence.vue`): `POST /api/geofences` sends only `name` and `area` (WKT) — Traccar's `Geofence` model has no `groupId` field (Jackson rejects extras as unknown properties). After the create succeeds, the view fires `POST /api/permissions { groupId: userStore.server_group, geofenceId }` so the geofence applies to every device in the user's 1:1 Traccar group (current and future). The link call is retried up to 3× with 500/1000 ms backoff. Best-effort: a final-attempt failure logs via `console.error` and **does not** roll back the geofence — the view still navigates to `/` so the user isn't trapped, but `geofenceEnter` / `geofenceExit` won't fire on their devices until that permission is created.

> **⚠️ Edit this if a higher tier than Pro is added.** The 2/10 split lives in one place — `geofenceLimit` in `src/stores/devices.js`. Update that computed to a tier→limit map (e.g. `{ Basic: 2, Pro: 10, Enterprise: 50 }`) and the gating + background cleanup will follow automatically. Also revisit `hasProPlan` — it's currently used as a binary "any Pro device?" check; new tiers may need a `highestPlanTier` computed instead.

### Shared Devices / Posbroker (`src/stores/broker.js`)

- **Two device sources.** Owned devices come from Traccar via `GET /api/devices` and the Traccar WebSocket. Shared-to-me devices come from `GET /share/tome` and live position updates arrive over a separate MQTT-3.1.1-over-WSS channel at `wss://posbroker.navitag.com`. Both streams write through `deviceStore.processSocketData()`, which `Object.assign`s onto the existing device row so `shared:true` and the `scopes` array are preserved across every position update.
- **Shared-only accounts (no owned devices).** The teaser redirect (`/linkdevice/teaser`) is decided in `fetchAll()` **after** `mergeSharedToMeIntoDevices()`, by checking the post-merge `devices` map — so an account with zero owned but ≥1 shared device lands in the app, not the teaser. `fetchDevices()` must **not** throw/redirect on an empty owned list: a throw there rejects the `Promise.all` *before* the merge runs, which skips `shared:true`/`scopes` and lets the broker (re)create the row via `processSocketData`'s create-new-device branch as a scope-less ghost — no shared badge, hidden from the history-setup dropdown (`hasScope` fails), and an incorrectly-enabled activity-lock button. All three `fetchAll` callers in `session.js` (`startSession`, `checkConnectionAndReconnect`, `reloadAndReconnect`) treat the `'no_devices'` return identically: return early, no socket/broker connect.
- **Scope model.** Every row carries a `scopes` array. Owned devices get the sentinel `['owner:all']` injected in `fetchDevices`; shared rows get the exact grant scopes from the backend. UI gates go through `hasScope(device, scope)` in `src/utils/scopes.js`, which treats `owner:all` as matching anything. Floor scope for shared devices is `position:live`. Grantable scopes are `history:read`, `share:public`, `energy:read`, `energy:write` (notification:read is intentionally hidden — backend unsupported).
- **MQTT codec.** Hand-rolled in `broker.js` (~80 lines). No `mqtt` or `mqtt-packet` dependency — the Buffer polyfill chain costs more than the codec saves. Surface used: CONNECT, CONNACK, PUBLISH parse, PINGREQ on a 55s timer, DISCONNECT. The broker auto-subscribes us so no client-side SUBSCRIBE is ever sent.
- **Auth.** `username = Firebase uid`, `password = Firebase ID token`, set once at CONNECT time. The token is *not* a per-frame bearer.
- **Resilience.** `ws.onclose` triggers a 5s reconnect when it's not an intentional teardown. Each reconnect first calls `userStore.getFreshToken()` because the ID token (= MQTT password) expires after ~1 hour. CONNACK refusal codes 4/5 (auth) get a single refresh-and-retry; a second auth refusal stops the loop. `userStore.internet` is honored. Intentional `disconnect()` cancels any pending reconnect timer and nulls all WS listeners before `close()` so the auto-reconnect path can't be tripped by deliberate teardowns.
- **Lifecycle wiring** (`src/utils/lifecycle/session.js`): `useBrokerStore().connect()` after `fetchAll()` in `startSession`; `disconnect()` in `stopSession` ahead of HTTP logout; cycled in both `checkConnectionAndReconnect` and `reloadAndReconnect`. The outer cycle paths remain authoritative — broker's internal loop only covers WS-only drops where the rest of the session is still healthy.

### Link Device (`src/views/linkDevice/link.vue`)

Linking **is** activation — there is no separate enable step. `POST ${baseUrl}/user/link-device` already performs the whole thing server-side in one transaction: Traccar rename + `disabled=false` + join the owner's 1:1 group, `linkUserToDevice` permission, SIM enable (idempotent, skipped for unmanaged providers), expiration from `preloaded_months`, accumulator reset, and the default notification-settings/rules seed — with rollback (unlink + re-disable Traccar + re-disable SIM) if any step fails. On `status === 'success'` the view routes straight to `/linkdevice/success`, which calls `LifecycleService.reloadAndReconnect()` on mount to refresh the device list and expirations.

The old `/linkdevice/enable/:imei` screen (`enable.vue`) was **removed** — it re-ran `POST /device/enable` plus a direct Traccar `GET /api/devices?id=` + `PUT /api/devices/{id}` to flip `disabled`, all of which `link-device` had already done. `Device::enable` detects the no-op (`setTraccarDisabled` → `unchanged`, SIM already enabled) and returns "already enabled; state synced" **without** extending expiration, so the screen only ever added two failure modes and a "Skip for now" path that left users with a linked-but-idle-looking device. `POST /device/enable` itself stays — it still backs the activate/deactivate toggle in Device Settings.

### History / Daily Route (`src/views/history/dailyRoute.vue`)

- Floating X close button (top-right) instead of top navigation bar
- Date navigation with prev/next buttons, plan-limited (Basic: 31 days, Pro: 90 days)
- Collapsible event log with timeline items synced to map markers

### History Setup (`src/views/history/setup.vue`)

- Date picker enforces plan-based min date (Basic: 31 days, Pro: 90 days)
- Dynamically updates based on selected device's `plan_level`

### Navigation & Auth Architecture

- `utils/lifecycle/`: Split into `session.js` (orchestration + locks) and `listeners/{auth,appState,network}.js`. `index.js` exposes the `LifecycleService` facade (`init`, `startSession`, `stopSession`, `checkConnectionAndReconnect`, `reloadAndReconnect`). Lock flags (`isStartingSession`, `isReconnecting`) and the reconnect timer live on the `session` singleton. Single authority for post-auth navigation.
- `user.js` (Pinia store): Manages Firebase auth, backend sync, Traccar session, and WebSocket connection. Socket declared as `shallowRef` to avoid Vue reactivity overhead. Includes `traccarLogout()` for clean session teardown (native cookie clearing + web localStorage cleanup).
- `http.js`: Custom HTTP wrapper using CapacitorHttp for native requests with cookie management.
- Logout clears both Firebase and Traccar sessions. Web uses localStorage to persist `server_url` for cold-boot Traccar session cleanup.

### PWA maintenance

The web app at `https://track.navitag.com` ships as an installable PWA. It was added as a temporary stopgap during the native-store release delay; **do not invest in PWA-only features beyond the existing minimum parity list**. Sunset / migration to native stores will be planned separately. Detailed design + open decisions live in `PROPOSED_PWA.md` while it exists; this section is the durable operational summary.

**Hard gate.** `Capacitor.isNativePlatform()` separates PWA-only code paths from native. Any new service-worker registration, `beforeinstallprompt` handler, `display-mode` check, or web-only push code must respect this gate. Canonical pattern in `src/utils/pwa.js`:

```js
if (Capacitor.isNativePlatform()) { /* defensive unregister, then return */ }
if (!('serviceWorker' in navigator)) return;
```

**Two service workers, separate scopes.** They don't conflict — push events route only to the FCM SW.

| File | Generator | Scope | Purpose |
|---|---|---|---|
| `dist/sw.js` (Workbox) | `vite-plugin-pwa` (build-time from `public/` + bundled assets) | `/` | App-shell / asset precache for installability |
| `public/firebase-messaging-sw.js` | hand-edited, copied as-is | `/firebase-cloud-messaging-push-scope` | Background push delivery |

The Workbox build is configured in `vite.config.js` with `globIgnores: ['**/firebase-messaging-sw.js']` so Workbox does not precache or intercept the FCM SW.

**Install toast suppressed at launch.** `INSTALL_TOAST_ENABLED = false` in `src/stores/install.js`. The `beforeinstallprompt` listener in `pwa.js` captures + stashes the deferred event but does **not** call `e.preventDefault()` while suppression is active. Re-enabling our custom toast later: flip the constant to `true` and rebuild. The full install template + handlers in `App.vue` are already wired (currently dead-code-eliminated by Rollup).

What users see during suppression: **no automatic install UI on Android Chrome or iOS Safari.** Chrome 76+ removed the auto-displayed mini-infobar; modern Chrome Android only offers install via the three-dots menu unless a page calls `.prompt()`. Desktop Chrome/Edge shows a small URL-bar install icon. iOS Safari has no install prompt at all (manual Share → Add to Home Screen only). This is the intended quietly-shipping behavior — install rate at launch is expected to be very low (internal testers + URL-bar-icon noticers).

**First-deploy gate (removed).** During initial rollout `pwa.js` was gated behind `?pwa=1` to limit blast radius until the Workbox SW was verified registering / updating / unregistering cleanly via DevTools. That verification is complete and the gate has been removed — every web visitor now gets the Workbox SW. The kill-switch protocol below is the recovery path for any future SW regression.

**Firebase version-sync rule (load-bearing).** When bumping `firebase` in `package.json`:
1. Run `npm install` then `npm ls firebase` to read the resolved version.
2. Update **both** `importScripts` URLs in `public/firebase-messaging-sw.js` to that exact resolved version.
3. Land both changes in the **same commit**.
4. Reviewer must visually verify the SW moved with the package on every Firebase upgrade PR.

A guard comment exists at the top of `firebase-messaging-sw.js` for this reason. Skew between bundled SDK and SW SDK silently breaks background notifications for some users — symptom is annoying to track down. See `PROPOSED_PWA.md` Phase 8 → "Firebase version-sync protocol" for the full rationale.

**SW kill-switch protocol.** Never rename or delete `sw.js` or `firebase-messaging-sw.js` outright. Vercel's SPA fallback would serve `index.html` at the missing path, the browser would fail to parse HTML as JS, and the old SW would keep running. Instead, **replace** the file contents with a stub that calls `self.registration.unregister()` and `clients.claim()`, deploy, wait ~24-48h for users to navigate at least once, then redeploy a fixed SW. Stub body for either SW:

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.navigate(c.url));
  })());
});
```

For the Workbox SW, the cleanest path is to comment out the `VitePWA(...)` plugin call in `vite.config.js` and ship a literal `public/sw.js` containing the stub. Vite copies `public/` → `dist/` root unprocessed.

**Asset regeneration warning.** PWA icons live at `public/icons/icon-{192,512,512-maskable}.png` and `public/apple-touch-icon.png` — hand-authored PNG sourced from `assets/logo.png`, `assets/icon-foreground.png`, and `assets/icon-background.png` via ImageMagick. The 512-maskable uses an 80% center safe zone (foreground at 410×410 centered on background at 512×512) so Android adaptive icon shapes don't clip the logo. **Do not run `npx capacitor-assets generate` against the PWA target** — earlier output produced a broken `manifest.webmanifest` (wrong MIME on `.webp` files, missing icon files, incorrect maskable safe-zone). `@capacitor/assets` is fine for native icons/splashes only.

**No deep-linking (regression-prevention).** `track.navitag.com/*` links always open in the browser — never auto-route into the PWA or the native apps. Three things stay coordinated:

1. `android/app/src/main/AndroidManifest.xml` MUST NOT contain an `<intent-filter>` for `https://track.navitag.com`.
2. `public/.well-known/assetlinks.json` MUST NOT exist (or must not include this app's package + fingerprint).
3. `public/manifest.webmanifest` MUST NOT include a `capture_links` field.
4. No `apple-app-site-association` should be published to the web origin.

If any of these change, links will silently start routing differently and users will be confused. Treat this as load-bearing project policy.

**Vercel deploy / cache headers.** SW files (`sw.js`, `firebase-messaging-sw.js`) must be served with `Cache-Control: public, max-age=0, must-revalidate`. Vercel's default for non-hashed static files already does this — do not override in `vercel.json` without re-confirming SW headers. SW updates flow naturally on each deploy: the SW file's bytes change → browser detects on next navigation → autoUpdate activates → tabs reload silently. No manual intervention needed for routine updates; the kill-switch is only for the catastrophic case where a deployed SW won't let the next SW install.

**Native regression smoke test.** After any PWA-touching change, run on a Capacitor build before merging:

1. Native console at startup shows no SW registration messages.
2. `navigator.serviceWorker.getRegistrations()` returns `[]` on native (after the defensive unregister loop in `pwa.js`).
3. No "Install app" banner anywhere in the native app.
4. FCM push received via native plugin (not web SW).
5. QR scanner opens the native scanner UI, not the `getUserMedia` overlay.

Full functional / install / regression test matrix lives in `PROPOSED_PWA.md` §7.1–§7.4 while it exists.
