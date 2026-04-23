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
- [ ] Toggle airplane mode while logged in → `networkStatusChange` triggers reconnect on recovery
  - **Known bug (low priority):** Disabling airplane mode shows the Error page instead of recovering cleanly. Root cause: when airplane mode turns ON, the WS close handler fires before `networkStatusChange` flips `userStore.internet` to `false`, so `handleSocketDisconnect` schedules a 5s reconnect timer. That timer then fires while still offline, `serverConnect()` fails, and sets `userStore.error = true`. When network returns, `<NoNet />` hides but `error` was never cleared, so `<Error />` shows.
  - **Fix sketch (3 small changes in `src/utils/lifecycle/`):**
    1. `session.js` — `checkConnectionAndReconnect`: bail out early if `!userStore.internet`.
    2. `session.js` — `handleSocketDisconnect` timer callback: re-check `userStore.internet` before firing reconnect.
    3. `listeners/network.js` — on recovery (`status.connected === true`), clear `userStore.error = false` before calling `checkConnectionAndReconnect`.
- [ ] Simulate socket drop (kill server / drop WS) → 5s auto-reconnect via `handleSocketDisconnect`
- [ ] `linkDevice/success` flow → `reloadAndReconnect` refetches devices and reconnects socket
- [ ] Concurrent trigger (foreground + network recover same moment) → only one reconnect runs (lock works)
- [ ] 401 during `startSession` → token refresh retry succeeds on second attempt

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
- **Post-lifecycle fetch:** `fetchUserNotifications()` fires non-blocking at the end of every successful lifecycle path (`startSession`, `checkConnectionAndReconnect`, `reloadAndReconnect`). Hits Traccar `GET /api/notifications` directly and stores the array into `userStore.notifications` for the Device Settings notifications card.
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
- **Notifications card** (between Profile and Status): lists every notification from `userStore.notifications` as a toggle row. On load, `deviceStore.fetchDeviceNotifications(deviceId)` hits Traccar `GET /api/notifications?deviceId=<id>` to determine which are linked. Toggles are optimistic — UI flips immediately, then `POST`/`DELETE /api/permissions { deviceId, notificationId }` runs; failure rolls back the toggle and shows an error banner. Per-row `busy` state prevents double-clicks.
- **Status card**: Active/disabled toggle, plan level display, expiration date, and Top Up button linking to `https://www.navitag.com/top-up/:imei`
- Plan level and expiration data fetched from `GET /user/device-expiration` and mapped onto device objects in the Pinia store

### Geofences (`src/views/lists/geofences.vue`, `src/views/map/geofence.vue`)

- **Plan-based limits** (centralized in `src/stores/devices.js` as `geofenceLimit` / `canCreateGeofence` / `hasProPlan` computeds): non-Pro users get **2** geofences, Pro users get **10**.
- Entry-point gating: all "create geofence" buttons (`geofences.vue` × 3, `linkDevice/select.vue` × 1) check `canCreateGeofence` and pop `components/geofenceLimitModal.vue` instead of routing to `/addgeo` when over limit.
- Background reconciliation: `enforceGeofenceLimit()` runs fire-and-forget at every lifecycle complete (`startSession` / `checkConnectionAndReconnect` / `reloadAndReconnect` in `utils/lifecycle/session.js`). Sorts geofences by Traccar ID descending (highest = newest) and `DELETE`s the excess so server state always matches the user's tier.
- **Conditional auto-link on geofence create** (`deviceStore.linkGeofenceToEligibleDevices`): when the new geofence is the 1st or 2nd for the account (pre-create count `< 2`) it links to **every device**. When it's the 3rd or beyond it links **only to devices with `plan_level === 'Pro'`**. Called from `views/map/geofence.vue` right after `POST /api/geofences` succeeds.

> **⚠️ Edit this if a higher tier than Pro is added.** The 2/10 split lives in one place — `geofenceLimit` in `src/stores/devices.js`. Update that computed to a tier→limit map (e.g. `{ Basic: 2, Pro: 10, Enterprise: 50 }`) and the gating + background cleanup will follow automatically. Also revisit `hasProPlan` — it's currently used as a binary "any Pro device?" check; new tiers may need a `highestPlanTier` computed instead.

### Link Device — auto-link on success (`src/views/linkDevice/link.vue`)

After `POST ${baseUrl}/user/link-device` succeeds, `autoLinkNewDevice(imei)` runs in the background before the view routes on:

1. `deviceStore.fetchDevices()` — refresh the Traccar device list so the new record appears.
2. Find the new device by `uniqueId === imei`.
3. `deviceStore.fetchDeviceExpirations()` — hydrate `plan_level` from the navitag backend.
4. In parallel:
   - `deviceStore.linkAllNotificationsToDevice(id)` — one `POST /api/permissions { deviceId, notificationId }` per entry in `userStore.notifications`.
   - `deviceStore.linkDefaultGeofencesToDevice(id)` — picks the first N existing geofence IDs (ascending) and links them. N = `10` if the device is Pro, else `2`.

Wrapped in try/catch with non-blocking navigation, so link failures log a warning but never trap the user on the link screen.

### User Notifications (`userStore.notifications`)

- Loaded from **Traccar** `GET /api/notifications` at every successful lifecycle completion (no `api.navitag.net` involvement).
- Reset to `[]` in `clearUser()` on logout.
- Consumed by Device Settings' Notifications card and by `link.vue`'s auto-link flow.

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
