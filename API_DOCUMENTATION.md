# Navitag Consolidated API v1

**Base URL:** `https://api.navitag.net/v1`

---

## Authentication

All endpoints require authentication unless otherwise noted.

| Method | Header | Description |
|--------|--------|-------------|
| Firebase Auth | `Authorization: Bearer {idToken}` | Standard user authentication via Firebase ID token |
| Admin Key | `X-Admin-Key: {key}` | Bypasses Firebase auth, grants admin privileges |
| Webhook Token | `x-callback-token: {token}` | Used by Xendit webhook callbacks |

**Auth Behavior:**
- Valid Firebase token attaches decoded JWT claims (including `sub` as user ID) to the request
- Admin Key bypass attaches a mock superadmin user with `admin: true`
- Webhook paths (`/webhooks/*`) bypass authentication entirely

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

Same as `POST /server/status` with no request body (uses default server URLs).

---

## User

### `POST /user/sync`

Create or sync a user account across local DB and Traccar.

**Request Body:**
```json
{
  "country_code": "PH",          // required, 2-letter ISO
  "name": "John Doe",            // optional
  "phone": "+639171234567"        // optional
}
```

**Response `201` (new user):**
```json
{
  "status": "success",
  "server_url": "tserver1.navitag.com",
  "name": "John Doe",
  "phone": "+639171234567"
}
```

**Response `200` (existing user synced):**
```json
{
  "status": "success",
  "server_url": "tserver1.navitag.com",
  "name": "John Doe",
  "phone": "+639171234567",
  "server_token": "abc123..."
}
```

**Business Logic:**
- New users are created on Traccar with `deviceLimit: -1`, `userLimit: 0`, `limitCommands: true`
- Existing users are synced — name, email, phone are updated on Traccar if changed
- Password is derived from the Firebase email (base64url encoded)

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

### `GET /user/device-expiration`

Get expiration dates for all devices assigned to the authenticated user.

**Response `200`:**
```json
{
  "status": "success",
  "message": [
    {
      "server_ref": 101,
      "imei": "123456789012345",
      "expiration": "2026-06-15"
    }
  ]
}
```

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

**Business Logic:**
- SIM must be in `disabled` state with empty or `@@` name
- Creates device on Traccar with name `@@ {last4_imei}/{last4_iccid}`
- Sets SIM name on Simbase to `@@ {imei}`
- On any failure, rolls back: deletes Traccar device and resets SIM name
- Default values: `brand: istartek`, `model: VT100`, `distribution_channel: direct`

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
    "brand": "istartek",
    "model": "VT100",
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
    "plan_level": "Basic"
  }
}
```

**Response `404`:**
```json
{ "error": "Device not found or not linked to your account" }
```

**Business Logic:**
- Matches the authenticated user's `server_id` (from `users` table) against `server_user_id` in `device_inventory`
- Returns the full device record only if the device is linked to the requesting user

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
- Converts local date (00:00:00 – 23:59:59) to UTC using the provided or detected timezone
- Superadmin can query any device; regular users can only query their own

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

Ownership is enforced: every IMEI submitted must be linked to the caller via `device_inventory.server_user_id = users.server_id`. Any unowned IMEI yields `403` with the offending values listed in `unauthorized_devices`.

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
| 403 | `{"error": "One or more devices are not linked to this user", "unauthorized_devices": [...]}` | Caller does not own one or more submitted IMEIs |
| 502 | `{"error": "Broker error", "details": "..."}` | posbroker admin API rejected the mint request |

---

### Permission model (applies to `/share/grant`, `/share/update`, `/share/revoke`, `/share/tome`, `/share/byme`)

Persistent device-sharing permissions live in two stores:

- **MySQL `device_permissions`** — record of granter intent. One row per `(device_imei, grantee_auth_uid)` pair. Each row carries a `scopes` `SET` column with one or more of: `position:live`, `history:read`, `notification:read`. Rows are permanent until an explicit revoke.
- **posbroker** — authoritative for `position:live` at runtime. Stores a flat `permissions:{firebase_uid}` set of IMEIs allowed to subscribe to live position MQTT topics. The broker has no knowledge of granter or non-position scopes.

**Floor-scope rule (important for frontend):**

`position:live` is the **minimum scope** for any active grant. It is implicit on every successful `grant` and `update` call, regardless of what the request `scopes` array contains. Concretely:

- Every successful `grant` / `update` adds the IMEI to the broker's permission set for the grantee. The broker assertion is unconditional.
- `history:read` and `notification:read` are **add-ons** on top of `position:live`, not standalone scopes. There is no way to grant history/notification access without also granting live position.
- An `update` call that omits `position:live` from its `scopes` array (e.g. `["history:read"]`) only changes the MySQL `scopes` column. The broker entry stays — meaning the grantee still has live position access. Reading back via `/share/tome` will still show `position:live` in the scope list.
- The only way to remove `position:live` for a `(device, grantee)` pair is `/share/revoke`, which drops the MySQL row AND removes the IMEI from the broker.

This is intentional: live position is the baseline of the share. Users do not opt in to history-only or notification-only sharing.

Sync rules (verified against current code):

- `/share/grant` writes the broker first (adds the IMEIs for the grantee), then commits the MySQL upsert. On MySQL failure, the broker change is compensated (rolled back). Broker is called unconditionally.
- `/share/update` re-asserts the broker (idempotent add), then updates the MySQL `scopes` column. Broker is called unconditionally even if `scopes` does not include `position:live` — see floor-scope rule above.
- `/share/revoke` deletes the MySQL row first, then removes the IMEI from the broker.
- `/share/tome` reads broker as authoritative for `position:live`, layers MySQL extra scopes on top, and lazily deletes any MySQL row whose IMEI is no longer in the broker (self-healing cleanup for out-of-band broker drift).
- `/share/byme` reads MySQL only — relies on the write-path invariant (every MySQL row has a corresponding broker entry).

Valid `scopes` values: `position:live`, `history:read`, `notification:read`. Callers SHOULD always include `position:live` in `scopes` to make intent explicit, even though the server enforces it as a floor.

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
| 400 | `{"error": "scopes must be a non-empty array of: position:live, history:read, notification:read"}` | Missing, empty, or unknown scope value |
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
      "scopes": ["position:live", "history:read"]
    },
    {
      "imei": "860123456789012",
      "scopes": ["position:live"]
    }
  ]
}
```

`scopes` values:
- `position:live` — always present per the floor-scope rule. Also added when the broker returns a wildcard (`["*"]`) — emitted once as `{"imei": "*", "scopes": ["position:live"]}`.
- `history:read`, `notification:read` — sourced from `device_permissions.scopes` for that IMEI/grantee pair, layered on top of `position:live`.

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

**Request Body:** *(none)*

**Response `200`:**
```json
{
  "status": "success",
  "granted": [
    {
      "grantee_auth_uid": "<grantee firebase uid>",
      "device_imei":      "353456789012345",
      "scopes":           ["position:live", "history:read"]
    },
    {
      "grantee_auth_uid": "<another grantee>",
      "device_imei":      "350987654321098",
      "scopes":           ["history:read"]
    }
  ]
}
```

When the caller has issued no grants, `granted` is `[]`.

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
| `scopes` | yes | Non-empty subset of `position:live`, `history:read`, `notification:read`. **Must include `position:live`** (floor scope). |
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

### `POST /webhooks/xendit/paysession`

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
      "product_id": "prod_01ABC...",
      "variant_id": "variant_01ABC...",
      "title": "Pro Data Plan",
      "variant_title": "3 Months",
      "sku": "DATA-PRO-3M",
      "quantity": 1,
      "unit_price": 1500,
      "total": 1500
    }
  ]
}
```

**Response `200`:**
```json
{
  "status": "success",
  "message": "Data renewal received."
}
```

**Business Logic (runs after response is sent):**

1. Looks up device by IMEI in `device_inventory`
2. Parses months from `variant_title` (e.g. "3 Months")
3. Determines purchased plan tier from item `title` (contains "Pro" → Pro, otherwise Basic)
4. Applies plan-level-aware expiration logic:
   - **Same tier** (Basic→Basic or Pro→Pro): extends expiration from current date or today (if expired) by purchased months
   - **Basic → Pro upgrade**: converts remaining Basic days at 2:1 ratio: `converted_days = floor((remaining_days - 1) / 2)`. Sets `plan_level = "Pro"`, expiration = today + purchased months + converted days
   - **Pro → Basic downgrade**: converts remaining Pro days at 1.5:1 ratio: `converted_days = floor((remaining_days - 1) * 1.5)`. Sets `plan_level = "Basic"`, expiration = today + purchased months + converted days
5. POSTs fulfillment confirmation to `https://shopapi.navitag.com/hooks/digital-fulfillment` with:
   - `order_id`, `order` (full order details), `items` (with activation codes), `device` (updated imei, plan_level, expiration, model, brand, server_ref), `message`

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

## Cron

### `GET /cron/php_fx_rate`

Fetch and store the latest USD to PHP exchange rate.

**Response `200`:**
```json
{
  "status": "success",
  "rate": "{\"rate\": 56.25}",
  "message": "Exchange rate updated successfully."
}
```

**Business Logic:**
- Fetches from ExchangeRate-API v6
- Stores in `keypair_settings` table under key `php_fx_rate`

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

On signup (`/user/sync` first call) and on every `/user/link-device`, the backend **auto-seeds** both switches to `1` and creates default rules for every owned device covering: `ignitionOn`, `ignitionOff`, `geofenceEnter`, `geofenceExit`, `deviceOverspeed`, `alarm:powerCut`, `activity_lock_breach`, `activity_lock_auto`. The UI can rely on these defaults existing — it doesn't have to bootstrap them.

### Event-type vocabulary

`event_type` is a string. Two shapes are accepted on write:

| Shape | Examples |
|---|---|
| Plain event name | `ignitionOn`, `geofenceEnter`, `deviceOverspeed`, `deviceMoving` |
| `alarm:<subtype>` | `alarm:powerCut`, `alarm:sos`, `alarm:hardAcceleration`, `alarm:hardBraking`, `alarm:hardCornering`, `alarm:accident` |

The full canonical list of plain event names is returned by `GET /notification/permissions` in the `available_event_types` field — the UI should source from that response rather than hard-coding. The default-seeded subset is in `default_event_types`. Alarm subtypes are open-ended (any ASCII `[a-zA-Z][a-zA-Z0-9_-]{0,30}` after `alarm:`).

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
    "activity_lock_breach", "activity_lock_auto"
  ],
  "default_event_types": [
    "ignitionOn", "ignitionOff",
    "geofenceEnter", "geofenceExit",
    "deviceOverspeed",
    "alarm:powerCut",
    "activity_lock_breach",
    "activity_lock_auto"
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

| Variable | Description |
|----------|-------------|
| `DB_HOST` | MySQL host |
| `DB_NAME` | MySQL database name |
| `DB_USER` | MySQL username |
| `DB_PASS` | MySQL password |
| `TRACCAR_ADMIN_USER` | Traccar admin email |
| `TRACCAR_ADMIN_PASS` | Traccar admin password |
| `TRACCAR_TEST_URL` | Default Traccar server for status checks |
| `TRACCAR_DEFAULT_URL` | Default Traccar server for token generation |
| `SIMBASE_API_KEY` | Simbase API key |
| `XENDIT_SECRET_KEY` | Xendit API secret key |
| `XENDIT_WB_TOKEN` | Xendit webhook verification token |
| `ADMIN_KEY` | Admin key for X-Admin-Key bypass |
| `EXCHANGERATE_API_KEY` | ExchangeRate-API key |
| `BREVO_API_KEY` | Brevo email API key |
| `DIGITAL_FULFILLMENT_SECRET` | Shared secret for Medusa ↔ api.navitag.net webhook auth (Bearer token) |
