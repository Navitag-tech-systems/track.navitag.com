### PROJECT OVERVIEW AND STATUS

# Navitag Track - GPS Tracking Frontend

Vue 3 + Capacitor 8 mobile app for GPS device tracking. Connects to `api.navitag.net` (PHP/Slim backend) and Traccar servers (GPS tracking backend behind Caddy reverse proxy).

**Stack:** Vue 3, Capacitor 8, Tailwind CSS, Pinia, Vue Router, Leaflet (leaflet-vue3)

---

## Project Status

### SSO Login Flow (Facebook/Apple/Google) — In Progress

**Problem:** Facebook SSO users may not have an email in their Firebase profile. The app requires an email for backend user creation (Traccar requires email for user accounts).

**Solution implemented:**

1. **SSO scopes** (`src/utils/auth.js`): All SSO providers now request email scopes (`email`, `profile`/`public_profile`).

2. **Email collection flow** (`src/views/login/collectEmail.vue`): If SSO provider doesn't return an email, the app redirects to a collect-email view before proceeding. Guards in `lifecycle.js`, `App.vue`, and `router.js` prevent race conditions during this flow.

3. **Backend email resolution** (`api.navitag.net` — `User.php`):
   - Email fallback chain: JWT email → request body email → `{uid}@navitagdummy.net`
   - Backend updates Firebase user's email via Admin SDK when JWT email is missing
   - Sends verification email for real (non-dummy) emails
   - Email is immutable after creation (no updates to email in Traccar/MySQL after initial creation)

4. **Server token fix** (`api.navitag.net` — `Server.php`):
   - `generateToken()` now resolves email via: JWT → MySQL `users` table → dummy fallback
   - Ensures password derivation matches what was used during user creation

5. **Session invalidation handling** (`collectEmail.vue`):
   - Firebase Admin SDK email update revokes refresh tokens (per Firebase docs: email change is a "major account change")
   - After `backendSync()` succeeds, the app shows a success message instead of attempting `startSession()`
   - User must click "Login Now" to sign out and re-login (JWT will have email on next login)
   - `needsEmail` flag stays `true` during the transition to keep all lifecycle guards active, preventing error states from race conditions

6. **Re-login race condition fix** (`src/stores/user.js`):
   - `clearUser()` now clears `server_url` to prevent `checkConnectionAndReconnect` from racing with `startSession` during re-login
   - Stale `server_url` was bypassing the `!userStore.server_url` guard, causing concurrent Traccar session attempts and 401 errors

### Account Settings

- Email field is read-only in the account page (`src/views/account/index.vue`)
- Users can update name and phone number
- Phone input uses shared country dial code list from `countryList.js`
- Password change available for email/password users

### Signup

- Country server selector with searchable modal (`src/views/signup/index.vue`)
- Country list shared via `src/utils/countryList.js` (used by both signup and account pages)

### Device Settings (`src/views/lists/deviceSettings.vue`)

- **Labeling card**: Device name and map icon category selection
- **Status card**: Active/disabled toggle, plan level display, expiration date, and Top Up button linking to `https://www.navitag.com/top-up/:imei`
- Plan level and expiration data fetched from `GET /user/device-expiration` and mapped onto device objects in the Pinia store

### History / Daily Route (`src/views/history/dailyRoute.vue`)

- Floating X close button (top-right) instead of top navigation bar
- Date navigation with prev/next buttons
- Collapsible event log with timeline items synced to map markers

### Navigation & Auth Architecture

- `lifecycle.js`: Central service managing auth state, app state, network state, and socket connections. Uses lock flags (`isStartingSession`, `isReconnecting`) to prevent concurrent operations. Single authority for post-auth navigation.
- `user.js` (Pinia store): Manages Firebase auth, backend sync, Traccar session, and WebSocket connection. Socket declared as `shallowRef` to avoid Vue reactivity overhead. Includes `traccarLogout()` for clean session teardown (native cookie clearing + web localStorage cleanup).
- `http.js`: Custom HTTP wrapper using CapacitorHttp for native requests with cookie management.
- Logout clears both Firebase and Traccar sessions. Web uses localStorage to persist `server_url` for cold-boot Traccar session cleanup.
