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

Save or update the user's Firebase Cloud Messaging token.

**Request Body:**
```json
{
  "fcm_token": "dXy7abc...",     // required
  "platform":  "android|ios|pwa|web",  // optional; how the client is running
  "device_label": "Chrome (Android PWA)"  // optional; human-readable hint
}
```

`platform` values:
- `android` / `ios` — native Capacitor app
- `pwa` — installed web PWA (display-mode: standalone)
- `web` — regular browser tab

**Response `200`:**
```json
{
  "status": "success",
  "message": "FCM token updated successfully"
}
```

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
  "name": "My Tracker"            // required, display name
}
```

**Response `200`:**
```json
{ "status": "success" }
```

**Validations:**
- Device must exist and not already be assigned (`server_user_id` must be empty)
- User and device must be on the same Traccar server

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

Sync rules:
- `/share/grant` and `/share/update` write MySQL first, then sync the broker if `position:live` is involved.
- `/share/revoke` deletes the MySQL row and removes the IMEI from the broker.
- `/share/tome` and `/share/byme` treat the broker as authoritative for `position:live`. A MySQL row whose `scopes` include `position:live` but whose IMEI is NOT in the broker's list for that grantee is **stale** and is deleted on read (self-healing cleanup).
- A MySQL row WITHOUT `position:live` (e.g. history-only) is valid on its own — the broker is not consulted for these.

Valid `scopes` values: `position:live`, `history:read`, `notification:read`.

---

### `POST /share/grant`

Grant the same scope set on one or more devices to a single recipient (`target_firebase_uid`). For each listed device, upserts a row in `device_permissions`. If `position:live` is in the scope set, also adds the IMEIs to the broker's permission set for the grantee. Caller must currently own all listed devices.

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

`broker_synced` is `true` when `position:live` was in `scopes` and the broker patch succeeded; `false` for non-position-only grants.

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
| 502 | `{"error": "Broker error", "details": "..."}` | posbroker admin API rejected the patch (MySQL writes have already landed) |

---

### `POST /share/update`

Replace the scope set of a single existing grant. If `position:live` was added or removed by the change, the broker is synced accordingly. Caller must currently own the device.

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

`broker_synced` is `true` only when `position:live` toggled on or off (added or removed by the update).

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{"error": "target_firebase_uid required"}` | Missing/invalid grantee uid |
| 400 | `{"error": "device_imei required"}` | Missing or wildcard IMEI |
| 400 | `{"error": "scopes must be a non-empty array of: ..."}` | Missing, empty, or unknown scope value |
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 403 | `{"error": "Device not linked to this user", "unauthorized_devices": [...]}` | Caller does not own the device |
| 404 | `{"error": "grant not found"}` | No existing `device_permissions` row for that `(imei, grantee)` |
| 502 | `{"error": "Broker error", "details": "..."}` | Broker patch failed (the MySQL update has already landed) |

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
    },
    {
      "imei": "350987654321098",
      "scopes": ["history:read"]
    }
  ]
}
```

`scopes` values:
- `position:live` — present whenever the IMEI is in the caller's broker permission set (broker is authoritative). Also added when the broker returns a wildcard (`["*"]`) — emitted once as `{"imei": "*", "scopes": ["position:live"]}`.
- `history:read`, `notification:read`, … — sourced from `device_permissions.scopes` for that IMEI/grantee pair.

A history-only grant (MySQL row with no `position:live`) is returned even when the broker has no entry for that IMEI.

When the caller has no broker permissions and no non-stale MySQL rows, `shared_devices` is `[]`.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |
| 502 | `{"error": "Broker error", "details": "..."}` | posbroker admin API unreachable or returned an error. MySQL stale-row cleanup is skipped when the broker call fails. |

---

### `POST /share/byme`

Return all grants the caller has issued (where `granted_by_auth_uid` equals the caller). For each unique grantee, the broker's permission set is fetched once and used to validate any MySQL row whose `scopes` include `position:live`. Stale rows (position-bearing rows whose IMEI is missing from the broker's list for that grantee) are deleted on read. Rows without `position:live` are returned without consulting the broker. If the broker call fails for a particular grantee, that grantee's rows are returned as-is and no cleanup is performed.

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

When the caller has issued no grants (or all of theirs were stale and just got cleaned up), `granted` is `[]`.

**Error Responses:**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{"error": "Unauthorized"}` | No Firebase user on request |

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

### `POST /notification/send`

Send a push notification via FCM. **Superadmin only** (checks email = `superadmin@navitag.com`).

**Request Body:**
```json
{
  "token": "fcm_device_token",    // required
  "title": "Hello",               // required
  "body": "World",                // required
  "data": { "key": "value" }      // optional
}
```

**Response `200`:**
```json
{
  "status": "success",
  "message": "Notification sent"
}
```

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
