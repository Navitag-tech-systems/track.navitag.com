# Navitag Consolidated API v1

**Base URL:** `https://api.navitag.net/v1`

---

## Authentication

All endpoints require authentication unless otherwise noted.

| Method | Header | Description |
|--------|--------|-------------|
| Firebase Auth | `Authorization: Bearer {idToken}` | Standard user authentication via Firebase ID token |
| Admin Key | `X-Admin-Key: {key}` | Bypasses Firebase auth, grants admin privileges |
| Xendit Callback Token | `x-callback-token: {XENDIT_WB_TOKEN}` | Used by Xendit webhook callback only |
| Medusa Bearer | `Authorization: Bearer {DIGITAL_FULFILLMENT_SECRET}` | Used by `POST /webhook/data-renew` |
| Traccar Bearer | `Authorization: Bearer {TRACCAR_WEBHOOK_SECRET}` | Used by `POST /webhook/traccar-notification` |
| posbroker Bearer | `Authorization: Bearer {POSBROKER_WEBHOOK_SECRET}` | Used by `POST /webhook/impact-detected`, `/webhook/posbroker-notify`, `/webhook/activity-lock-set` |

**Auth Behavior:**
- Valid Firebase token attaches decoded JWT claims (including `sub` as user ID) to the request.
- Admin Key bypass attaches a mock superadmin user with `admin: true`. Cron endpoints (`/cron/*`) rely on this — they verify `admin === true` and return 403 to a regular Firebase user.
- All `/webhook/*` paths bypass the Firebase middleware (the middleware attaches a placeholder `public@navitag.com` identity) and self-verify with their own per-service shared secret (see the per-webhook docs below).
- `GET /share/invite/{token}` is the one Firebase-exempt non-webhook route — used by the recipient's landing page before sign-in. All other `/share/*` routes still require Firebase auth.

---

## Health / Auth

### `GET /authcheck`

Echoes back the decoded Firebase JWT claims attached to the request. Useful for verifying a token is accepted by the backend without performing any side effects.

**Response `200`:** the JWT claims as a JSON object (shape varies by Firebase project — typically includes `sub`, `email`, `aud`, `iss`, `exp`, plus any custom claims).

---

### `GET /`

Returns the literal text `Navitag Consolidated API v1.` (text/plain). **Requires Firebase Bearer token** — the FirebaseAuthMiddleware's excluded-routes list does not include `/`, so an unauthenticated probe gets `401 {"status":"error","message":"Missing or malformed Bearer token"}`. Not suitable as a liveness probe from an unauthenticated monitor.

---

## Server

### `POST /server/status`

Check connectivity to MySQL, Traccar, and Simbase.

**Request Body:**
```json
{
  "server_url": "tserver1.navitag.com"  // optional, defaults to TRACCAR_TEST_URL env
}
```

**Response `200`:**
```json
{
  "timestamp": "2026-04-03T12:00:00Z",
  "services": {
    "mysql":   { "status": "online" },
    "traccar": { "status": "online", "version": "6.x" },
    "simbase": { "status": "online", "balance": 125.50 }
  }
}
```

---

### `POST /server/token`

Generate a Traccar session token for the authenticated user.

**Request Body:**
```json
{
  "server_url": "tserver1.navitag.com"  // optional, defaults to TRACCAR_DEFAULT_URL env
}
```

**Response `200`:**
```json
{
  "status": "success",
  "server_token": "abc123..."
}
```

---

### `GET /server/test`

Same as `POST /server/status` with no request body (uses `TRACCAR_TEST_URL` from env). **Requires Firebase Bearer token** — this route is *not* in the middleware's excluded list, so an unauthenticated probe gets `401`. Pass `X-Admin-Key` as the cheapest way to hit it from a monitor.

---

### `GET /server/settings`

Returns the full notification template list from the caller's Traccar server (used by clients to render server-level notification options).

**Auth:** Firebase Bearer token. Admin callers may pass `?server_url=...` to inspect another region's server; regular users are pinned to their own MySQL-assigned `users.server_url`.

**Response `200`:**
```json
{
  "status": "success",
  "notifications": [ { "id": 1, "type": "...", "...": "..." } ]
}
```

**Errors:**
- `401` — missing Firebase Bearer token
- `404` — caller has no assigned server (run `/user/sync` first)
- `502` — Traccar server unreachable / returned an error

---

## User

### `POST /user/sync`

Create or sync a user account across local DB and Traccar. Idempotent — safe to call on every app start.

**Request Body:**
```json
{
  "country_code": "PH",            // required, 2- or 3-letter ISO
  "name": "John Doe",              // optional
  "phone": "+639171234567",         // optional
  "email": "john@example.com"       // optional fallback when the Firebase JWT has no email (SSO)
}
```

**Response `201` (new user) / `200` (existing user):**
```json
{
  "status": "success",
  "server_url":   "tserver1.navitag.com",
  "server_group": 42,
  "name":         "John Doe",
  "phone":        "QP6@hTbKE...",   // Firebase auth_uid — Traccar's phone field is repurposed as the SMS-HTTP routing key
  "country_code": "PH",
  "server_token": "abc123..."        // present only on existing-user sync when a token has been previously generated
}
```

**Business Logic:**
- New users are created on Traccar with `deviceLimit: -1`, `userLimit: 0`, `limitCommands: true`. Password = `base64url(email)`.
- Each new user gets a dedicated 1:1 Traccar group (stored in `users.server_group`) and is linked to the shared `GLOBAL_NOTIFICATION_IDS` notification set.
- Existing users have name / phone / `attributes.auth_sub` PUT back to Traccar if changed. Email is immutable once set.
- `users.server_url` and `users.country` are first-write-only — subsequent calls cannot move a user to a different region. Traccar client is built from the stored `server_url`, not the request `country_code`.
- On every call: re-asserts `notification_settings` row (master + emergency switches both `1` if absent) and self-heals the 1:1 group + global notification links if missing.
- Traccar's `phone` field is intentionally set to the Firebase `auth_uid` (not the user's real phone). The HTTP SMS notificator only exposes `{phone}` as a per-user placeholder, so this is how Traccar webhook events route back to the right user.

---

### `POST /user/update`

Update user profile (name and/or phone).

**Request Body:**
```json
{
  "name": "Jane Doe",            // optional
  "phone": "+639171234567"        // optional
}
```

**Response `200`:**
```json
{ "status": "success" }
```

---

### `POST /user/delete`

Delete a user from both Traccar and local DB. **Admin only.**

**Headers:** `X-Admin-Key` required

**Request Body:**
```json
{
  "server_url": "tserver1.navitag.com",
  "server_id": 42,
  "id": 15
}
```

**Response `200`:**
```json
{ "status": "success" }
```

**Response `403`:**
```json
{ "error": "Forbidden: Admin access required" }
```

---

### `POST /user/fcm-token`

Register, refresh, or revoke FCM tokens for the calling user. The backend stores **multiple tokens per user** in `user_fcm_tokens` (one row per physical device), so this endpoint is safe to call from every device the user signs in on. Tokens are unique server-wide — if the same token already exists under a different `auth_uid` (e.g. a re-sold phone) ownership is silently transferred to the caller.

**Request Body — register/refresh:**
```json
{
  "fcm_token": "dXy7abc...",        // required (max 512 chars)
  "platform": "ios",                // optional: "ios" | "android" | "web" (≤20 chars)
  "device_label": "Burke's iPhone"  // optional, free text (≤100 chars)
}
```

`platform` and `device_label` are sticky — if you omit them on a re-call, the previously stored values are kept.

**Request Body — logout (wipe all of this user's tokens):**
```json
{ "fcm_token": "" }
```

**Response `200` (register/refresh):**
```json
{ "status": "success", "message": "FCM token saved" }
```

**Response `200` (logout):**
```json
{ "status": "success", "cleared": 2 }
```

**Errors:**
- `400` — `fcm_token` longer than 512 chars
- `401` — missing/invalid Firebase Bearer token
- `409` — user has not run `/user/sync` yet (must sync before registering tokens)

---

### `POST /user/logout`

Clear FCM tokens so the user stops receiving pushes on a specific device (scoped) or every device (unscoped).

**Auth:** Firebase Bearer token.

**Request Body:** *(optional)*
```json
{ "fcm_token": "dXy7abc..." }
```

- With `fcm_token`: removes only that specific token, scoped to the caller's `auth_uid` (so you cannot wipe another user's token by guessing it). Use this for "sign out of this device but keep me signed in elsewhere."
- Without `fcm_token` (or empty body): wipes **every** token registered for the caller across all devices.

**Response `200`:**
```json
{ "status": "success", "cleared": 1 }
```

`cleared` is the number of token rows actually deleted. `0` means the token was already gone or the user had no tokens registered — still a success.

**Errors:**
- `401` — missing/invalid Firebase Bearer token
- `500` — database error

---

### `GET /user/device-expiration`

Get expiration dates for all devices assigned to the authenticated user.

**Response `200`:**
```json
{
  "status": "success",
  "message": [
    {
      "server_ref": "101",
      "imei":       "123456789012345",
      "expiration": "2026-06-15 23:59:59",
      "plan_level": "basic",
      "actionable": true
    }
  ]
}
```

- `plan_level` — lowercase `basic` or `pro` (matches `device_inventory.plan_level`).
- `actionable` — `true` only when the device's SIM provider is `simbase` (controls whether the client offers a top-up CTA). Set per-row, not globally.

---

### `POST /user/link-device`

Link an unassigned device to the authenticated user.

**Request Body:**
```json
{
  "imei": "123456789012345",      // required
  "name": "My Tracker",           // required, display name
  "odo":  12345.6                 // optional, meters — see Accumulators below
}
```

**Response `200`:**
```json
{ "status": "success" }
```

**Validations:**
- Device must exist and not already be assigned (`server_user_id` must be empty)
- User and device must be on the same Traccar server

**Accumulators (reset on link):**
On every successful link the backend resets the device's Traccar accumulators via `PUT /api/devices/{id}/accumulators`:

| Accumulator | Value |
|---|---|
| `totalDistance` | `odo` from the request body (assumed **meters**). Defaults to `0` if omitted, non-numeric, or negative. |
| `hours` | Always reset to `0` regardless of input. |

This is best-effort — a Traccar failure here is logged but does **not** fail the link. If the device's odometer needs to be set later, use the Traccar admin UI or a separate endpoint.

**Side effects on link:**
- Updates Traccar device `name`
- Links the user to the device in Traccar (`POST /permissions`)
- Sets `device_inventory.server_user_id` and `ref2 = name`
- Auto-seeds `notification_settings` (master switch + emergency switch both ON) and creates default `notification_rules` rows for the linked IMEI

---

### `POST /user/generate-auth-token`

Generate a Firebase custom token for auto-login on track.navitag.com.

**Response `200`:**
```json
{
  "success": true,
  "custom_token": "eyJhbGci...",
  "redirect_url": "https://track.navitag.com/auto-login?token=eyJhbGci..."
}
```

---

## Device

### `POST /device/enable`

Enable a device's SIM card via Simbase.

**Request Body:**
```json
{
  "imei": "123456789012345"       // required
}
```

**Response `200`:**
```json
{
  "message": "Device enabled successfully",
  "server_ref": 101,
  "new_expiration": "2026-05-03 23:59:59"
}
```

**Business Logic:**
- Validates device is assigned to the authenticated user
- Activates SIM on Simbase
- Sets expiration to now + `preloaded_months` (default 1 month)
- If SIM is already active, returns current expiration without changes

---

### `POST /device/disable`

Disable a device's SIM card via Simbase.

**Request Body:**
```json
{
  "imei": "123456789012345"       // required
}
```

**Response `200`:**
```json
{
  "message": "Device disabled successfully",
  "sim_status": "disabled"
}
```

---

### `POST /device/update-activity-lock`

Owner-gated update of a single Traccar device's full record, with `attributes.activity_lock` mirrored into the posbroker (lock / unlock the device's anti-theft state).

**Auth:** Firebase Bearer token. Caller must own the device (`device_inventory.server_user_id == users.server_id`).

**Request Body:** the **full Traccar device object** that will be PUT back to Traccar (Slim's `getDevice` shape — `id`, `name`, `uniqueId`, `attributes`, etc.). The backend forces `groupId` from the authoritative server snapshot to preserve the 1:1 user-group binding, even if the client omits it. The device's Traccar `id` is resolved from `device_inventory.server_ref` — `body.id` is **not** trusted, so the caller cannot retarget another device.

Required fields inside the body:
- `uniqueId` — IMEI; used for the ownership lookup
- `attributes.activity_lock` — boolean; broker is set from this value

**Response `200`:**
```json
{
  "status":  "ok",
  "traccar": { "id": 101, "...": "..." },
  "broker":  { "...": "..." }
}
```

**Failure modes:**
- `400` — `Invalid JSON body`, `Missing uniqueId (IMEI)`, `attributes.activity_lock must be a boolean`
- `403` — `Unauthorized device ownership`
- `404` — device or user not found
- `502` — Traccar / broker failure. On Traccar failure after 1 retry, no broker write. On broker failure, the backend **rolls Traccar back** to its prior state and returns `{ status: "rolled_back" | "inconsistent", ... }`.

---

### `POST /device/update-auto-lock`

Identical shape to `/device/update-activity-lock` but mirrors `attributes.auto_lock` into the posbroker's auto-lock opt-in (enable / disable). Same auth, same JSON shape (`attributes.auto_lock` must be boolean), same `groupId` preservation, same Traccar-rollback-on-broker-failure semantics.

---

## Inventory

### `POST /inventory/createRecord`

Provision a new device: create on Traccar, name the SIM, and insert into inventory. **Admin only.**

**Headers:** `X-Admin-Key` required

**Request Body:**
```json
{
  "server_url": "tserver1.navitag.com",  // required
  "imei": "123456789012345",             // required
  "iccid": "89012345678901234567"        // required
}
```

**Response `201`:**
```json
{
  "status": "success",
  "traccar_id": 101,
  "generated_name": "@@ 2345/4567",
  "mysql_id": 55
}
```

**Response (additional field):**

```json
{
  "computed_attributes": [
    { "attributeId": 1, "linked": true, "attempts": 1, "error": null }
  ]
}
```

Per-attribute result of linking the new Traccar device to every id in `COMPUTED_ATTRIBUTE_IDS` (e.g. PowerCut). Best-effort: 3 retries each, a failure here is recorded in the response but does **not** roll back device provisioning.

**Business Logic:**
- SIM must be in `disabled` state with empty or `@@` name.
- Creates device on Traccar with name `@@ {last4_imei}/{last4_iccid}`.
- Traccar device is created with `attributes` pre-seeded with `server`, `activity_lock=false`, `auto_lock=false`, **plus the full 17-key energy attribute map** (all keys present with `null` / `0` defaults) so downstream `/energy/*` mirrors don't need a separate materialization step.
- Best-effort: links the new device to every computed-attribute id in `COMPUTED_ATTRIBUTE_IDS` (3 retries each; failure does not block).
- Sets SIM name on Simbase to `@@ {imei}`.
- On any failure, rolls back: deletes Traccar device and resets SIM name.
- Default values written to `device_inventory`: `suppiler = 'istartek-VT100'`, `model = 'TRACK-1'`, `distribution_channel = 'direct'`, `preloaded_months = 0`, `sim_provider = 'simbase'` (column default).

---

### `GET /inventory/check`

Look up a device by IMEI, verifying it belongs to the authenticated user.

**Query Parameters:**

| Param | Type   | Required | Description          |
|-------|--------|----------|----------------------|
| imei  | string | yes      | Device IMEI number   |

**Response `200`:**
```json
{
  "status": "success",
  "device": {
    "id": 55,
    "imei": "123456789012345",
    "suppiler": "istartek-VT100",
    "model": "TRACK-1",
    "sim_provider": "simbase",
    "sim_iccid": "89012345678901234567",
    "server_type": "traccar",
    "server_url": "tserver1.navitag.com",
    "server_ref": "101",
    "ref1": "@@ 2345/4567",
    "ref2": "",
    "sim_number": "",
    "server_user_id": "42",
    "preloaded_months": 0,
    "create_at": "2026-04-01 12:00:00",
    "expiration": "2026-06-15",
    "distribution_channel": "direct",
    "plan_level": "basic"
  },
  "country": "PH"
}
```

> **Schema note:** `suppiler` is the column name in `device_inventory` — the spelling is misspelled in the live DB and treated as canonical. The field carries the device supplier (e.g. `istartek-VT100`). `plan_level` values are lowercase `basic` / `pro`.

**Response `404`:**
```json
{ "error": "Device not found or not linked to your account" }
```

**Business Logic:**
- Matches the authenticated user's `server_id` (from `users` table) against `server_user_id` in `device_inventory`.
- Returns the full row (`SELECT *`) only if the device is linked to the requesting user.
- Also returns the user's `country` from the `users` table so the client can pick the right region defaults without a second call.

---

### `POST /inventory/reset`

Admin-only: reset a linked / activated device back to unassigned inventory state. Reverses what `/user/link-device` set up.

**Auth:** `X-Admin-Key`.

**Request Body:**
```json
{ "imei": "123456789012345" }
```

**Response `200`:**
```json
{
  "status": "success",
  "imei":   "123456789012345",
  "steps":  ["sim_disabled","sim_renamed","traccar_unlinked","traccar_disabled","mysql_updated"]
}
```

**Per-step actions:**
1. **SIM** — if Simbase says the SIM is enabled, disables it. Renames SIM to `@@ {imei}`.
2. **Traccar** — unlinks the device from its `server_user_id` (if any). Renames device to `@@ {last4_imei}/{last4_iccid}`, sets `disabled = true`, and forces `groupId = 0` so it leaves the former owner's 1:1 group.
3. **MySQL** — clears `server_user_id`, `expiration`, and resets `ref1` to the `@@ ...` placeholder.

Each completed action appends to `steps`. If something fails mid-way, the partial step list is returned with status 500 plus `error` and `steps_completed`.

**Errors:**
- `400` — missing `imei`
- `403` — not an admin
- `404` — device not found in inventory
- `500` — partial-step failure; `steps_completed` lists what did succeed

---

## Energy

A backend-driven module that ingests fuel-up, charging, and odometer events from the device owner and computes efficiency / cost metrics, mirrored onto the Traccar device's custom attributes for the client to read.

**Design baseline (binding for clients):**
- **Owner OR scoped grantee.** Writes (`POST /energy/fuel`, `/energy/charge`, `/energy/odometer`, `/energy/baselines/{imei}`) accept the device owner OR a grantee holding `energy:write` on that IMEI. Reads (`GET /energy/logs/{imei}`) accept the owner OR a grantee holding `energy:read`. The two scopes are independent — a grant may carry one, both, or neither. Each log row records `owner_auth_uid` (device owner) AND `submitted_by_auth_uid` (the actor) so audit queries can attribute the action to whoever pressed the button.
- **Asynchronous mirror.** Every write returns `200` synchronously after enqueueing, then a per-device worker picks the queued row up, snapshots Traccar's `totalDistance`, recomputes metrics, and PUTs the resulting attribute map onto the Traccar device. **Clients confirm success by reading the updated Traccar attributes** — there is no read-side "metrics" endpoint.
- **Currency-agnostic.** All monetary fields are dimensionless numbers; the backend never converts.
- **UTC everywhere.** All datetimes in / out are UTC.
- **Append-only logs.** No edit/delete for past rows. A "corrected" odometer is just a new POST — the newest by `recorded_at` wins.
- **Vehicle type is inferred** from the input mix: refuel-only → ICE/HEV, charge-only → EV, both → PHEV. Type is not exposed via API.

**Mirrored Traccar attributes** (all keys always present, `null` until enough data exists):
```
km_per_liter_interval     km_per_kwh_interval
cost_per_liter_interval   cost_per_kwh_interval   cost_per_km_interval
km_per_liter_avg          km_per_kwh_avg
cost_per_liter_avg        cost_per_kwh_avg        cost_per_km_avg
energy_metric_alerts      (JSON-stringified object — see below — or null)
tank_capacity             battery_capacity
tank_capacity_intervals   tank_capacity_r2        (sentinels: -1 for user-set, null for unset)
has_fuel_baseline         has_charge_baseline     (0/1)
```

**`energy_metric_alerts` shape** — a JSON-stringified object whose keys are metric names and whose values are short reason strings (≤ 60 chars). Example:
```json
{
  "km_per_liter_interval":   "tank capacity needed for accurate reporting",
  "cost_per_liter_interval": "data not provided"
}
```
The backend never emits free-form text — only strings from a fixed catalog (`tank capacity needed for accurate reporting`, `battery capacity needed for accurate reporting`, `efficiency dropped vs your average`, `insufficient data`, `data not provided`, `poor accuracy due to data inconsistency`, `no data provided`, `based on estimated tank capacity`).

### Write lifecycle (applies to fuel, charge, odometer, baselines)

Identical for every kind:

1. **Phase A (synchronous)** — validation → ownership check → `INSERT energy_input_queue` → respond `{ "status": "ok", "input_id": <id> }`.
2. **FIFO gate** — if any older `pending` row exists for the same device, Phase B is skipped inline and the cron sweeper will handle it (preserves submission order, since the per-device lock doesn't preserve FIFO on its own).
3. **Phase B (async)** — acquire `GET_LOCK('energy:<imei>', 5)`, atomically claim the row, dispatch on `kind` (insert the log row + snapshot `total_distance_m`; or upsert the baseline), recompute metrics, mirror to Traccar. Transient failures bounce the row back to `pending` for the cron sweeper to retry; the one permanent failure is `retro_snapshot_exhausted` (7-day backward probe exhausted).
4. All failures are **silent to the client** — they surface only via `log/DD/energy_*.log` and via stale / unchanged Traccar attribute values.

Frontends must prevent re-submission until the prior POST has resolved — server-side idempotency is not enforced.

---

### `POST /energy/fuel`

Log a fuel-up event.

**Auth:** Firebase Bearer token. Owner OR grantee with `energy:write` on the IMEI.

**Request Body:**
```json
{
  "imei":                "865551070000000",
  "liters_refueled":     28.4,
  "ending_fuel_eighths": 8,
  "amount_paid":         1450.50,
  "odometer_km":         12345.7,
  "station_name":        "Petron EDSA",
  "station_address":     "EDSA, Mandaluyong",
  "event_at":            "2026-05-22T14:30:00Z"
}
```

| Field | Required | Notes |
|---|---|---|
| `imei` | yes | Must be linked to caller. |
| `liters_refueled` | yes | `(0, 500]` |
| `ending_fuel_eighths` | yes | Integer `0..8`. The 1/8 selector value at the *end* of the fill-up. |
| `amount_paid` | no | `>= 0`. Enables cost-per-liter / cost-per-km. |
| `odometer_km` | no | `[0, 9999999]`. On a current-time event, this is pushed to Traccar accumulators via `PUT /devices/{id}/accumulators`. On a retro event it's **ignored** (`setDeviceAccumulators` is time-unaware). |
| `station_name`, `station_address` | no | Free-form display strings. |
| `event_at` | no | ISO 8601. Must be in `[now − 365d, now + 1d]`. Defaults to server `now()` UTC. "Current-time" = within 5 min of `now()`. |

**Response `200`:** `{ "status": "ok", "input_id": 142 }`

---

### `POST /energy/charge`

Log a charging event.

**Auth:** Firebase Bearer token. Owner OR grantee with `energy:write` on the IMEI.

**Request Body:**
```json
{
  "imei":                  "865551070000000",
  "kwh_added":             18.2,
  "starting_battery_pct":  22,
  "ending_battery_pct":    80,
  "amount_paid":           320.00,
  "odometer_km":           7820.4,
  "station_name":          "...",
  "station_address":       "...",
  "event_at":              "2026-05-22T14:30:00Z"
}
```

| Field | Required | Notes |
|---|---|---|
| `imei` | yes | Must be linked to caller. |
| `kwh_added` | yes | `(0, 500]` |
| `starting_battery_pct` | no | Integer `0..100`. **Strongly recommended** — only charges that supply this enable battery-capacity self-inference. A charge that omits this is logged as such. |
| `ending_battery_pct` | no | Integer `0..100`. Must be `> starting_battery_pct` if both are present. |
| `amount_paid`, `odometer_km`, `station_*`, `event_at` | no | Same semantics as `/energy/fuel`. |

**Response `200`:** `{ "status": "ok", "input_id": 87 }`

---

### `POST /energy/odometer`

Log an odometer reading. Always interpreted as "now" — the value is pushed into Traccar accumulators in the async phase and a row recording the before/after `totalDistance` is inserted.

**Auth:** Firebase Bearer token. Owner OR grantee with `energy:write` on the IMEI.

**Request Body:**
```json
{ "imei": "865551070000000", "odometer_km": 12420.1 }
```

Both fields required. `odometer_km` ∈ `[0, 9999999]`.

**Response `200`:** `{ "status": "ok", "input_id": 61 }`

---

### `POST /energy/baselines/{imei}`

Set tank or battery capacity manually. First-write-wins per field — once set by the user, the value is immutable through this endpoint (admin override is by direct DB mutation, not exposed to end users).

**Auth:** Firebase Bearer token. Owner OR grantee with `energy:write` on the IMEI.

**Request Body:**
```json
{
  "tank_capacity_liters": 50.0,
  "battery_capacity_kwh": 60.0
}
```

Either field optional; at least one is required. Values must be in `(0, 500]`. Already-populated fields are silently skipped (logged as `baseline_*_already_set`). Confirmation is by reading the `tank_capacity` / `battery_capacity` attributes from Traccar after Phase B.

**Response `200`:** `{ "status": "ok", "input_id": 99 }`

---

### `GET /energy/logs/{imei}?month=YYYY-MM`

List the device's fuel / charge / odometer log rows for a given UTC month — submission history, not computed metrics. Fully synchronous, no queue involvement.

**Auth:** Firebase Bearer token. Owner OR grantee with `energy:read` on the IMEI.

**Query params:**
- `month` *(optional)* — `YYYY-MM`, interpreted as UTC. Defaults to the current UTC month. Year must be `[2000, 2100]`, month `[1, 12]`. Future months allowed (may return empty).

**Response `200`:**
```json
{
  "month": "2026-05",
  "items": [
    {
      "kind": "fuel", "id": 142,
      "event_at": "2026-05-22T14:30:00Z",
      "liters_refueled": 28.4, "ending_fuel_eighths": 8,
      "amount_paid": 1450.50, "odometer_km": 12345.7,
      "station_name": "Petron EDSA", "station_address": "EDSA, Mandaluyong",
      "total_distance_m": 158234012, "total_distance_source": "traccar_now",
      "submitted_by_auth_uid": "pbSgZxPgYxbP8FquWdFJoT2uBxf2"
    },
    {
      "kind": "charge", "id": 87,
      "event_at": "2026-05-20T08:10:00Z",
      "kwh_added": 18.2, "starting_battery_pct": 22, "ending_battery_pct": 80,
      "amount_paid": 320.00, "odometer_km": 7820.4,
      "station_name": "...", "station_address": "...",
      "total_distance_m": 157998001, "total_distance_source": "traccar_now",
      "submitted_by_auth_uid": "pbSgZxPgYxbP8FquWdFJoT2uBxf2"
    },
    {
      "kind": "odometer", "id": 61,
      "recorded_at": "2026-05-19T03:02:11Z",
      "odometer_km": 12420.1,
      "prior_total_distance_m": 157950000, "new_total_distance_m": 158000000,
      "submitted_by_auth_uid": null
    }
  ],
  "truncated": false
}
```

Items are returned newest first. Failed / pending queue rows are **not** surfaced — this endpoint reads exclusively from the three log tables. Operational cap of 500 rows; `truncated: true` is set on the rare overflow.

`submitted_by_auth_uid` is the Firebase uid of the actor who created the row. `null` on historic rows logged before grantee support shipped — treat those as owner-submitted. Owner submissions on new rows carry the owner's uid (not null).

Empty month → `{ "month": "...", "items": [], "truncated": false }` (not 404).

**Errors:**
- `400` — `imei` missing, or `month` malformed / out of range
- `401` — missing Firebase Bearer token
- `403` — caller is neither the owner nor a grantee with `energy:read` on `imei`
- `404` — device not found / not assigned
- `500` — database read failed

---

## History

### `POST /history/positions`

Fetch GPS position history for a device on a given date.

**Request Body:**
```json
{
  "imei": "123456789012345",      // required
  "date": "2026-04-01",           // required, YYYY-MM-DD
  "timezone": "Asia/Manila"        // optional, auto-detected from user country
}
```

**Response `200`:**
```json
{
  "positions": [
    {
      "id": 12345,
      "deviceId": 101,
      "deviceTime": "2026-04-01T08:30:00Z",
      "latitude": 14.5995,
      "longitude": 120.9842,
      "speed": 45.2,
      "course": 180,
      "valid": true,
      "attributes": {}
    }
  ]
}
```

**Business Logic:**
- Converts local date (00:00:00 – 23:59:59) to UTC using the provided or detected timezone before querying Traccar (positions are stored in UTC).
- The future-date check and the plan-level cutoff (Basic = 31 days, Pro = 90 days) are both evaluated against the caller's local calendar day, not the server's. A Singapore caller requesting "today" at 02:00 SGT is not rejected even though it's still "yesterday" in UTC.
- Superadmin can query any device and bypasses the plan-level cutoff; regular users can only query their own.

---

## Shop

### `POST /shop/dataplans`

Get available data plans for specified device models.

**Request Body:**
```json
{
  "models": ["VT100", "VT200"]   // required, non-empty array
}
```

**Response `200`:**
```json
{
  "status": "success",
  "message": [
    {
      "id": 1,
      "model": "VT100",
      "months": 3,
      "price_usd": 15,
      "price_local": 850
    }
  ]
}
```

---

### `POST /products/all`

Get all active products, optionally filtered by country.

**Request Body:**
```json
{
  "country_code": "PH"           // optional
}
```

**Response `200`:**
```json
{
  "status": "success",
  "message": [
    {
      "id": 1,
      "name": "NaviTag VT100",
      "model": "VT100",
      "category": "tracker",
      "price_usd": 49.99,
      "price_local": 2800,
      "active": 1,
      "country": "PH",
      "images": "...",
      "body": "..."
    }
  ]
}
```

---

## Share

### `POST /share/public`

Mint a public share-link token for one or more of the caller's devices. The returned token is an opaque `nvtk_...` value used by the posbroker (`posbroker.navitag.com`) to authorize real-time position subscriptions over WebSockets for recipients who do **not** have a Navitag account.

Authorization is owner-OR-scope: for each submitted IMEI, the caller must EITHER own it (via `device_inventory.server_user_id = users.server_id`) OR hold the `share:public` scope on it via `device_permissions` (grantee path — see the Permission model section). Mixed sets are supported. Any IMEI failing both checks yields `403` with the offending values listed in `unauthorized_devices`. The minted broker token is always attributed to the caller (subject = createdBy = caller uid), so a grantee-minted link survives later revocation of the underlying grant up to the token TTL.

**Request Body:**
```json
{
  "devices": "353456789012345",                         // single IMEI (string or number) OR array of IMEIs
  "ttl_seconds": 43200,                                 // optional, default 43200 (12h). Min 60. Values above 86400 are capped at 86400 (24h).
  "label": "share link for John"                        // optional, free-form human description
}
```

`devices` accepted forms:
- `"353456789012345"` — single device (string)
- `353456789012345` — single device (number; coerced to string)
- `["353456789012345", "860123456789012"]` — one or more devices

**Response `200`:**
```json
{
  "status": "success",
  "token": "nvtk_1adc07d47d999f297b4b978f53d1dab70e7b5dadc07e81020bc35ef8a3fcdb84",
  "share_url": "https://track.navitag.com/share/nvtk_1adc07d47d999f297b4b978f53d1dab70e7b5dadc07e81020bc35ef8a3fcdb84",
  "devices": ["353456789012345"],
  "expires_at": 1776089078,
  "ttl_seconds": 43200
}
```

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "devices required"}` | Missing/empty `devices` |
| 400 | `{"error": "devices must be a string, number, or array"}` | Unsupported `devices` type |
| 400 | `{"error": "wildcard not allowed"}` | `"*"` submitted in `devices` |
| 400 | `{"error": "ttl_seconds must be at least 60"}` | TTL below 60 seconds. Values above 86400 are silently capped at 86400 (24h). |
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 403 | `{"error": "One or more devices are not linked to this user", "unauthorized_devices": [...]}` | Caller neither owns nor holds `share:public` on one or more submitted IMEIs |
| 502 | `{"error": "Broker error", "details": "..."}` | posbroker admin API rejected the mint request |

---

### Permission model (applies to `/share/grant`, `/share/update`, `/share/revoke`, `/share/tome`, `/share/byme`)

Persistent device-sharing permissions live in two stores:

- **MySQL `device_permissions`** — record of granter intent. One row per `(device_imei, grantee_auth_uid)` pair. Each row carries a `scopes` `SET` column with one or more of: `position:live`, `history:read`, `notification:read`, `share:public`, `energy:read`, `energy:write`. Rows are permanent until an explicit revoke.
- **posbroker** — authoritative for `position:live` at runtime. Stores a flat `permissions:{firebase_uid}` set of IMEIs allowed to subscribe to live position MQTT topics. The broker has no knowledge of granter or non-position scopes.

**Floor-scope rule (important for frontend):**

`position:live` is the **minimum scope** for any active grant. It is implicit on every successful `grant` and `update` call, regardless of what the request `scopes` array contains. Concretely:

- Every successful `grant` / `update` adds the IMEI to the broker's permission set for the grantee. The broker assertion is unconditional.
- `history:read`, `notification:read`, `share:public`, `energy:read`, and `energy:write` are **add-ons** on top of `position:live`, not standalone scopes. There is no way to grant any add-on without also granting live position.
- `share:public` lets the grantee mint anonymous public share-link tokens for the device via `/share/public` — they act as if they were the owner for that endpoint only. Minted tokens are attributed to the grantee on the broker (subject = grantee uid) and survive later revocation of the underlying grant up to the token TTL (max 24h). The grant itself is still revocable via `/share/revoke`, which prevents future minting but does not retroactively kill already-issued tokens.
- `energy:read` lets the grantee read the device's energy logs via `GET /energy/logs/{imei}`. It is independent of `energy:write` — a grant may carry one, the other, both, or neither.
- `energy:write` lets the grantee submit fuel/charge/odometer logs AND set baselines via `POST /energy/fuel`, `/energy/charge`, `/energy/odometer`, `/energy/baselines/{imei}`. Every queued input is stored with `owner_auth_uid` = device owner and `submitted_by_auth_uid` = caller. The same pair propagates onto the resulting `energy_fuel_logs` / `energy_charge_logs` / `energy_odometer_logs` row so `GET /energy/logs/{imei}` can attribute each entry to its actual author.
- An `update` call that omits `position:live` from its `scopes` array (e.g. `["history:read"]`) only changes the MySQL `scopes` column. The broker entry stays — meaning the grantee still has live position access. Reading back via `/share/tome` will still show `position:live` in the scope list.
- The only way to remove `position:live` for a `(device, grantee)` pair is `/share/revoke`, which drops the MySQL row AND removes the IMEI from the broker.

This is intentional: live position is the baseline of the share. Users do not opt in to history-only or notification-only sharing.

Sync rules (verified against current code):

- `/share/grant` writes the broker first (adds the IMEIs for the grantee), then commits the MySQL upsert. On MySQL failure, the broker change is compensated (rolled back). Broker is called unconditionally.
- `/share/update` re-asserts the broker (idempotent add), then updates the MySQL `scopes` column. Broker is called unconditionally even if `scopes` does not include `position:live` — see floor-scope rule above.
- `/share/revoke` deletes the MySQL row first, then removes the IMEI from the broker.
- `/share/tome` reads broker as authoritative for `position:live`, layers MySQL extra scopes on top, and lazily deletes any MySQL row whose IMEI is no longer in the broker (self-healing cleanup for out-of-band broker drift).
- `/share/byme` reads MySQL only — relies on the write-path invariant (every MySQL row has a corresponding broker entry).

Valid `scopes` values: `position:live`, `history:read`, `notification:read`, `share:public`, `energy:read`, `energy:write`. Callers SHOULD always include `position:live` in `scopes` to make intent explicit, even though the server enforces it as a floor.

---

### `POST /share/grant`

Grant the same scope set on one or more devices to a single recipient (`target_firebase_uid`). For each listed device, upserts a row in `device_permissions` and adds the IMEI to the broker's permission set for the grantee. Caller must currently own all listed devices.

`position:live` is the floor scope and is asserted on the broker regardless of whether it appears in the request `scopes` array (see **Floor-scope rule** in the Permission model section above). Callers should still include it explicitly for clarity.

**Request Body:**
```json
{
  "target_firebase_uid": "<grantee firebase uid>",
  "devices": ["353456789012345", "860123456789012"],
  "scopes":  ["position:live", "history:read"]
}
```

**Response `200`:**
```json
{
  "status": "success",
  "target_firebase_uid": "<grantee firebase uid>",
  "devices": ["353456789012345", "860123456789012"],
  "scopes":  ["position:live", "history:read"],
  "broker_synced": true
}
```

`broker_synced` is always `true` on a `200` response (the broker is written before MySQL — see **Sync rules**). On a `502` response neither store has been written.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "target_firebase_uid required"}` | Missing/invalid grantee uid |
| 400 | `{"error": "cannot grant to self"}` | `target_firebase_uid` equals caller |
| 400 | `{"error": "devices required"}` | Missing/empty `devices` |
| 400 | `{"error": "wildcard not allowed"}` | `"*"` in `devices` |
| 400 | `{"error": "scopes must be a non-empty array of: position:live, history:read, notification:read, share:public, energy:read, energy:write"}` | Missing, empty, or unknown scope value |
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 403 | `{"error": "One or more devices are not linked to this user", "unauthorized_devices": [...]}` | Caller does not own one or more submitted IMEIs |
| 502 | `{"error": "Broker error", "details": "..."}` | posbroker admin API rejected the patch — MySQL has NOT been written |

---

### `POST /share/update`

Replace the `scopes` column on a single existing grant. The broker entry for the IMEI is re-asserted (idempotent add) on every successful call. Caller must currently own the device.

**Floor-scope behavior:** because `position:live` is the floor scope, an `update` call cannot remove live position access. A request with `scopes: ["history:read"]` only changes the MySQL `scopes` column to `history:read`; the broker still has the IMEI for the grantee, and `/share/tome` will still return `position:live` in the scope list. To fully remove live position access, use `/share/revoke`.

**Request Body:**
```json
{
  "target_firebase_uid": "<grantee firebase uid>",
  "device_imei": "353456789012345",
  "scopes":      ["history:read"]
}
```

**Response `200`:**
```json
{
  "status": "success",
  "target_firebase_uid": "<grantee firebase uid>",
  "device_imei": "353456789012345",
  "scopes":      ["history:read"],
  "broker_synced": true
}
```

`broker_synced` is always `true` on a `200` response (the broker re-assert runs unconditionally before the MySQL update).

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "target_firebase_uid required"}` | Missing/invalid grantee uid |
| 400 | `{"error": "device_imei required"}` | Missing or wildcard IMEI |
| 400 | `{"error": "scopes must be a non-empty array of: ..."}` | Missing, empty, or unknown scope value |
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 403 | `{"error": "Device not linked to this user", "unauthorized_devices": [...]}` | Caller does not own the device |
| 404 | `{"error": "grant not found"}` | No existing `device_permissions` row for that `(imei, grantee)` |
| 502 | `{"error": "Broker error", "details": "..."}` | Broker re-assert failed — MySQL has NOT been updated |

---

### `POST /share/revoke`

Delete one or more grants the caller has issued to a target user, and remove the same IMEIs from the broker's permission set for the grantee. A caller can only revoke grants they themselves issued (`granted_by_auth_uid`).

**Request Body:**
```json
{
  "target_firebase_uid": "<grantee firebase uid>",
  "devices": ["353456789012345"]    // optional; omit or pass [] to revoke ALL grants
                                    // the caller has issued to this grantee
}
```

**Response `200`:**
```json
{
  "status": "success",
  "target_firebase_uid": "<grantee firebase uid>",
  "revoked_devices": ["353456789012345"],
  "broker_synced": true
}
```

`revoked_devices` is the IMEI list actually deleted from MySQL. `broker_synced` is `true` when at least one IMEI was revoked and the broker patch succeeded.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "target_firebase_uid required"}` | Missing/invalid grantee uid |
| 400 | `{"error": "wildcard not allowed"}` | `"*"` in `devices` |
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 502 | `{"error": "Broker error", "details": "...", "mysql_revoked": [...]}` | Broker revoke failed; MySQL rows already deleted (`mysql_revoked` lists the IMEIs that did get removed from MySQL so the caller can retry the broker side) |

---

### `POST /share/tome`

Return the devices that have been shared with the caller (owned devices are excluded — the caller already has those via `/user/device-expiration` and related endpoints).

See **Permission model** above for the broker-authoritative semantics.

**Request Body:** *(none)*

**Response `200`:**
```json
{
  "status": "success",
  "shared_devices": [
    {
      "imei": "353456789012345",
      "scopes": ["position:live", "history:read"],
      "device": {
        "id": 42,
        "name": "Family Car",
        "uniqueId": "353456789012345",
        "status": "online",
        "lastUpdate": "2026-05-26T03:14:00.000+00:00",
        "positionId": 998877,
        "groupId": 7,
        "phone": "",
        "model": "VT200",
        "contact": "",
        "category": "car",
        "disabled": false,
        "attributes": {}
      }
    },
    {
      "imei": "860123456789012",
      "scopes": ["position:live"],
      "device": null
    }
  ]
}
```

`scopes` values:
- `position:live` — always present per the floor-scope rule. Also added when the broker returns a wildcard (`["*"]`) — emitted once as `{"imei": "*", "scopes": ["position:live"], "device": null}`.
- `history:read`, `notification:read` — sourced from `device_permissions.scopes` for that IMEI/grantee pair, layered on top of `position:live`.

`device`:
- Full Traccar device payload (admin-credential lookup, batched as one `GET /devices?uniqueId=…` per Traccar server).
- `null` when the IMEI is the wildcard, has no `device_inventory` row, or the Traccar lookup failed — the UI should fall back to IMEI display.

When the caller has no shared devices, `shared_devices` is `[]`.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 502 | `{"error": "Broker error", "details": "..."}` | posbroker admin API unreachable or returned an error. MySQL stale-row cleanup is skipped when the broker call fails. |

---

### `POST /share/byme`

Return all grants the caller has issued (where `granted_by_auth_uid` equals the caller). MySQL-only — does not call the broker. Relies on the write-path invariant that every `device_permissions` row has a corresponding broker entry. If broker drift ever occurs via out-of-band admin edits, `/share/tome` is the read path that lazily reconciles it on the grantee's next read.

Every returned `scopes` array includes `position:live` per the floor-scope rule.

**Request Body:** *(all fields optional)*

| Field | Type | Description |
|-------|------|-------------|
| `device_imei` | string | Narrow the result to grants issued on this single IMEI. |
| `granter` | string | **Admin-only.** View another user's outbound-shared list. Ignored for non-admin callers. |

**Response `200`:**
```json
{
  "status": "success",
  "granted": [
    {
      "grantee_auth_uid": "<grantee firebase uid>",
      "device_imei":      "353456789012345",
      "scopes":           ["position:live", "history:read"],
      "grantee_name":     "Jane Doe",
      "grantee_email":    "jane@example.com"
    },
    {
      "grantee_auth_uid": "<another grantee>",
      "device_imei":      "350987654321098",
      "scopes":           ["history:read"],
      "grantee_name":     null,
      "grantee_email":    null
    }
  ]
}
```

When the caller has issued no grants, `granted` is `[]`.

`grantee_name` and `grantee_email` come from the `users` table via a LEFT JOIN on `auth_uid`. If the grantee has no row in `users` yet (rare — only possible if the row was deleted out-of-band), both fields are `null` rather than the row being hidden. If the primary `email` is an Apple "Hide My Email" relay (`@privaterelay.appleid.com`) and an `alt_email` is on file, `grantee_email` returns the alt — otherwise the primary email is returned as-is.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |

---

### Share by invite (account-status-agnostic)

The `/share/grant` flow above requires the granter to know the recipient's Firebase uid. The invite flow lets a granter share with someone whose account status they don't know — including users who haven't installed the app yet, or users behind Apple "Hide My Email" private relay where email lookup is unreliable.

**Product rules** (these constrain the API surface — do not assume endpoints that are not documented here):

- **Fire-and-forget from the granter side.** Once an invite is sent, the granter has NO management visibility — there is no list-my-invites endpoint, no revoke endpoint, no resend endpoint. The frontend should surface a "sent" confirmation immediately from the mint response and move on.
- **Email is the only delivery channel.** The invite URL is **never** echoed back to the granter from `POST /share/invite`. The URL only escapes via the Brevo email send. If Brevo fails, the entire mint fails (502) and nothing is persisted.
- **No anonymous live-position preview.** The recipient must sign in or sign up before any device data is shown. The public lookup endpoint returns metadata only.
- **TTL is fixed at 7 days.** Not configurable per-invite.

After a successful claim, the resulting permission becomes a normal account-bound grant visible/manageable via the existing `/share/byme` and `/share/revoke` endpoints.

---

### `POST /share/invite`

Mint an invite and send it to the recipient via Brevo. The invite URL is delivered exclusively through the email — it is NOT returned in the response.

**Request Body:**
```json
{
  "devices":      ["353456789012345"],
  "scopes":       ["position:live", "history:read"],
  "target_email": "friend@example.com",
  "target_name":  "Alex"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `devices` | yes | Non-empty IMEI array. Caller must own each. Wildcard `*` rejected. Max 100. |
| `scopes` | yes | Non-empty subset of `position:live`, `history:read`, `notification:read`, `share:public`, `energy:read`, `energy:write`. **Must include `position:live`** (floor scope). |
| `target_email` | yes | Valid email. The Brevo email is sent to this address. Apple Private Relay addresses are fine — they deliver to the user's real inbox. |
| `target_name` | no | Used in the email greeting only. Defaults to "Friend". |

**Response `200`:**
```json
{
  "status":       "success",
  "expires_at":   "2026-04-30T15:22:00+00:00",
  "target_email": "friend@example.com"
}
```

The response deliberately omits the invite URL and token — the granter is fire-and-forget; the URL escapes only via the email channel.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "devices required"}` | Missing/empty `devices` |
| 400 | `{"error": "wildcard not allowed"}` | `"*"` in `devices` |
| 400 | `{"error": "scopes must be a non-empty array of: ..."}` | Missing/unknown scope value |
| 400 | `{"error": "scopes must include position:live (floor scope)"}` | `position:live` omitted from scopes |
| 400 | `{"error": "target_email required and must be a valid email address"}` | Missing or malformed email |
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 403 | `{"error": "One or more devices are not linked to this user", "unauthorized_devices": [...]}` | Caller does not own one or more IMEIs |
| 502 | `{"error": "Email delivery failed", "details": "..."}` | Brevo send failed; the MySQL row was rolled back, no invite exists |

---

### `GET /share/invite/{token}`

PUBLIC endpoint — no Firebase auth required. Used by the recipient's landing page to display "X wants to share Y devices with you" before they sign in. Returns display-safe metadata only — never returns uids, the granter's email, or any live-position data.

**Request Body:** *(none — GET; token in URL path)*

**Response `200`:**
```json
{
  "status":       "success",
  "granter_name": "James Ong",
  "device_count": 2,
  "scopes":       ["position:live", "history:read"],
  "expires_at":   "2026-04-30T15:22:00+00:00"
}
```

`granter_name` falls back to `"A Navitag user"` if the granter's `users.name` is empty.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 404 | `{"error": "invite not found"}` | Token unknown, expired, or already claimed |

---

### `POST /share/claim`

Signed-in recipient redeems an invite. Materialises a normal account-bound `device_permissions` row per IMEI and asserts the broker permission, reusing the same broker-first / MySQL-second sequence as `/share/grant`.

**Request Body:**
```json
{ "token": "nvit_..." }
```

**Response `200`:**
```json
{
  "status":          "success",
  "granted_devices": ["860123456789012"],
  "already_shared":  ["353456789012345"],
  "scopes":          ["position:live", "history:read"],
  "broker_synced":   true
}
```

`granted_devices` are the IMEIs that were newly granted. `already_shared` are IMEIs the caller already had access to from a prior share — these are silently skipped (no broker call, no MySQL upsert, no error). `broker_synced` is `true` when at least one IMEI was newly granted.

The invite is marked claimed regardless of whether `granted_devices` is non-empty — even a whole-invite no-op (every device already shared) consumes the invite.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "cannot claim your own invite"}` | Caller is the granter |
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 404 | `{"error": "invite not found"}` | Token unknown |
| 409 | `{"error": "invite already claimed"}` | Invite was previously claimed |
| 409 | `{"error": "granter no longer owns the invited devices", "devices": [...]}` | Granter has lost ownership of every device in the invite since it was minted |
| 410 | `{"error": "invite expired"}` | Invite is past its `expires_at` |
| 502 | `{"error": "Broker error", "details": "..."}` | posbroker rejected the patch — MySQL has NOT been written |

---

### `POST /share/invites/pending`

List the caller's outstanding invites — `claimed_at IS NULL AND expires_at > NOW()`. Firebase-auth gated. Read-only convenience for a "you've shared with these people" UI; the granter still has no resend/revoke endpoints, and the bearer token is intentionally not returned.

`target_email` and `target_name` are returned as captured at mint time (the recipient typically has no Navitag account yet, so they are not looked up in `users`).

**Request Body:** *(all fields optional)*

| Field | Type | Description |
|-------|------|-------------|
| `device_imei` | string | Narrow the result to invites whose `devices` array contains this IMEI. Omitted / empty / invalid value returns the full unfiltered list. |
| `granter` | string | **Admin-only.** View another user's outstanding invites. Ignored for non-admin callers. |

**Response `200`:**
```json
{
  "status": "success",
  "invites": [
    {
      "id":           1742,
      "target_email": "jane@example.com",
      "target_name":  "Jane Doe",
      "devices":      ["353456789012345", "350987654321098"],
      "scopes":       ["position:live", "history:read"],
      "expires_at":   "2026-05-25T08:14:00+00:00",
      "created_at":   "2026-05-18T08:14:00+00:00"
    }
  ]
}
```

When the caller has no outstanding invites, `invites` is `[]`.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |

---

### Brevo template requirements

`POST /share/invite` calls `Brevo::sendTransactionalEmail()` with template id `BREVO_TEMPLATE_SHARE_INVITE` (env). The template must exist in the Brevo dashboard with these variables available:

| Variable | Type | Example |
|----------|------|---------|
| `GRANTER_NAME` | string | `James Ong` |
| `DEVICE_COUNT` | int | `2` |
| `INVITE_URL` | string | `https://navitag.com/invite/view/nvit_...` |
| `EXPIRES_AT_HUMAN` | string | `2026-04-30 15:22 UTC` |

If the env var is unset or `0`, mint requests will fail with 502.

---

## Transaction

### `POST /transaction/create`

Create a payment transaction and Xendit payment session.

**Request Body:**
```json
{
  "total": 49.99,                 // required, USD amount
  "type": "product",              // required: "product" or "plan"
  "country": "PH",                // optional, defaults to "PH"
  "customer": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+639171234567"
  },
  "items": [                      // for plan type
    {
      "imei": "123456789012345",
      "months": 3,
      "deviceName": "My Tracker"
    }
  ]
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "ps-xxxx-xxxx",
    "reference_id": "trans-uid.1234567890",
    "status": "REQUIRES_ACTION",
    "amount": 2800,
    "currency": "PHP",
    "checkout_url": "https://..."
  }
}
```

**Business Logic:**
- Converts USD to PHP using stored exchange rate from `keypair_settings`
- Creates local transaction record with status `requested`
- Creates Xendit payment session (mode: COMPONENTS)
- Updates status to `created` on success or `failed` on Xendit error

---

## Webhook

### `POST /webhook/xendit/paysession`

Process Xendit payment session callbacks. **No Firebase auth required.**

**Headers:** `x-callback-token: {XENDIT_WB_TOKEN}`

**Request Body (from Xendit):**
```json
{
  "event": "payment_session.completed",
  "id": "ps-xxxx-xxxx",
  "data": {
    "payment_session_id": "ps-xxxx-xxxx"
  }
}
```

**Response `200`:**
```json
{
  "status": "success",
  "message": "Xendit webhook received and processed."
}
```

**Handled Events:**

| Event | Action |
|-------|--------|
| `payment_session.expired` | Sets transaction status to `expired` |
| `payment_session.completed` | Marks as `paid`, processes order, sends email, then sets `completed` |
| `payment_session.paid` | Same as `completed` |
| Other events | Rejected with 400 error |

**Post-Payment Processing:**
- **Product orders:** Sends confirmation email (Brevo template 5) with order number `NVT-{id+34600}`
- **Plan renewals:** Extends device expiration dates, sends renewal email (Brevo template 7)

---

### `POST /webhook/data-renew`

Receives digital order details from Medusa (shopapi.navitag.com), extends device expiration, handles plan level changes, and POSTs fulfillment confirmation back to Medusa. **No Firebase auth required.**

**Headers:** `Authorization: Bearer {DIGITAL_FULFILLMENT_SECRET}`

**Request Body (from Medusa):**
```json
{
  "order_id": "order_01ABC...",
  "display_id": 1234,
  "email": "customer@example.com",
  "currency_code": "usd",
  "total": 1500,
  "subtotal": 1500,
  "tax_total": 0,
  "discount_total": 0,
  "created_at": "2026-04-08T12:00:00Z",
  "customer": {
    "first_name": "John",
    "last_name": "Doe",
    "email": "customer@example.com"
  },
  "device_imei": "123456789012345",
  "items": [
    {
      "line_item_id": "item_01ABC...",
      "product_id":   "prod_01KNGEHJDWVZSE96MSMNM80K7H",
      "variant_id":   "variant_01ABC...",
      "title":        "Pro Data Plan",
      "variant_title": "3 Months",
      "sku":          "DATAPLAN-PRO-3",
      "quantity":     1,
      "unit_price":   1500,
      "total":        1500
    }
  ],
  "metadata": {
    "country_code": "PH"
  }
}
```

**Response `200`:**
```json
{
  "status": "success",
  "message": "Top-up renewal received."
}
```

**Business Logic (runs in a `register_shutdown_function` after the 200 has been emitted):**

1. **Idempotency lock** — `INSERT INTO keypair_settings (id_key='topup_order_<order_id>', ...)`. Duplicate PK means another worker already owns this order → skip silently.
2. **Item parsing** — preferred parse is the SKU pattern `DATAPLAN-<BASIC|PRO>-<MONTHS>` (e.g. `DATAPLAN-PRO-6`). Falls back to `(\d+)\s*months?` regex on `variant_title` and product-id matching on `MEDUSA_BASIC_PRODUCT_ID` / `MEDUSA_PRO_PRODUCT_ID` for non-standard SKUs.
3. **Cross-tier conversion** — if any item changes the device tier (e.g. Basic→Pro), the backend fetches Medusa's current 3-month prices for both tiers (uses `metadata.country_code`, or the device-owner's `users.country`, mapped through `MEDUSA_REGION_<CC>` envs; falls back to `MEDUSA_REGION_DEFAULT`).
4. **Expiration update:**
   - **Same tier** (Basic→Basic or Pro→Pro): `new_expiration = max(current_expiration, today) + months`.
   - **Cross tier** (Basic↔Pro): `remaining_days = max(0, floor((current_expiration − today) / 86400) − 2)` (the −2 absorbs webhook latency / TZ drift). `converted_days = floor(remaining_days × oldTierPrice ÷ newTierPrice)` from the live Medusa prices. `new_expiration = today + months + converted_days`. `plan_level` is updated to the purchased tier.
5. **SIM activation** — if Simbase reports the SIM disabled, enables it. Failures are logged but don't abort the renewal.
6. **Fulfillment callback** — POSTs `{ order_id, order, items: [...with activation_code...], device: { imei, plan_level, plan_level_changed, previous_plan_level, expiration, model, server_ref }, message }` to `https://shopapi.navitag.com/hooks/digital-fulfillment` with the same `DIGITAL_FULFILLMENT_SECRET` Bearer.
7. **Error path** — any item-parse failure or Medusa price fetch failure releases the idempotency lock and emails `team@navitag.com` via Brevo's `sendHtmlEmail`. The order is left for retry on the next webhook delivery.

---

### `POST /webhook/impact-detected`

Called by posbroker when it correlates an impact event on a device (e.g. iStartek code 42 alongside a co-occurring harsh-brake/turn within a short window). Fans out an FCM push to the device owner **and** every registered emergency contact for that device.

**Auth:** `Authorization: Bearer {POSBROKER_WEBHOOK_SECRET}`

**Request Body:**
```json
{
  "event":       "impact_detected",
  "imei":        "865395073609115",
  "device_name": "FUJI CBR1015",
  "protocol":    "startek",
  "detected_at": "2026-05-14T16:42:17.831Z",
  "trigger_position": {
    "fixTime":   "2026-05-14T16:42:17.000Z",
    "latitude":  14.5995,
    "longitude": 120.9842,
    "speed":     38.4,
    "course":    175,
    "altitude":  12,
    "ignition":  true,
    "motion":    true,
    "valid":     true
  },
  "codes_in_window": [
    { "code": 42, "label": "Impact",        "fixTime": "2026-05-14T16:42:17.000Z" },
    { "code": 40, "label": "Harsh Braking", "fixTime": "2026-05-14T16:42:15.200Z" }
  ],
  "window_seconds":        3,
  "window_distinct_codes": 2
}
```

Only `imei` is strictly required. `device_name`, `detected_at`, `trigger_position.latitude`, and `trigger_position.longitude` enhance the push payload when present.

**Gate semantics:**
- The **device owner** receives the push if the regular notification gate passes: `notifications_enabled = 1` AND a row exists in `notification_rules` for `(owner_auth_uid, imei, 'impact_detected')`. Owners who want this alert must add the rule via `PUT /notification/permissions/rule`.
- **Each emergency contact** receives the push if their `emergency_notifications_enabled = 1`. The master switch and per-event rules do **not** apply.

**FCM data payload sent to recipients:**
```json
{
  "event":       "impact_detected",
  "imei":        "865395073609115",
  "device_name": "FUJI CBR1015",
  "owner_name":  "James",
  "owner_uid":   "<owner_firebase_uid>",
  "detected_at": "2026-05-14T16:42:17.831Z",
  "lat":         "14.5995",
  "lon":         "120.9842"
}
```
(All values are strings — FCM requires it.)

**Response `200`:**
```json
{
  "status":         "ok",
  "recipients":     3,
  "delivered":      5,
  "pruned":         0,
  "failed":         0,
  "gated_owner":    0,
  "gated_contacts": 1
}
```
- `recipients`: number of users an FCM call was attempted for.
- `delivered`/`pruned`/`failed`: FCM **token**-level counts (one user with 2 devices contributes 2).
- `gated_owner`: 1 if the owner failed the gate, else 0.
- `gated_contacts`: count of contacts whose emergency switch was off.

Also returns `200` (no retry) when the IMEI has no owner: `{ "status": "ok", "noted": "no_owner" }`. Only auth (`401`) and missing-imei (`400`) are error codes.

---

### `POST /webhook/traccar-notification`

Receives every notification Traccar fans out through the HTTP SMS notificator. Traccar's `sms.http.template` is configured to send `{ "phone": "{phone}", "message": "{message}" }`, where the `{phone}` placeholder carries the Firebase `auth_uid` (we set Traccar's `phone` field to the auth_uid in `/user/sync`).

**Auth:** `Authorization: Bearer {TRACCAR_WEBHOOK_SECRET}`.

**Request Body:**
```json
{
  "phone":   "<firebase auth_uid>",
  "message": "@@NAV|:|v=1|:|evt=ignitionOn|:|imei=865551070000000|:|t=1748881337123\nname=My Tracker"
}
```

The message body uses a structured digest emitted by the patched Velocity templates on Traccar:
- Line 1: `@@NAV|:|v=1|:|evt=<event>|:|imei=<imei>|:|t=<unixMs>[|:|key=value]*` (fields delimited by `|:|` to be collision-safe).
- Line 2: `name=<device name>` (greedy to end of message — supports `|`, `=`, newlines, Unicode in the name).
- Geofence events insert a third line `gfname=<geofence name>` between line 1 and the name line.

Messages without the `@@NAV` marker are treated as legacy / non-English locale and forwarded with the raw text as the FCM body, gated only by the master switch.

**FCM gating:** notification_settings master switch must be ON, **and** a `notification_rules` row must exist for `(auth_uid, imei, event_type)`. For `alarm` events the gate also accepts any `alarm:%` rule (so legacy `alarm:powerCut` rows still fire on a bare `alarm` digest event).

**Response `200`:** `{ "status": "ok"|"gated", "delivered": N, "pruned": N, "failed": N }` — always 2xx for deterministic outcomes so Traccar does not retry. Reserves `401` for auth, `400` for parse failures.

The composed FCM title/body follows fixed templates per event family (geofence, alarm, overspeed, other). Time is rendered in the recipient's local timezone, derived from `users.country` (multi-zone countries pick the commercial-center zone; full unknown → UTC).

---

### `POST /webhook/posbroker-notify`

Generic FCM pass-through. The caller (posbroker) supplies pre-composed `title` / `body` / `data`; the backend resolves the device owner via `device_inventory`, applies the regular notification gate, and fans out.

**Auth:** `Authorization: Bearer {POSBROKER_WEBHOOK_SECRET}`.

**Request Body** — top-level JSON array, or an `{ "items": [...] }` / `{ "messages": [...] }` envelope. Each item:

| Field | Required | Notes |
|---|---|---|
| `imei` | yes | Routing key — resolved to `auth_uid` via `device_inventory`. |
| `event_type` | yes | Any non-empty string. Used by the rule gate. |
| `title` | yes | FCM notification title. |
| `body` | yes | FCM notification body. |
| `data` | no | Object passed through to the FCM data payload. `imei` is auto-injected. |

**Response `200`:**
```json
{
  "status":    "ok",
  "processed": 5,
  "delivered": 3,
  "pruned":    1,
  "failed":    0,
  "gated":     1,
  "no_owner":  0,
  "invalid":   0
}
```

Each item is processed independently — one bad row doesn't poison the batch. Reserves `401` for auth, `400` for top-level body parse failures.

---

### `POST /webhook/activity-lock-set`

State-sync only: writes the Traccar device custom attribute `attributes.activity_lock` to a boolean value. No FCM, no notification gate.

posbroker is authoritative for lock state; the Traccar attribute is only a mirror. This endpoint lets posbroker push lock changes in **both directions** — engaging a lock (`true`) and releasing it after an auto-disable (`false`).

**Auth:** `Authorization: Bearer {POSBROKER_WEBHOOK_SECRET}`.

**Request Body** — top-level JSON array, or `{ "items": [...] }` envelope. Each item:
```json
{ "imei": "865551070000000", "activity_lock": true }
```

Both fields required. `activity_lock` must be a strict boolean.

**Behavior per item:**
1. Resolve `server_url` / `server_ref` from `device_inventory`. Skip with `no_device` if not found.
2. `GET /api/devices/{id}` on Traccar (read-modify-write). If `attributes.activity_lock` is already the target value, skip the PUT (no-op).
3. `PUT /api/devices/{id}` with the merged record, preserving every other attribute. One retry on transient failure.

**Response `200`:**
```json
{
  "status":         "ok",
  "processed":      3,
  "invalid":        0,
  "no_device":      0,
  "traccar_synced": 3,
  "traccar_failed": 0
}
```

Reserves `401` for auth, `400` for top-level body parse failures.

---

## Logs

### `GET /log/{date}/{filename}`

Admin-only raw fetch of a request log file. Every request to the API is logged to `log/DD/<route>.log` by the request-log middleware; this endpoint exposes those files for inspection.

**Auth:** `X-Admin-Key`. The exact identity check is `firebase_user.email === 'superadmin@navitag.com'` **AND** `firebase_user.admin === true` — only the `X-Admin-Key` bypass produces both. A regular Firebase user with a custom `admin: true` claim is rejected (different email).

**Path parameters:**
- `date` — 2-digit day-of-month (zero-padded, e.g. `25`).
- `filename` — `[A-Za-z0-9_\-]+\.log`. Path traversal is blocked: the resolved file must live under the `log/` root.

**Response `200`:** raw log file contents as `text/plain` with `X-Content-Type-Options: nosniff`. Each line is a JSON object: `{ ts, method, path, status, success, duration_ms, req_body, res_body, error? }`.

**Errors:**
- `403` — not the admin-bypass identity
- `404` — log root missing, or file resolves outside `log/`
- `500` — file present but unreadable

Reads of `/log/...` are intentionally **not** themselves logged (would create a noise loop in the same file).

---

## Cron

All `/cron/*` endpoints are designed to be hit by an external scheduler (DreamHost cron → curl) with `X-Admin-Key`. They rely on the `FirebaseAuthMiddleware` admin-key bypass to attach `admin: true`; the handlers that need it verify the claim explicitly and 403 a regular Firebase user.

### `GET /cron/php_fx_rate`

Fetch and store the latest USD-to-PHP exchange rate.

**Auth:** `X-Admin-Key` (relied on indirectly — the handler itself does not double-check `admin: true`, so it is technically reachable by any valid Firebase token; treat as admin-only for scheduling purposes).

**Response `200`:**
```json
{
  "status":  "success",
  "rate":    "{\"rate\": 56.25}",
  "message": "Exchange rate updated successfully."
}
```

Stores the rate as a JSON string in `keypair_settings` under `id_key = 'php_fx_rate'`. Errors (missing `EXCHANGERATE_API_KEY`, API failure, DB failure) return `500` with `{ status: "error", message }`.

---

### `GET /cron/energy_process`

Sweeper for the energy ingest pipeline. Reclaims stuck `processing` rows older than 5 minutes (back to `pending`), then processes `pending` rows older than 60 seconds — calls the kind-agnostic `processQueueRow` for each, which dispatches to fuel / charge / odometer / baseline.

**Auth:** `X-Admin-Key`. The handler **explicitly** verifies `firebase_user.admin === true` and returns 403 to a regular Firebase user.

**Response `200`:**
```json
{
  "status":            "ok",
  "reclaimed":         0,
  "processed":         3,
  "remaining_pending": 0
}
```

All three counters are always present. An idle invocation returns all zeros.

Scheduling target: roughly every minute. Per-invocation latency is dominated by Traccar HTTP calls.

---

## Notification

The notification system has **four** layers the UI talks to:

1. **FCM token registration** — done via `POST /user/fcm-token` (documented under **User** above). Required before any push can land.
2. **Master switch** — a single per-user boolean. When `false`, the backend drops **every** regular push regardless of any per-event rule.
3. **Per-(device, event) rules** — fine-grained opt-ins. A rule only fires when the master switch is on. Absence of a rule means "don't notify me for this combination."
4. **Emergency switch** — a second per-user boolean, independent of the master switch. Gates the impact-detected fan-out to emergency contacts only. The master switch and per-event rules do **not** affect this path; the emergency switch is the contact's sole consent surface.

The delivery gate for regular pushes is:
```
notifications_enabled = 1  AND  a matching rule row exists for (device_imei, event_type)
```

The delivery gate for impact pushes sent **to an emergency contact** of the affected device is:
```
emergency_notifications_enabled = 1
```
(Impact pushes sent to the device **owner** still go through the regular gate, with `event_type = 'impact_detected'`.)

On signup (`/user/sync` first call) and on every `/user/link-device`, the backend **auto-seeds** both switches to `1` and creates default rules for every owned device covering: `ignitionOn`, `ignitionOff`, `geofenceEnter`, `geofenceExit`, `deviceOverspeed`, `alarm:powerCut`, `activity_lock_breach`, `activity_lock_auto`, `impact_detected`. The UI can rely on these defaults existing — it doesn't have to bootstrap them.

### Event-type vocabulary

`event_type` is a string. Two shapes are accepted on write:

| Shape | Examples |
|---|---|
| Plain event name | `ignitionOn`, `geofenceEnter`, `deviceOverspeed`, `deviceMoving`, `alarm` |
| `alarm:<subtype>` | `alarm:powerCut`, `alarm:sos`, `alarm:hardAcceleration`, `alarm:hardBraking`, `alarm:hardCornering`, `alarm:accident` |

The full canonical list of plain event names is returned by `GET /notification/permissions` in `available_event_types` — the UI should source from that response rather than hard-coding. The default-seeded subset is in `default_event_types`. Alarm subtypes are open-ended (any ASCII `[a-zA-Z][a-zA-Z0-9_-]{0,30}` after `alarm:`).

**On `alarm` vs `alarm:<subtype>`:** the Traccar Velocity digest collapses every alarm to a bare `alarm` event (the subtype rides along in the digest payload as `alarm=<subtype>`). New `notification_rules` rows should use the bare `alarm` event_type. Legacy `alarm:<subtype>` rows still gate correctly because `Webhook::notificationAllowed` matches them via `LIKE 'alarm:%'` when the incoming event_type is `alarm`. Both `GET /notification/permissions.default_event_types` and `GET /notification/events` therefore return bare `alarm`, not subtyped forms.

---

### `GET /notification/events`

Returns the backend's canonical list of plain event-type names (the same set surfaced as `available_event_types` in `GET /notification/permissions`). Use this when you only need the vocabulary and not the per-user state.

**Auth:** Firebase Bearer token.

**Response `200`:**
```json
{
  "status": "ok",
  "events": ["ignitionOn", "ignitionOff", "geofenceEnter", "..."]
}
```

---

### `GET /notification/permissions`

Returns everything the UI needs to render the notification preferences screen.

**Auth:** Firebase Bearer token.

**Response `200`:**
```json
{
  "status": "ok",
  "notifications_enabled": true,
  "emergency_notifications_enabled": true,
  "rules": [
    { "device_imei": "865395075681633", "event_type": "ignitionOn" },
    { "device_imei": "865395075681633", "event_type": "alarm:powerCut" },
    { "device_imei": "865395075681633", "event_type": "alarm:hardBraking" }
  ],
  "owned_devices": [
    { "imei": "865395075681633", "name": "EC CCR 2061" },
    { "imei": "865395075692085", "name": "FUJI CCN2237" }
  ],
  "available_event_types": [
    "ignitionOn", "ignitionOff",
    "geofenceEnter", "geofenceExit",
    "deviceOverspeed",
    "alarm",
    "deviceMoving", "deviceStopped",
    "deviceOnline", "deviceOffline",
    "deviceInactive", "deviceUnknown",
    "deviceFuelDrop", "deviceFuelIncrease",
    "deviceExpiration", "deviceExpirationReminder",
    "driverChanged", "maintenance", "media",
    "commandResult", "queuedCommandSent",
    "activity_lock_breach", "activity_lock_auto",
    "impact_detected"
  ],
  "default_event_types": [
    "ignitionOn", "ignitionOff",
    "geofenceEnter", "geofenceExit",
    "deviceOverspeed",
    "alarm",
    "activity_lock_breach",
    "activity_lock_auto",
    "impact_detected"
  ]
}
```

**UI rendering hint:** Build a grid of `owned_devices × available_event_types`. A cell is "on" iff the corresponding `(device_imei, event_type)` pair appears in `rules`. The master switch row is `notifications_enabled`.

**Errors:**
- `401` — missing/invalid Firebase Bearer token
- `404` — user not found (call `/user/sync` first)

---

### `PUT /notification/permissions/master`

Toggle the master switch. Idempotent — creates the row on first call, updates thereafter.

**Auth:** Firebase Bearer token.

**Request Body:**
```json
{ "enabled": true }
```

**Response `200`:**
```json
{ "status": "ok", "notifications_enabled": true }
```

**Errors:**
- `400` — body missing or `enabled` is not a boolean
- `401` — missing/invalid Firebase Bearer token
- `500` — database error

**UI behavior:** When the user flips master off, you do **not** need to clear per-event rules — they stay intact and will resume firing when master flips back on. The gate just denies everything while master is off.

---

### `PUT /notification/permissions/emergency`

Toggle the emergency switch — controls whether the user receives impact-alert pushes for devices they are an **emergency contact** of. Independent of the master switch and of any per-event rules.

**Auth:** Firebase Bearer token.

**Request Body:**
```json
{ "enabled": true }
```

**Response `200`:**
```json
{ "status": "ok", "emergency_notifications_enabled": true }
```

**Errors:**
- `400` — body missing or `enabled` is not a boolean
- `401` — missing/invalid Firebase Bearer token
- `500` — database error

**UI behavior:** Render this as a second, top-level toggle on the notification preferences screen, separate from the master switch. Label suggestion: *"Allow Emergency Notifications"*. Explain to the user that turning this off means they will not receive impact alerts from people who have assigned them as an emergency contact, even if their device owner has set them as one.

---

### `PUT /notification/permissions/rule`

Create or delete a single per-(device, event) opt-in row.

**Auth:** Firebase Bearer token. **Ownership-checked** — caller must own the device.

**Request Body:**
```json
{
  "device_imei": "865395075681633",
  "event_type":  "alarm:hardBraking",
  "enabled":     true
}
```

- `enabled: true` → `INSERT IGNORE` (creates the row if missing; no-op if already present)
- `enabled: false` → `DELETE` (removes the row if present; no-op otherwise)

Both branches are fully idempotent — safe to call on every checkbox toggle without local debouncing.

**Response `200`:**
```json
{
  "status": "ok",
  "device_imei": "865395075681633",
  "event_type":  "alarm:hardBraking",
  "enabled":     true
}
```

**Errors:**
- `400` — missing/invalid `device_imei`, `event_type` outside the allowed set / pattern, or `enabled` not a boolean
- `401` — missing/invalid Firebase Bearer token
- `403` — caller does not own this device
- `500` — database error

---

### `POST /notification/send` *(admin)*

Send a push to a single raw FCM token. **Admin only** (Firebase custom claim `admin: true` or `X-Admin-Key` bypass).

**Request Body:**
```json
{
  "token": "fcm_device_token",
  "title": "Hello",
  "body":  "World",
  "data":  { "key": "value" }
}
```

**Responses:**
- `200` — `{ "status": "success" }`
- `400` — missing `token`, `title`, or `body`
- `403` — caller is not admin
- `410` — token rejected by FCM (NotFound/Unregistered); the backend has already pruned it from `user_fcm_tokens`. The response is `{ "status": "pruned", "reason": "..." }`.
- `500` — other FCM error

---

### `POST /notification/send-to-user` *(admin)*

Fan-out push to every FCM token registered under a given Firebase uid. **Admin only.**

**Request Body:**
```json
{
  "auth_uid": "firebase_uid_here",
  "title":    "Hello",
  "body":     "World",
  "data":     { "key": "value" }
}
```

**Response `200`:**
```json
{
  "status":  "ok",
  "sent":    2,
  "pruned":  1,
  "failed":  0
}
```
Dead tokens encountered during the fan-out are auto-pruned from `user_fcm_tokens`.

---

## Contact

The `/contact` path serves two unrelated features:

1. **`POST /contact`** — public contact-us form (no auth). Forwards user-submitted messages to `info@navitag.com`.
2. **`/contact/...` (everything else)** — Firebase-auth'd **emergency contact** management. A user designates other Navitag users as emergency contacts for specific devices; those contacts receive an FCM push when posbroker reports an impact event via `POST /webhook/impact-detected`.

### Emergency-contact onboarding model

User 2's app generates a QR code containing User 2's Firebase `auth_uid`. User 1's app scans the QR, extracts the uid, and POSTs it to `/contact/register` along with the IMEI of the device this person should be contact for. The backend persists the mapping and immediately emails User 2 (Brevo template id `13`) so they know they've been designated and can ensure push permissions are granted.

Key design points:
- **Identification is by uid**, not email — no email lookup is performed at registration, sidestepping Apple Private Relay edge cases.
- **No consent/accept step.** Adding is unilateral; the email is informational only.
- **Removal is owner-only.** The contact has no self-service exit.
- **Gating on the alert side** is via the new `emergency_notifications_enabled` switch (see `PUT /notification/permissions/emergency`), independent of the master switch.

---

### `POST /contact` *(public — no auth)*

Public contact form. Sends an HTML email to `info@navitag.com` with the submitter's email set as Reply-To.

**Request Body:**
```json
{
  "email":        "submitter@example.com",
  "name":         "Jane Doe",
  "message":      "Hi, my device stopped reporting.",
  "country_code": "PH",
  "subject":      "Optional subject override",
  "source_url":   "https://navitag.com/contact"
}
```

`email`, `name`, `message` required. `source_url` must be `http(s)://...` or it's silently dropped.

**Response `200`:** `{ "status": "success" }`

**Errors:**
- `400` — missing/invalid `email`, missing `name` or `message`
- `502` — Brevo send failed (`{ "status": "error", "message": "..." }`)

---

### `POST /contact/register`

Designate a user as an emergency contact for a device the caller owns. Sends a Brevo email to the new contact on success.

**Auth:** Firebase Bearer token.

**Request Body:**
```json
{
  "device_imei":      "865395075681633",
  "contact_auth_uid": "<user2_firebase_uid>"
}
```

**Response `200` (new registration):**
```json
{
  "status":           "ok",
  "device_imei":      "865395075681633",
  "contact_auth_uid": "<user2_firebase_uid>"
}
```

**Response `200` (already registered — idempotent re-call):**
```json
{
  "status":             "ok",
  "already_registered": true,
  "device_imei":        "865395075681633",
  "contact_auth_uid":   "<user2_firebase_uid>"
}
```
No email is sent on `already_registered: true` — idempotent re-call must not spam the contact.

**Errors:**
- `400` — missing `device_imei`/`contact_auth_uid`, `cannot_be_self`, or `contact_no_email` (contact exists but has no email/alt_email on file)
- `401` — missing/invalid Firebase Bearer token
- `403` — caller does not own `device_imei`
- `404` — `contact_not_synced` (no `users` row exists for `contact_auth_uid`; ask them to open the app once)
- `502` — Brevo email delivery failed; the just-created DB row has been rolled back. The caller may safely retry.

**Email behavior:** Uses Brevo template id from `BREVO_TEMPLATE_EMERGENCY_CONTACT_ASSIGNED` env var (default `13`). Template params: `GRANTER_NAME`, `DEVICE_NAME`, `CONTACT_NAME`. Outbound address prefers `users.alt_email` (opportunistic real address captured by share/claim) over `users.email`.

---

### `DELETE /contact/{imei}/{contact_auth_uid}`

Owner-only revoke. Idempotent — succeeds whether the mapping existed or not.

**Auth:** Firebase Bearer token.

**Response `200`:**
```json
{ "status": "ok", "rows_affected": 1 }
```
`rows_affected: 0` means the mapping was already gone — still a success.

**Errors:**
- `400` — missing path params
- `401` — missing/invalid Firebase Bearer token
- `403` — caller does not own `imei`

---

### `GET /contact/byme`

Lists every emergency-contact mapping the caller has assigned, grouped by device.

**Auth:** Firebase Bearer token.

**Response `200`:**
```json
{
  "status": "ok",
  "devices": [
    {
      "imei":        "865395075681633",
      "device_name": "FUJI CBR1015",
      "contacts": [
        { "auth_uid": "u_abc...", "name": "Alice", "email_masked": "a****@example.com" },
        { "auth_uid": "u_def...", "name": "Bob",   "email_masked": "b**@example.com" }
      ]
    }
  ]
}
```

`email_masked` shows only the first character of the local part plus the domain, since the owner identified the contact by QR/uid and doesn't necessarily need the full address — masking is enough for visual recognition. Returns an empty `devices: []` array if the caller has not registered any contacts.

---

### `GET /contact/device/{imei}`

Same shape as a single `devices[]` element of `byme`. Convenience for the per-device settings screen.

**Auth:** Firebase Bearer token. Ownership-checked.

**Response `200`:**
```json
{
  "status":      "ok",
  "imei":        "865395075681633",
  "device_name": "FUJI CBR1015",
  "contacts": [
    { "auth_uid": "u_abc...", "name": "Alice", "email_masked": "a****@example.com" }
  ]
}
```

**Errors:**
- `400` — missing `imei` path param
- `401` — missing/invalid Firebase Bearer token
- `403` — caller does not own `imei`

---

## Error Responses

All endpoints follow a consistent error format:

```json
{
  "error": "Human-readable error message"
}
```

Or for auth/webhook errors:

```json
{
  "status": "error",
  "message": "Human-readable error message"
}
```

**Common HTTP Status Codes:**

| Code | Meaning |
|------|---------|
| 200  | Success |
| 201  | Created |
| 400  | Bad request / validation error |
| 401  | Missing or invalid authentication |
| 403  | Forbidden (admin required) |
| 404  | Resource not found |
| 500  | Internal server error |
| 502  | External service error (Traccar, Simbase) |

---

## Environment Variables

### Core infrastructure

| Variable | Description |
|----------|-------------|
| `DB_HOST` / `DB_NAME` / `DB_USER` / `DB_PASS` / `DB_PORT` | MySQL connection (port defaults to `3306`) |
| `ADMIN_KEY` | Value the `X-Admin-Key` header must match for the admin bypass |

### Traccar

| Variable | Description |
|----------|-------------|
| `TRACCAR_ADMIN_USER` / `TRACCAR_ADMIN_PASS` | Admin Basic-Auth credentials applied to every outbound Traccar request |
| `TRACCAR_TEST_URL` | Default `server_url` for `/server/status` and `/server/test` |
| `TRACCAR_DEFAULT_URL` | Default `server_url` for `/server/token` |
| `TRACCAR_WEBHOOK_SECRET` | Bearer secret verifying `POST /webhook/traccar-notification` |
| `GLOBAL_NOTIFICATION_IDS` | Comma-separated list of Traccar notification ids the admin owns; every new user is linked to this set in `/user/sync` (instead of getting per-user copies) |
| `COMPUTED_ATTRIBUTE_IDS` | Comma-separated list of Traccar computed-attribute ids that every newly created device gets linked to (e.g. PowerCut) |

### Firebase

Firebase service-account credentials are read by the `Kreait` SDK (typically `GOOGLE_APPLICATION_CREDENTIALS` or in-repo service account JSON) — see `App\Services\Firebase`.

### Simbase

| Variable | Description |
|----------|-------------|
| `SIMBASE_API_KEY` | Simbase v2 API key |

### Xendit

| Variable | Description |
|----------|-------------|
| `XENDIT_SECRET_KEY` | Xendit API secret key |
| `XENDIT_WB_TOKEN` | Header value `x-callback-token` must match for `/webhook/xendit/paysession` |

### Medusa (storefront / ecommerce backend)

| Variable | Description |
|----------|-------------|
| `MEDUSA_BACKEND_URL` | Base URL for the Medusa store API |
| `MEDUSA_PUBLISHABLE_KEY` | `x-publishable-api-key` header value for Medusa store endpoints |
| `MEDUSA_BASIC_PRODUCT_ID` / `MEDUSA_PRO_PRODUCT_ID` | Product ids used by `/webhook/data-renew` for cross-tier price lookup |
| `MEDUSA_BASIC_3MO_VARIANT_ID` / `MEDUSA_PRO_3MO_VARIANT_ID` | 3-month variants used as the canonical price points for tier-conversion math |
| `MEDUSA_REGION_DEFAULT` | Fallback Medusa region id when the customer's country has no mapping |
| `MEDUSA_REGION_<CC>` | Per-country region overrides (e.g. `MEDUSA_REGION_PH`) |

### posbroker

| Variable | Description |
|----------|-------------|
| `POSBROKER_WEBHOOK_SECRET` | Bearer secret verifying `POST /webhook/impact-detected`, `/webhook/posbroker-notify`, `/webhook/activity-lock-set` |

### Brevo (transactional email)

| Variable | Description |
|----------|-------------|
| `BREVO_API_KEY` | Brevo email API key |
| `BREVO_TEMPLATE_SHARE_INVITE` | Template id used by `POST /share/invite` (mint fails 502 if unset / `0`) |
| `BREVO_TEMPLATE_EMERGENCY_CONTACT_ASSIGNED` | Template id used by `POST /contact/register` (default `13`) |

### Misc

| Variable | Description |
|----------|-------------|
| `EXCHANGERATE_API_KEY` | ExchangeRate-API v6 key used by `/cron/php_fx_rate` |
| `DIGITAL_FULFILLMENT_SECRET` | Shared Bearer secret in both directions for Medusa ↔ api.navitag.net (`/webhook/data-renew` accept and the outbound fulfillment confirmation) |
