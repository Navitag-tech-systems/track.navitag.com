# Traccar → api.navitag.net/v1 Migration Plan

**Goal:** remove every direct browser→Traccar call from `track.navitag.com`, so the frontend
talks to exactly one backend (`api.navitag.net/v1`) authenticated by exactly one credential
(the Firebase ID token).

**Status: COMPLETE as scoped.** Phases 0, 1 and 2 built. **Phases 3 and 4 will not be done** —
decided 2026-07-23. Nothing deployed.

**11 of 15 touchpoints migrated; the remaining 4 are deliberately kept:** #1–#3 (`/api/session`),
#14 (the Traccar WebSocket) and #15 (netcheck). The live position stream stays on Traccar; every
other browser→Traccar call is gone.

The goal stated above is therefore met in part, on purpose. §7 called this option (c) —
"acceptable as a long-lived intermediate state, not as an end state". It is now the intended end
state. Everything under "Machinery that exists *only* to support the above" (§1) stays alive —
do not delete it as dead code.
**Audited:** 2026-07-23, against `src/` at current HEAD.

> ⚠️ Phase 1 deploy prerequisite: backfills **A1/A2/A3** must run first
> (`../api.navitag.net/v1/BACKFILL_AND_DEBT.md` §A). Group-based listing hides any geofence
> lacking a group link, and two live ones lack it.

> Backfills, deferred debt and open decisions are tracked in
> `../api.navitag.net/v1/BACKFILL_AND_DEBT.md`.

---

## 1. Inventory — every direct Traccar call

All of these go to `https://{userStore.server_url}` (the per-user Traccar host returned by
`POST /v1/user/sync`, e.g. `tserver1.navitag.com`) and are marked `isTraccar: true`, which
routes them through the JSESSIONID cookie path in `src/utils/http.js`.

### HTTP calls — 13 call sites in 7 files

| # | File:line | Call | What it does |
|---|---|---|---|
| 1 | `src/stores/user.js:409` | `GET /api/session` | Probe whether the stored JSESSIONID is still alive |
| 2 | `src/stores/user.js:424` | `GET /api/session?token={server_token}` | Token login — mints a new JSESSIONID |
| 3 | `src/stores/user.js:562` | `DELETE /api/session` | Traccar logout |
| ~~4~~ | `src/stores/devices.js:157` | ~~`GET /api/devices`~~ | ✅ Phase 2 → `GET {baseUrl}/device/list` |
| ~~5~~ | `src/stores/devices.js:205` | ~~`GET /api/geofences`~~ | ✅ → `GET {baseUrl}/geofence` |
| ~~6~~ | `src/stores/devices.js:367` | ~~`PUT /api/devices/{id}`~~ | ✅ Phase 2 → `PUT {baseUrl}/device/{imei}` |
| ~~7~~ | `src/stores/devices.js:415` | ~~`DELETE /api/geofences/{id}`~~ | ✅ **deleted** with `enforceGeofenceLimit()` — quota is server-side in both directions now |
| ~~8~~ | `src/views/map/geofence.vue:80` | ~~`POST /api/geofences`~~ | ✅ → `POST {baseUrl}/geofence`, sends `points` not WKT |
| ~~9~~ | `src/views/map/geofence.vue:38` | ~~`POST /api/permissions`~~ | ✅ **deleted** — the server links and rolls back |
| ~~10~~ | `src/views/map/geofenceEdit.vue:58` | ~~`PUT /api/geofences/{id}`~~ | ✅ → `PUT {baseUrl}/geofence/{id}`, read-modify-write server-side |
| ~~11~~ | `src/views/lists/geofences.vue:50` | ~~`DELETE /api/geofences/{id}`~~ | ✅ → `DELETE {baseUrl}/geofence/{id}` |
| ~~12~~ | `src/views/linkDevice/enable.vue:28` | ~~`GET /api/devices?id={server_ref}`~~ | ✅ Phase 0 — redundant, the API already did it |
| ~~13~~ | `src/views/linkDevice/enable.vue:35` | ~~`PUT /api/devices/{id}`~~ | ✅ Phase 0 — redundant |

### Non-HTTP Traccar coupling — 2 more

| # | File:line | Call | What it does |
|---|---|---|---|
| 14 | `src/utils/http.js:217` (`connectSocket`), called from `src/stores/user.js:540` | `wss://{server_url}/api/socket` | The live device+position stream. Native passes `?session_id={JSESSIONID}`; web relies on the browser cookie. |
| 15 | `src/utils/debug/netcheck.js:120-121` | `GET /api/server`, `wss://.../api/socket` | Dev diagnostics only (`window.netcheck()`) |

### Machinery that exists *only* to support the above

Deleting calls 1–14 makes all of this dead:

- **`src/utils/http.js`** — the whole JSESSIONID subsystem: `SESSION_STORAGE_KEY`,
  `cachedSessionId`, `rememberSessionId` / `forgetSessionId` / `loadSessionId`,
  `getNativeCookie()`, the `Set-Cookie` re-persist block (lines 138-159), the `isTraccar`
  parameter on `getHeaders()` / `send()`, and `clearSession()`. ~90 of 264 lines.
- **`@capacitor/preferences`** — confirmed used *nowhere else* in `src/`. Package can be
  removed, along with the `CA92.1` required-reason entry in `ios/App/App/PrivacyInfo.xcprivacy`.
- **`src/stores/user.js`** — `server_token`, `server_connect`, `server_group`,
  `serverConnect()` (the 3-way session/token/mint ladder, ~100 lines), `traccarLogout()`.
- **`POST /v1/server/token`** — exists solely to mint the Traccar token consumed by call #2.
- **`localStorage['server_url']`**, `Preferences['traccar_jsessionid']`.
- **`CapacitorCookies`** plugin config in `capacitor.config.json` (cookies were for Traccar only).
- The `*.navitag.com` entry in `capacitor.config.json → allowNavigation` and in
  `ios/App/App/Info.plist → WKAppBoundDomains` still needed for `posbroker.navitag.com`,
  so those stay.

---

## 2. What already exists on the API side

Good news — most of the plumbing is there:

- `src/Services/Traccar.php` is a Guzzle client bound to `https://{domain}/api/` using
  **admin Basic auth** (`TRACCAR_ADMIN_USER` / `TRACCAR_ADMIN_PASS`). No per-user session
  needed server-side.
- Ownership check pattern is already established in `Device::updateActivityLock`
  (`src/Controllers/Device.php:222`):
  `users.auth_uid → users.server_id`, `device_inventory.imei → server_user_id`, compare.
- `Traccar::getDevicesByUniqueIds(array $uniqueIds)` already exists — exactly what a
  `/device/list` endpoint needs.
- `Traccar::getDevice()`, `updateDevice()`, `createGroup()`, `linkUserToGroup()` exist.
- **`POST /v1/device/enable` already flips Traccar `disabled` to false server-side**
  (`Device.php:91`, via `setTraccarDisabled`). Calls #12 and #13 are therefore pure
  redundancy — the frontend re-does work the API just did.

**Missing from `Traccar.php`:** all geofence methods (`getGeofences`, `createGeofence`,
`updateGeofence`, `deleteGeofence`) and the group↔geofence permission link.

---

## 3. New API surface

Six new endpoints. Naming follows the existing controller-prefixed convention.

| New endpoint | Replaces | Notes |
|---|---|---|
| `GET /v1/device/list` | #4 | Resolve caller → `users.server_id`, select `device_inventory` rows where `server_user_id` matches, then `Traccar::getDevicesByUniqueIds()`. Returns the same Traccar device array the frontend already parses. |
| `PUT /v1/device/{id}` | #6, #13 | **Read-modify-write on the authoritative Traccar snapshot** — same discipline as `updateActivityLock`. Accept only a whitelist (`name`, `category`, `disabled`, `attributes.speedLimit`); never PUT the client object wholesale, or a stale client `disabled` clobbers live state. |
| `GET /v1/geofence` | #5 | `GET /api/geofences?groupId={users.server_group}` as admin — **group-based**, see §3. Empty `server_group` → return `[]`. |
| `POST /v1/geofence` | #8 **+** #9 | Create, then make **two** links — see the trap below. Kills the client-side 3× retry loop and the orphan-geofence failure mode in `geofence.vue:33-53`. Also enforce the plan quota here → `409` (see §5). |
| `PUT /v1/geofence/{id}` | #10 | Verify the id is in the caller's geofence set before writing. |
| `DELETE /v1/geofence/{id}` | #7, #11 | Same ownership check. |

Plus new `Traccar.php` methods: `getGeofences(int $userId)`, `createGeofence(array)`,
`updateGeofence(int, array)`, `deleteGeofence(int)`, `linkGroupToGeofence(int $groupId, int $geofenceId)`.

**Geofence ownership check:** Traccar has no "does user X own geofence Y" endpoint, so
call `GET /api/geofences?groupId={users.server_group}` and assert the target id is in the result
set before any mutation. One extra Traccar round-trip per write — writes are rare, so fine.

### The permission model — decided 2026-07-23

The 1:1 user↔group is the spine of geofence handling, and **listing is group-based**. That was
already implied by backfill A1 (*"under group-based listing (Phase 1) its owner stops seeing
it"*); D-a and D-b in `../api.navitag.net/v1/GEOFENCE_QUOTA_PLAN.md` settle the rest.

**Geofences are created AS THE USER**, not as admin. `Traccar::createNotificationAs()`
(`Traccar.php:363`) is already this pattern — a per-request `'auth' => [$email, $password]`
override, password from `derivePassword(users.email)`. No JSESSIONID, no session to keep alive.

That makes the two links asymmetric rather than symmetric:

| Link | Table | How it happens | If missing |
|---|---|---|---|
| `{userId, geofenceId}` | `tc_user_geofence` | **implicit** — Traccar grants the creator permission on what it creates | cannot be missing on a fresh create |
| `{groupId, geofenceId}` | `tc_group_geofence` | **explicit** — the backend issues it (call #9, folded into `POST`) | geofence is invisible **and** never fires |

Under group-based listing the group link carries both visibility and evaluation, so losing it
fails *totally* rather than half-way. That is the safer failure: the old partial states — visible
but inert, or firing but invisible — are the ones that reach production unnoticed.

Two rules follow:

1. **`POST` is atomic.** If the group link fails, delete the geofence and return a retryable
   error. Today `geofence.vue:33-53` retries 3× then gives up, leaving an orphan the user can see
   and cannot make work. `provisionUserGroup()` (`User.php:1476-1480`) already rolls back this way.
2. **`users.server_group` is an invariant, not a branch.** Empty means provisioning failed and
   `/user/sync` must heal it (`User.php:574-592` already does). `GET` returns `[]`; `POST`
   refuses with a re-sync hint. The geofence endpoints do not work around it.

---

## 4. Phases

Ordered so that each phase is independently shippable and each one strictly reduces the
Traccar surface. Frontend and API deploy separately (`git`/Vercel vs DreamHost sftp), so
**every phase ships API first, frontend second.**

### Phase 0 — delete redundant calls (no backend work) — ✅ DONE 2026-07-23
Went further than planned: the whole enable *screen* was redundant, not just its two Traccar
calls. `POST /user/link-device` (`User.php:992`) already does the complete activation —
Traccar rename + `disabled=false` + owner-group join, `linkUserToDevice`, SIM enable, and
expiration from `preloaded_months`, all with rollback. So `enable.vue` re-ran work that was
already committed.

Changes shipped:
- Deleted `src/views/linkDevice/enable.vue` (calls #12, #13 **and** a redundant
  `POST /device/enable`).
- `link.vue:38` now routes to `/linkdevice/success` instead of `/linkdevice/enable/:imei`.
- Removed the `linkdevice-enable` route + import from `router.js`.
- `success.vue`: dropped the `?activated=false` branch — unreachable once the "Skip for now"
  button went with `enable.vue`.

**Backend: no changes needed, already aligned.** `POST /device/enable` stays — it still backs
the activate/deactivate toggle in `deviceSettings.vue:325`.

**Net:** link flow drops from 4 requests across 2 screens to 1 request on 1 screen.

### Phase 1 — geofences (kills 6 of the 13 call sites)
The largest, most self-contained win, and the one that fixes real bugs.

**✅ Built 2026-07-23 — steps 1–5. Not deployed.** Backend is
`api.navitag.net/v1/src/Controllers/Geofence.php` + 5 `Traccar.php` methods (39 offline tests);
5 of the 6 call sites are migrated and the limit now comes from the server. Outstanding: **step 6**
(#7, gated on P4).

**Step 5 detail — finding 2 is fixed.** `hasProPlan` is deleted; `deviceStore.entitlement` holds
the backend's measurement and `geofenceLimit` reads it. Two rules make the fallback safe:

- `geofenceLimit` falls back to **2 for display only** when nothing has been measured yet, so the
  create button always has a value to gate on.
- `enforceGeofenceLimit` does **not** read that fallback. It reads `entitlement` directly and
  returns early when it is null *or* carries a non-null `error` — the client-side statement of the
  rule `Entitlement.php` documents, that a failed lookup yields a safe default rather than an
  answer and destructive callers must abort on it.

So the prune can no longer fire on an unmeasured allowance, which is the precise mechanism that
used to delete a pro user's newest 8 geofences whenever `/user/device-expiration` failed. That
holds even though #7 itself is still shipping.

One extra fix made in passing, and one transport change that step 3 needed:

- **`geofence.vue` wrote its optimistic store entry as `[lng, lat]`** while `fetchGeofences`
  parses `[lat, lng]` — so a newly-drawn geofence rendered transposed until the next session
  refresh corrected it. Same E6 family, opposite file. Now `[lat, lng]`.
- **`http.js` non-2xx errors carry `.status` and `.body`.** They threw a bare `HTTP 409` and
  discarded the body, so the quota refusal's `{tier, geofence_limit, current}` could never reach
  the UI. `.message` now prefers the API's `error` string; nothing matched the old format, and
  several existing views that surface `err.message` show a real sentence instead of a status code.

1. Add to `Traccar.php`: `getGeofencesByUserId(int)`, `createGeofence(array)`,
   `updateGeofence(int, array)`, `deleteGeofence(int)`, and the permission link. Traccar's
   `/api/permissions` is generic, so one `createPermission(array)` covers both the user link and
   the group link — see the two-links trap in §3.
2. Add `GET/POST/PUT/DELETE /v1/geofence` to a new `Controllers/Geofence.php`; register in
   `index.php`. Put `/geofence/{id}` **after** any literal `/geofence/...` path — the same
   catch-all shadowing trap already commented on the `/device/{imei}` route.
3. Frontend, migrate to `${baseUrl}/geofence*` with `token: userStore.idToken`:
   `fetchGeofences` (#5), `geofence.vue` save (#8 **+** #9 collapse into one call),
   `geofenceEdit.vue` (#10), `geofences.vue` delete (#11).
4. Delete `linkGeofenceToUserGroup()` from `geofence.vue` and `server_group` from `user.js`.
5. Replace the client-derived limit: `devices.js:463-465` computes `hasProPlan` from `plan_level`
   grafted onto device objects — the exact failure in §"What is happening today" finding 2 of
   `GEOFENCE_QUOTA_PLAN.md`. `geofenceLimit` / `canCreateGeofence` must read the `entitlement`
   key that `GET /device/list` already returns. Consumers: `select.vue:33`, `geofences.vue:20`.
6. **`enforceGeofenceLimit` (#7) is deleted, not migrated** — F1 made the backend the only
   deleter, so pointing it at the new endpoint would just relocate a destructive client action.
   This step is gated: see sequencing below.

**Sequencing — #7 is the one call site that cannot move on its own:**

```
P2 (this phase's backend + the 5 other call sites)
  └─> P4 (prune service + /quota/reconcile + cron sweep)
        └─> P3 (delete enforceGeofenceLimit, step 6 above)
              └─> P5 / B4 (one-time prune of users already over quota)
```

Deleting `enforceGeofenceLimit` before P4 exists leaves *nothing* reconciling a downgrade.
Steps 1–5 have no such dependency and can ship first. P2 also lands the two Traccar methods P4
needs (`getGeofencesByUserId`, `deleteGeofence`), so this order is right regardless.

**Bugs this fixes along the way:**
- `geofence.vue:67` builds WKT as `"${p.lat} ${p.lng}"` directly under a comment saying
  Traccar wants **lon lat**. The comment and the code disagree. Same in
  `geofenceEdit.vue:48`. Moving WKT construction server-side means one implementation to
  get right instead of two — settle the axis order there with a test.
- `geofence.vue:90` does `if(!newGeofence) userStore.error = true` then unconditionally
  reads `newGeofence.id` on line 94 → TypeError instead of a clean error path.
- The geofence quota is currently client-enforced only (`devices.js:438`), so it is
  trivially bypassed. Server-side `409` closes that.

**Risk:** low — geofences are a leaf feature; nothing else depends on them.

### Phase 2 — devices (kills 2 more) — ✅ BUILT 2026-07-23, NOT YET DEPLOYED

Shipped:
- `Traccar::getDevicesByUserId()` — `GET devices?userId={id}`. **Never add `all=true`**:
  verified on tserver1 (Traccar 6.11.1) that it OVERRIDES `userId` in either order, so
  `?userId=54&all=true` returns all 78 devices instead of that user's 19. Also returns an
  `error` array rather than `[]` on failure, unlike `getDevicesByUniqueIds`.
- `GET /v1/device/list` (`Device::list`) — resolves `users.server_id`, calls the above.
  Traccar failure → **502, never an empty array**: `fetchAll` treats an empty list as
  "no devices" and redirects to the teaser, so an outage would otherwise send every user to
  a "link your first device" screen.
- `PUT /v1/device/{imei}` (`Device::update`) — read-modify-write on the Traccar snapshot,
  whitelist `name` / `category` / `speedLimit` only. `disabled` deliberately excluded
  (owned by `/device/enable`+`/device/disable`); `groupId` forced from the snapshot;
  `attributes` merged, not replaced, so `activity_lock`/`auto_lock` survive.
- Frontend `fetchDevices` + `updateDevice` (`devices.js`), `saveDevice` (`deviceSettings.vue`).

**Why not `getDevicesByUniqueIds()`** (the original plan's suggestion — it was wrong): it
matches on `uniqueId`, and MySQL/Traccar disagree in production. Verified by running the
real code against live data:

| server_id | `list()` | inventory rows | via IMEI |
|---|---|---|---|
| 25 | 3 | 3 | 3 |
| **57** | **3** | **3** | **1** ← |
| 53 | 1 | 1 | 1 |
| 59 | 1 | 1 | 1 |
| 60 | 1 | 1 | 1 |
| 80 | 5 | 5 | 5 |

User 57's three devices are `server_ref` 69/71/72 in both systems, but Traccar's `uniqueId`s
are `865395073595462` / `TEST1` / `TEST2` against inventory IMEIs `865395073595462` /
`865391111111111` / `86539222222222`. An IMEI match returns one of three, silently — that
helper swallows misses and returns `[]` on error.

**Frontend gotcha, resolved:** `updateDevice`'s `deviceId` argument is used as a store key
five times, and every store here is keyed by Traccar device id. Passing an IMEI would miss
`devices[deviceId]`, fall into the create branch, and add a duplicate row — both the list
(`devices.vue:34`) and map (`map/index.vue:28`) render `Object.values`, so the device would
appear twice — plus a marker update with `latlon: undefined`. Fix: keep `deviceId` as the
Traccar id and derive the IMEI from `devices[deviceId].uniqueId`. Callers unchanged.

**Still to do:** deploy API (DreamHost sftp) BEFORE frontend. Measure `/device/list` latency
— it now runs browser → DreamHost → Traccar on every lifecycle entry and reconnect.

**Known pre-existing issue left alone:** `updateDevice` pushes `mapUpdate` with
`latlon: undefined` when the device has never reported a position (`deviceMarkers[deviceId]`
absent → `existing = {}`). Unchanged by this work; worth a separate look.

**Optional, not done:** folding `GET /user/device-expiration` into `/device/list` to save a
round-trip on the same hot path (`devices.js:190`).

### Phase 3 — session + WebSocket (kills the remaining 4, and all the cookie machinery)
This is the hard one, and it's really a question about **where live positions come from**.

Calls #1, #2, #3 exist only to obtain and dispose of the JSESSIONID that #14 (the
WebSocket) needs. Kill #14's dependency on Traccar and all four fall together.

Three options:

- **(a) Move live data to posbroker only — recommended.**
  `src/stores/broker.js` already speaks MQTT 3.1.1 over `wss://posbroker.navitag.com`,
  authenticates with **Firebase uid + ID token** (no Traccar session), and feeds
  `deviceStore.processSocketData` — the *same* handler the Traccar socket uses
  (`broker.js:288`). The payload shape already matches. If posbroker publishes owned
  devices and not just shared-to-me ones, the Traccar socket is redundant today.
  **→ Open question, verify first (§6).**

- **(b) WS relay on api.navitag.net.** Not viable as-is — DreamHost shared PHP can't hold
  long-lived connections. Would mean standing up a relay on the VPS, i.e. building a second
  posbroker. Only worth it if (a) is ruled out.

- **(c) Keep the Traccar socket.** Then #1/#2/#3 and the entire JSESSIONID subsystem stay,
  and the migration's main structural payoff — one backend, one credential — is not
  achieved. Acceptable as a long-lived intermediate state, not as an end state.

Assuming (a):
1. Confirm posbroker coverage of owned devices (§6).
2. Delete `serverConnect()`, `traccarLogout()`, `connectSocket()` in `user.js`;
   delete `request.connectSocket()` in `http.js`.
3. Replace the `server_connect` loading gate (`user.js:51`) — the app's "ready" signal
   becomes "first successful `/device/list`", not "Traccar session established".
4. Update `session.js`: `startSession` (line 39), `checkConnectionAndReconnect` (line 124),
   `stopSession` (line 97) all drop their `serverConnect`/`traccarLogout` steps.
   `handleSocketDisconnect` reconnect logic moves to the broker's existing reconnect path.
5. `listeners/auth.js:29` drops its `traccarLogout()` call.

**Risk:** high — this is the live-tracking path. Ship behind a flag, or run both sockets in
parallel for one release and compare message coverage before removing the Traccar one.

### Phase 4 — cleanup
1. `netcheck.js` (#15): point at `${baseUrl}/server/test` (exists) and the posbroker WS;
   drop the tserver probes.
2. Strip the `isTraccar` branch from `http.js` — `getHeaders()` collapses to
   Accept + Content-Type + Bearer. Delete the JSESSIONID subsystem and the
   `@capacitor/preferences` dependency.
3. Remove `CapacitorCookies` from `capacitor.config.json` plugins; remove the CA92.1
   entry from `PrivacyInfo.xcprivacy`.
4. Retire `POST /v1/server/token` and `users.server_token` handling once nothing calls it.
5. Keep `server_url` in `user.js`? No — after Phase 3 the frontend never needs to know
   which Traccar host it's on. Drop it from the store and from `/user/sync`'s consumed
   fields (the API still needs it internally, from `users.server_url`).
6. Retire the `session_id` WebSocket branch in the tserver Caddy config (`CLAUDE.md`)
   once no client sends it.

---

## 5. Behaviour changes worth deciding on

- **Geofence quota moves server-side.** Today `enforceGeofenceLimit()` (#7) silently deletes
  the user's *newest* geofences on every session start when they're over quota — a
  destructive client-side reaction to a downgrade. Server-side, prefer rejecting creation
  with `409` and letting the user choose what to remove. Deleting a user's data on login is
  a surprising default.
- **Error surface changes.** Traccar's raw `HTTP 4xx` becomes the API's JSON error envelope
  (`{error, details}`). `http.js` currently throws `new Error('HTTP ' + status)` and callers
  mostly just log — worth threading the API's `error` string through so the geofence and
  device views can show something real.
- **401 retry now applies.** `http.js:131` skips the Firebase-token refresh-and-retry for
  `isTraccar` requests. Once these are normal API calls, they inherit that retry for free.

---

## 6. Open question — blocks Phase 3 only

**Does posbroker publish positions for devices the user *owns*, or only devices *shared to
them*?**

`session.js:63-68` and `broker.js` are both worded around shared devices; `devices.js:18-24`
says both Traccar WS and posbroker replay last-known state, implying overlap. If posbroker
already covers owned devices, Phase 3 option (a) is a straight deletion. If it only covers
shared devices, posbroker needs a subscription change (broker-medusa / VPS side) before the
Traccar socket can be removed.

Verify by logging in with an owned-devices-only account, disconnecting the Traccar socket in
devtools, and watching whether `processSocketData` keeps receiving positions.

Phases 0–2 are unblocked by this and remove 8 of the 13 HTTP call sites regardless.

---

## 7. Summary

| Phase | Call sites removed | Backend work | Risk |
|---|---|---|---|
| 0 — redundant `enable.vue` calls | 2 (#12, #13) | none | none |
| 1 — geofences | 6 (#5, #7, #8, #9, #10, #11) | 1 controller, 5 Traccar methods | low |
| 2 — devices | 2 (#4, #6) | 2 endpoints | medium |
| 3 — session + socket | 4 (#1, #2, #3, #14) | none (posbroker route) | high |
| 4 — cleanup | 1 (#15) + all dead machinery | retire `/server/token` | low |

After Phase 4: one backend, one credential, no cookies, no `server_url` in the client,
`http.js` down to a plain Bearer-token wrapper.
