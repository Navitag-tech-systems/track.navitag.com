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

### Auth / SSO

- **Providers:** Google SSO, Apple SSO, email/password. (Facebook SSO removed.)
- **Email is required** for backend user creation (Traccar requires email). All current SSO providers return an email, so the in-app email-collection flow has been removed.
- **Apple name capture** (`src/utils/auth.js`): Apple only provides the user's display name on the very first sign-in. The name is captured immediately and persisted to `localStorage` (`apple_pending_name`). `backendSync()` in `src/stores/user.js` reads the cached name as a fallback when Pinia state and `firebaseUser.displayName` are both empty, and cleans up the cache after successful sync. The backend (`api.navitag.net` — `User.php`) also sets Firebase `displayName` via the Admin SDK during sync, making the name permanently available on future logins.
- **Web SSO** uses redirect mode; same-origin Firebase auth handler used for mobile web.

### Ecommerce Removed

Shop, cart, and payment flows have been removed from the app. Deleted: `src/views/shop/`, `src/views/payment/`, `src/stores/cart.js`, `xendit-components-web` dependency, and the shop tab in `bottomNav.vue`. Device purchasing is handled entirely on the marketing site (`navitag.com/shop`) via external CTA links in `lists/devices.vue` and `linkDevice/addOrBuy.vue`. Regression checks complete.

### Account Settings

- Email field is read-only in the account page (`src/views/account/index.vue`)
- Users can update name and phone number
- Phone input uses shared country dial code list from `countryList.js`
- Password change available for email/password users

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
- **Scope model.** Every row carries a `scopes` array. Owned devices get the sentinel `['owner:all']` injected in `fetchDevices`; shared rows get the exact grant scopes from the backend. UI gates go through `hasScope(device, scope)` in `src/utils/scopes.js`, which treats `owner:all` as matching anything. Floor scope for shared devices is `position:live`. Grantable scopes are `history:read`, `share:public`, `energy:read`, `energy:write` (notification:read is intentionally hidden — backend unsupported).
- **MQTT codec.** Hand-rolled in `broker.js` (~80 lines). No `mqtt` or `mqtt-packet` dependency — the Buffer polyfill chain costs more than the codec saves. Surface used: CONNECT, CONNACK, PUBLISH parse, PINGREQ on a 55s timer, DISCONNECT. The broker auto-subscribes us so no client-side SUBSCRIBE is ever sent.
- **Auth.** `username = Firebase uid`, `password = Firebase ID token`, set once at CONNECT time. The token is *not* a per-frame bearer.
- **Resilience.** `ws.onclose` triggers a 5s reconnect when it's not an intentional teardown. Each reconnect first calls `userStore.getFreshToken()` because the ID token (= MQTT password) expires after ~1 hour. CONNACK refusal codes 4/5 (auth) get a single refresh-and-retry; a second auth refusal stops the loop. `userStore.internet` is honored. Intentional `disconnect()` cancels any pending reconnect timer and nulls all WS listeners before `close()` so the auto-reconnect path can't be tripped by deliberate teardowns.
- **Lifecycle wiring** (`src/utils/lifecycle/session.js`): `useBrokerStore().connect()` after `fetchAll()` in `startSession`; `disconnect()` in `stopSession` ahead of HTTP logout; cycled in both `checkConnectionAndReconnect` and `reloadAndReconnect`. The outer cycle paths remain authoritative — broker's internal loop only covers WS-only drops where the rest of the session is still healthy.

### Link Device (`src/views/linkDevice/link.vue`)

After `POST ${baseUrl}/user/link-device` succeeds, the view routes straight to `/linkdevice/enable/:imei`. The device list and expirations are refreshed by the subsequent enable flow / `startSession`.

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
