# Navitag POS Broker — API & Configuration Guide

**Broker URL:** `posbroker.navitag.com`
**Technology:** Aedes MQTT Broker + Express Admin API
**Firebase Project:** `track-navitag-com`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Transport Protocols](#2-transport-protocols)
3. [MQTT Authentication](#3-mqtt-authentication)
4. [MQTT Topics](#4-mqtt-topics)
5. [MQTT Authorization Rules](#5-mqtt-authorization-rules)
6. [Admin REST API](#6-admin-rest-api)
7. [Traccar Server Configuration](#7-traccar-server-configuration)
8. [Frontend WebSocket Client](#8-frontend-websocket-client)
9. [Error Reference](#9-error-reference)

---

## 1. Overview

The POS Broker is a centralized real-time GPS telematics hub that:

- Receives position data from multiple Traccar servers via **HTTPS POST** to `/hooks/traccar-positions` (bearer-authenticated). The MQTT `traccar/positions` topic is preserved internally for MQTT 3.1.1 clients but is not the production ingress — Traccar v6.x hard-codes MQTT 5 and Aedes does not support MQTT 5.
- Re-publishes positions on per-device topics keyed by **Traccar `uniqueId`** (IMEI/serial number) to avoid collision across servers
- Serves real-time position data to two client audiences over WebSockets (WSS):
  - Logged-in users, authenticated with **Firebase ID tokens** and authorized per-UID via Redis
  - Recipients of **share-link tokens** — opaque, time-boxed bearer tokens with a pre-bound device scope, for share URLs sent to people who have no Firebase account
- Forwards selected devices' positions to **external Traccar servers** via the OsmAnd HTTP protocol (fire-and-forget, configured per "forwarding group")
- Exposes an admin REST API for managing Firebase user permissions (list / add / atomic add+remove / delete), share-link tokens (mint / list-all or by-subject / lookup by raw or hash / revoke by raw or hash), and OsmAnd forwarding groups (create / read / update / delete)

### Data Flow

```
Traccar Server(s)
      │
      │  HTTPS POST https://posbroker.navitag.com/hooks/traccar-positions
      │  Authorization: Bearer <TRACCAR_API_KEY>
      │  Body: Traccar `json` forward payload
      ▼
┌──────────────────────────────┐
│  Aedes broker (Express +     │
│  MQTT + WSS, all one proc)   │
│                              │
│  processTraccarPosition():   │
│   • extract device.uniqueId  │
│   • aedes.publish (retained) │
│     to devices/{uniqueId}/pos│
│   • per-device lookup:       │
│     HTTP GET → ext. Traccar  │
│     (OsmAnd protocol)        │
└──────────┬───────────────┬───┘
           │               │
           │               └─► External Traccar server(s)
           │                   GET /?id=<uniqueId>&lat=&lon=&...
           │
           │  WSS subscribe to "devices/{uniqueId}/pos"
           │  (auto-subscribed by broker based on caller's scope)
           │
      ┌────┴────────────────────────────┐
      │                                 │
      ▼                                 ▼
 Logged-in users                   Share-link recipients
 (Firebase ID token)               (username=token, password=nvtk_...)
 Scope: Redis                      Scope: embedded in token record
 permissions:{uid}                 (expires automatically)
```

---

## 2. Transport Protocols

| Protocol | Endpoint | Port | TLS |
|----------|----------|------|-----|
| **Traccar ingress (HTTPS POST)** | `https://posbroker.navitag.com/hooks/traccar-positions` | 443 | Yes (proxied by Caddy) |
| WSS (WebSocket) | `wss://posbroker.navitag.com` | 443 | Yes (proxied by Caddy) |
| Admin API | `https://posbroker.navitag.com` | 443 | Yes (proxied by Caddy) |
| MQTT (raw, legacy 3.1.1 only) | `posbroker.navitag.com` | 1883 | No |
| MQTTS (legacy 3.1.1 only) | `posbroker.navitag.com` | 8883 | Yes (auto-provisioned by Caddy) |

> **MQTT ingress is legacy.** Traccar v6.x hard-codes MQTT 5 (unsupported by Aedes). Use the HTTPS POST route for all real Traccar servers. The MQTT listeners remain live for MQTT 3.1.1 test harnesses and alternative telematics sources.

---

## 3. MQTT Authentication

All MQTT connections require authentication. There are **three** authentication methods. The broker determines which to use based on the `username` field:

| `username` | `password` | Method |
|------------|------------|--------|
| `traccar` | pre-shared API key | Traccar service |
| `token` + password starts with `nvtk_` | opaque share-link token | Share-link token |
| anything else | Firebase ID token | Firebase client |

### 3.1 Traccar Service Authentication

> **DEPRECATED for real Traccar servers.** Traccar v6.x hard-codes MQTT 5 — incompatible with Aedes. Production Traccar servers authenticate via HTTPS bearer token on `POST /hooks/traccar-positions` (see [§7 Traccar Server Configuration](#7-traccar-server-configuration)). The MQTT username/password path below is kept active for MQTT 3.1.1 telematics sources and the test harness only.

Used by MQTT 3.1.1 Traccar-compatible clients to publish position data.

| Field | Value |
|-------|-------|
| Username | `traccar` |
| Password | Pre-shared API key (same key used for the HTTPS bearer) |

**Current API Key (used as both MQTT password and HTTPS bearer token):**
```
dc85a920a30419f60ddb6bb11ca120b3a0b017ac2235699cfedde6c816e2de28
```

### 3.2 Firebase Client Authentication

Used by logged-in browser/app users to subscribe to device positions.

| Field | Value |
|-------|-------|
| Username | *(any value or empty)* |
| Password | Firebase ID token (from `track-navitag-com` project) |

The broker verifies the Firebase ID token server-side using the Firebase Admin SDK. On success, the client's `firebaseUid` is stored on the connection for use in authorization checks.

Firebase ID tokens expire after ~1 hour. On expiry the broker disconnects the client; the client must fetch a fresh token (`getIdToken(true)`) and reconnect.

### 3.3 Share-Link Token Authentication

Used by recipients of a public share URL — no Firebase account required. The admin mints a token via [`POST /admin/tokens`](#63-share-link-tokens), scoped to one or more device `uniqueId`s and a TTL of up to 24 hours. The raw token is embedded in the share URL; the recipient's frontend passes it as the MQTT password.

| Field | Value |
|-------|-------|
| Username | `token` (literal string) |
| Password | `nvtk_` + 64 hex characters (e.g., `nvtk_1adc07d47d99...`) |

Token properties:

- **Format:** `nvtk_` prefix + 32 bytes of cryptographic randomness, hex-encoded (69 chars total).
- **Scope:** fixed at issuance — an explicit list of device `uniqueId`s. Wildcards are rejected.
- **TTL:** minimum 60 s, maximum 24 h.
- **Storage:** Redis DB 1 key `token:<sha256(raw)>`, with the raw value retained on the record so admins can look it up and reshare. The Redis record is deleted on TTL expiry or admin revocation; any live MQTT connection using that token is force-closed.
- **Auth errors:** the broker returns a single error to the client — `Token invalid` — for all three failure modes (not found, TTL zero, scope invalid). The specific reason is logged server-side only. This prevents sharing information about the token's state with an attacker probing the endpoint.

---

## 4. MQTT Topics

### `traccar/positions` (Publish — Traccar only, **internal-only now**)

> **Internal-only.** Real Traccar v6.x servers ingest via `POST /hooks/traccar-positions` (see §7). This MQTT topic is retained as a secondary ingress for MQTT 3.1.1 publishers (test harness, custom Traccar fork). The broker's HTTP route and this MQTT topic share the same `processTraccarPosition()` handler, so behavior is identical regardless of entry path.

Publishers that can speak MQTT 3.1.1 may publish position updates to this topic. The broker does not retain these messages on `traccar/positions` itself — it re-publishes (retained) to `devices/{uniqueId}/pos`.

**Payload format** (same JSON shape sent by Traccar's `json` forwarder):

```json
{
  "device": {
    "id": 1,
    "uniqueId": "353456789012345",
    "name": "Vehicle A",
    "status": "online",
    "category": "car"
  },
  "position": {
    "id": 1234,
    "deviceId": 1,
    "latitude": 14.5995,
    "longitude": 120.9842,
    "altitude": 15.0,
    "speed": 45.2,
    "course": 180.0,
    "accuracy": 5.0,
    "fixTime": "2026-04-05T12:00:00.000Z",
    "serverTime": "2026-04-05T12:00:01.000Z",
    "attributes": {
      "batteryLevel": 85,
      "ignition": true
    }
  }
}
```

### `devices/{uniqueId}/pos` (Subscribe — Firebase + token clients)

The broker automatically re-publishes each incoming position from `traccar/positions` to a per-device topic using the **Traccar `device.uniqueId`** (typically the device's IMEI or serial number).

- **Retained:** Yes — new subscribers immediately receive the last known position
- **Key:** `uniqueId` is used instead of Traccar's internal `deviceId` to avoid collisions when multiple Traccar servers forward to the same broker
- **Payload:** Same JSON as the original `traccar/positions` message

**Example:** A device with IMEI `353456789012345` → topic `devices/353456789012345/pos`

### 4.1 OsmAnd Forwarding to External Traccar

Every position the broker receives on `traccar/positions` is also checked against the forwarding-group index. If the device is a member of a group, the position is sent to each of that group's URLs via an **OsmAnd HTTP GET** — the protocol all Traccar installations support out of the box.

| Property | Value |
|----------|-------|
| Trigger | Inline with the publish handler, after the internal retain-republish. Not awaited — must not block the MQTT event loop. |
| Identifier emitted | `id=<uniqueId>` — the same Traccar `device.uniqueId` used for topic keying. **No device metadata is forwarded** (no `name`, `category`, `status`, or internal `device.id`). |
| Request shape | `GET <url>?id=<uniqueId>&lat=<>&lon=<>&timestamp=<ISO8601>&speed=<knots>&bearing=<>&altitude=<>&accuracy=<>&batt=<>` |
| Timeout | 3 s per attempt |
| Retries | 1 (total 2 attempts); 500 ms delay between attempts |
| Durability | Fire-and-forget. A dropped position is recoverable — the next position arrives within seconds and is a superset of any missed one. |

**Destination Traccar setup.** The receiver looks up the device by its `id=` param against its own device registry. Ops must pre-register the device under the **same `uniqueId`** as the source Traccar. Otherwise the receiver drops the position as "unknown device". No per-destination ID remapping is implemented.

**Broker logs.** Every attempt logs one line:

```
[forward] <group>/<uniqueId> -> <url> status=200
[forward] <group>/<uniqueId> -> <url> err=<message>
```

See [§6.5 Forwarding Groups](#65-forwarding-groups) for the admin endpoints that configure this.

---

## 5. MQTT Authorization Rules

### Publishing

Only Traccar service accounts can publish. Firebase clients and token clients are blocked from publishing to any topic — attempts are rejected with `Publish not allowed`.

### Subscribing

Non-Traccar clients may only subscribe to `devices/{uniqueId}/pos`. The rules depend on the client type:

**Firebase clients**

1. **Wildcard permission** — if the user has `*` in their permission set, all devices are allowed.
2. **Device-specific permission** — the `uniqueId` from the topic must exist in the user's permission set in Redis.

If neither check passes, the subscription is rejected with `Not authorized for this device`.

**Share-link token clients**

1. The topic must match `devices/{uniqueId}/pos` exactly — single-level MQTT wildcards (`+`) and multi-level wildcards (`#`) are rejected with `Invalid topic`.
2. The `uniqueId` must appear in the scope embedded in the token record at issuance.

Token clients **cannot use `*`** and cannot subscribe outside their pre-bound device list. A defense-in-depth `authorizeForward` hook additionally filters outgoing messages per connection, so even if a subscription slipped past authorization, no out-of-scope positions would be delivered.

**Permission storage:**
- Firebase clients — Redis DB 1, key `permissions:{firebase_uid}`, type: Set of `uniqueId` strings (`*` as a member grants wildcard).
- Token clients — Redis DB 1, key `token:<sha256(raw)>`, field `devices_json` (JSON array of `uniqueId`s).

### Auto-Subscribe on Connect

**No client ever needs to call `subscribe()`.** The broker subscribes the client server-side based on its scope, so retained last-known positions are delivered immediately and live updates flow in as they arrive.

| Client type | What the broker subscribes on their behalf |
|-------------|---------------------------------------------|
| Firebase wildcard (`*`) | `devices/+/pos` (matches every device) |
| Firebase per-device | `devices/{uniqueId}/pos` for each permitted device |
| Share-link token | `devices/{uniqueId}/pos` for each device in the token's scope |
| No permissions / empty scope | *(none — connection succeeds but no data)* |

### Forced Disconnect on Token Expiry / Revocation

For token clients, the broker additionally arms two timers on connect:

1. A **`setTimeout`** scheduled for the token's `expires_at` — fires `client.close()` exactly at expiry.
2. A **30-second sweeper** that re-checks the token's Redis TTL — catches admin revocation (`DELETE /admin/tokens/:token`) within at most 30 s without needing Redis keyspace notifications.

Both timers are cleared automatically when the connection closes. A reconnect attempt with an expired or revoked token fails with `Token invalid`.

---

## 6. Admin REST API

Base URL: `https://posbroker.navitag.com`. All `/admin/*` endpoints require HTTP Basic Auth.

### 6.1 Authentication

All `/admin/*` endpoints are gated by a single admin credential (HTTP Basic Auth username + password). This credential functions as the broker's **admin API key** — there is no per-user admin concept and no separate token/API-key mechanism for the admin surface.

#### Current credential

| Field | Value | Env var on the broker |
|-------|-------|-----------------------|
| Username | `admin` | `ADMIN_USER` |
| Password (admin API key) | `navi7ag_br0k3r_adm1n!2026` | `ADMIN_PASS` |

The values are defined inline in `/root/navitag-stack/docker-compose.yml` under the `aedes` service environment. A restart of the `aedes` container is required after any change.

#### Usage

**curl (`-u` flag, easiest):**

```bash
curl -u 'admin:navi7ag_br0k3r_adm1n!2026' \
  https://posbroker.navitag.com/admin/permissions
```

**Explicit `Authorization` header** (for clients that don't accept `user:pass` directly — the value is `base64("admin:navi7ag_br0k3r_adm1n!2026")`):

```bash
curl -H 'Authorization: Basic YWRtaW46bmF2aTdhZ19icjBrM3JfYWRtMW4hMjAyNg==' \
  https://posbroker.navitag.com/admin/permissions
```

**Node (axios):**

```javascript
await axios.get('https://posbroker.navitag.com/admin/permissions', {
  auth: { username: 'admin', password: 'navi7ag_br0k3r_adm1n!2026' },
})
```

#### Auth-related error responses

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{"error": "Authentication required"}` | No `Authorization` header sent |
| 401 | `{"error": "Invalid credentials"}` | Wrong username or password |
| 503 | `{"error": "Admin API not configured — set ADMIN_PASS env var"}` | `ADMIN_PASS` not set on the broker |

#### Security note

The admin credential gates both user-permission management *and* the ability to mint arbitrary share-link tokens for any device in the system. Concretely:

- A leaked credential = any number of live share URLs can be minted for any device, up to 24 h each.
- Because share-link raw tokens are stored on their records (for admin reshare), a leaked credential also means every currently-live share URL can be listed in one shot via `GET /admin/tokens` (no subject required) or surfaced from a known hash via `GET /admin/tokens/by-hash/:hash`.

**Rotation procedure** (if compromise suspected):

1. Edit `ADMIN_PASS` in `/root/navitag-stack/docker-compose.yml`.
2. `docker compose -f /root/navitag-stack/docker-compose.yml up -d aedes` to pick up the new value.
3. Until rotation completes, assume every live share-link token is compromised — revoke sensitive ones via `DELETE /admin/tokens/:token` or `DELETE /admin/tokens/by-hash/:hash`. To mass-revoke, `GET /admin/tokens` lists every live token with its hash — iterate and DELETE each.

### 6.2 Public

#### `GET /health`

No authentication required. Returns broker status.

**Response:**

```json
{
  "status": "ok",
  "mqtt": { "connected": 3 },
  "redis": { "status": "ready" }
}
```

---

### 6.3 Firebase User Permissions

#### `GET /admin/permissions`

List all users and their permitted devices.

**Response:**

```json
{
  "oYppHkmjn7Om2GGOkEMXlCS5GXs1": ["353456789012345", "860123456789012"],
  "anotherFirebaseUid": ["*"]
}
```

---

#### `GET /admin/permissions/:firebase_uid`

List permitted devices for a specific user.

**Response:**

```json
{
  "firebase_uid": "oYppHkmjn7Om2GGOkEMXlCS5GXs1",
  "devices": ["353456789012345", "860123456789012"]
}
```

---

#### `POST /admin/permissions/:firebase_uid`

Add device permissions for a user. Values should be Traccar `uniqueId` (IMEI/serial).

**Request:**

```json
{
  "devices": ["353456789012345", "860123456789012"]
}
```

**Response:**

```json
{
  "firebase_uid": "oYppHkmjn7Om2GGOkEMXlCS5GXs1",
  "added": 2,
  "devices": ["353456789012345", "860123456789012"]
}
```

**Granting access to all devices:**

```json
{ "devices": ["*"] }
```

---

#### `DELETE /admin/permissions/:firebase_uid`

Remove specific device permissions, or all permissions for a user.

**Remove specific devices:**

```json
{ "devices": ["353456789012345"] }
```

**Remove all permissions** (send empty body or no body):

```bash
curl -X DELETE -u "admin:navi7ag_br0k3r_adm1n!2026" \
  https://posbroker.navitag.com/admin/permissions/oYppHkmjn7Om2GGOkEMXlCS5GXs1
```

**Response:**

```json
{
  "firebase_uid": "oYppHkmjn7Om2GGOkEMXlCS5GXs1",
  "devices": []
}
```

---

#### `PATCH /admin/permissions/:firebase_uid`

Atomically add and/or remove devices for a user in a single request. Preferred over sequential `POST` + `DELETE` because there is no window in which the permission set is mid-transition (important for revocations that must take effect immediately).

**Request:**

```json
{
  "add": ["860123456789012"],
  "remove": ["353456789012345"]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `add` | no | Array of device `uniqueId`s to add. Idempotent — existing entries are ignored. |
| `remove` | no | Array of device `uniqueId`s to remove. Idempotent — missing entries are ignored. |

At least one of `add` or `remove` must be present and non-empty — an empty body returns `400`.

**Order of operations:** `remove` is applied first, then `add`. This makes `{ "add": ["X"], "remove": ["X"] }` resolve to "X is present" (net add) rather than "X is absent" (net remove), which matches the intuition that the caller declared both a new desired state and a cleanup — the new state wins.

**Response `200`:**

```json
{
  "firebase_uid": "oYppHkmjn7Om2GGOkEMXlCS5GXs1",
  "added": 1,
  "removed": 1,
  "devices": ["860123456789012"]
}
```

The `added` / `removed` counters report actual Redis set changes (not request array sizes), so no-op additions/removals do not inflate them.

**Typical use:** device-handoff workflow where a vehicle's IMEI moves from one owner to another — the admin panel issues a single PATCH with `remove: [old_owner_devices]` against one UID and `add: [new_owner_devices]` against another.

---

### 6.4 Share-Link Tokens

Six endpoints cover the full lifecycle. A raw token is returned from `POST` and is also retained on the record so `GET` endpoints can surface it back to the admin for reshare when a recipient loses theirs. Admins who hold only the SHA-256 hash (e.g., from an old log line) can look up and revoke using the `/by-hash/:hash` endpoints.

#### `POST /admin/tokens`

Mint a new share-link token.

**Request:**

```json
{
  "subject": "customer_01HXYZ",
  "devices": ["353456789012345", "860123456789012"],
  "ttl_seconds": 3600,
  "label": "share link for John"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `subject` | yes | Free-form label used to group and later look up tokens (e.g., customer id). |
| `devices` | yes | Array of Traccar `uniqueId` strings. Non-empty. **`*` is rejected.** |
| `ttl_seconds` | either this or `expires_at` | Integer between 60 and 86400 (24 h). |
| `expires_at` | either this or `ttl_seconds` | Absolute unix seconds. Converted to TTL server-side; same 60 s / 24 h bounds. |
| `label` | no | Free-form human description — shows up in GET responses. |
| `created_by` | no | Free-form string, defaults to `"admin"`. |

**Response `201`:**

```json
{
  "token": "nvtk_1adc07d47d999f297b4b978f53d1dab70e7b5dadc07e81020bc35ef8a3fcdb84",
  "subject": "customer_01HXYZ",
  "devices": ["353456789012345", "860123456789012"],
  "expires_at": 1776089078,
  "ttl_seconds": 3600
}
```

The recipient URL should use a path segment so the token never appears in referrer headers or query-string logs:

```
https://app.navitag.com/share/nvtk_1adc07d47d999f297b4b978f53d1dab70e7b5dadc07e81020bc35ef8a3fcdb84
```

---

#### `GET /admin/tokens/:token`

Inspect a token by its raw value. Use this to confirm a specific token is still valid.

**Response `200`:**

```json
{
  "token": "nvtk_1adc07d4...",
  "subject": "customer_01HXYZ",
  "devices": ["353456789012345", "860123456789012"],
  "issued_at": 1776085478,
  "expires_at": 1776089078,
  "created_by": "admin",
  "label": "share link for John",
  "ttl_remaining_ms": 3598241
}
```

`404` if the token has expired or been revoked.

---

#### `GET /admin/tokens[?subject=<subject>]`

List all live tokens, or filter by subject. **This is the recovery path** — use it when a recipient loses their URL:

```bash
# All active tokens across every subject
curl -u admin:'navi7ag_br0k3r_adm1n!2026' \
  'https://posbroker.navitag.com/admin/tokens'

# Only tokens for one subject (faster, uses the subject index)
curl -u admin:'navi7ag_br0k3r_adm1n!2026' \
  'https://posbroker.navitag.com/admin/tokens?subject=customer_01HXYZ'
```

**Response `200`:**

```json
{
  "subject": "customer_01HXYZ",
  "tokens": [
    {
      "token": "nvtk_1adc07d4...",
      "token_hash": "1393b284e293822b0daafa1d5d15c37379bc25022199eeaa6ffb2582bee48169",
      "subject": "customer_01HXYZ",
      "devices": ["353456789012345", "860123456789012"],
      "issued_at": 1776085478,
      "expires_at": 1776089078,
      "created_by": "admin",
      "label": "share link for John",
      "ttl_remaining_ms": 3598241
    }
  ]
}
```

When no `subject` is given, the response is `{ "subject": null, "tokens": [...] }` with every active token across every subject. Use this for an overall audit; use the subject-filtered form (which uses the pre-built `token_index:<subject>` set) when you already know which customer you're serving.

Identify the intended token by `label` / `devices` / `expires_at`, copy its `token`, and resend the URL. The returned `token` is `null` for any record minted prior to the recovery feature — such tokens remain valid but can only be revoked (they cannot be resurfaced).

Stale entries in the subject index are self-healed on each call: any hash whose underlying record has expired is transparently removed.

---

#### `GET /admin/tokens/by-hash/:hash`

Inspect a token by its SHA-256 hash instead of its raw value. Useful when the only identifier you have is a hash from a log line — the response surfaces the raw `token` alongside the rest of the record so you can re-share or revoke without going through subject-wide listing.

```bash
curl -u admin:'navi7ag_br0k3r_adm1n!2026' \
  https://posbroker.navitag.com/admin/tokens/by-hash/fab38c73f974781645acc02a9a670571e4da5f69f16e75940f9990a833c7bbc5
```

**Response `200`:** same shape as `GET /admin/tokens/:token` (includes `token_hash`).

`404` if the token has expired or been revoked.

---

#### `DELETE /admin/tokens/:token`

Revoke a token by its raw value.

**Response `200`:** `{ "revoked": true }` — Redis record is deleted immediately. Any live connection using that token is force-closed within ~30 s by the broker's sweeper.

`404` if the token has already expired or been revoked.

---

#### `DELETE /admin/tokens/by-hash/:hash`

Revoke a token by its SHA-256 hash. Same effect as `DELETE /admin/tokens/:token`, but does not require the raw value — convenient when the raw token has already been shared out and the admin only has the hash on file.

**Response `200`:** `{ "revoked": true, "token_hash": "<hash>" }`

`404` if the token has already expired or been revoked.

---

### 6.5 Forwarding Groups

Five endpoints manage OsmAnd forwarding configuration. A "group" bundles one or more devices with one or more destination URLs. A device can belong to **at most one group** — this invariant is enforced by a Redis index and a `409` on conflict.

Storage (Redis DB 1):

| Key | Type | Contents |
|-----|------|----------|
| `forward:<group>` | HASH | `devices_json`, `urls_json`, `label`, `created_at`, `updated_at` |
| `forward_device_index:<uniqueId>` | STRING | `<group>` — hot-path O(1) lookup on each position |
| `forward_groups` | SET | `<group>` membership — drives list responses |

No TTL — forwarding rules are long-lived ops config.

#### `POST /admin/forwards`

Create a forwarding group.

**Request:**

```json
{
  "group": "reseller-alpha",
  "devices": ["353456789012345", "860123456789012"],
  "urls": ["https://reseller-alpha.traccar.com:5055"],
  "label": "Alpha reseller mirror"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `group` | yes | Matches `/^[a-zA-Z0-9_-]{1,64}$/`. |
| `devices` | yes | Non-empty array of Traccar `uniqueId`s. **`*` rejected.** Every entry must be unassigned or already in this same group — otherwise `409`. |
| `urls` | yes | Non-empty array. Each must parse as `http://` or `https://` with a host. Port defaults to Traccar convention (often `:5055`) — include it explicitly. |
| `label` | no | Free-form human description. |

**Response `201`:** full stored record (same shape as `GET /admin/forwards/:group`).

---

#### `GET /admin/forwards`

List all groups.

**Response `200`:**

```json
{
  "groups": [
    {
      "group": "reseller-alpha",
      "devices": ["353456789012345", "860123456789012"],
      "urls": ["https://reseller-alpha.traccar.com:5055"],
      "label": "Alpha reseller mirror",
      "created_at": 1776089660,
      "updated_at": 1776089660
    }
  ]
}
```

No pagination — dataset is small by design.

---

#### `GET /admin/forwards/:group`

Inspect one group. Returns the record above, or `404` if unknown.

---

#### `PUT /admin/forwards/:group`

Replace `devices`, `urls`, and/or `label`. Any field omitted from the body is left unchanged.

**Request:**

```json
{
  "devices": ["353456789012345"],
  "urls": ["https://reseller-alpha.traccar.com:5055", "https://backup.reseller-alpha.traccar.com:5055"]
}
```

Runs the same device-conflict check as `POST`. Devices dropped from the list have their index entries removed; devices added have new index entries written.

**Response `200`:** updated record.
**`404`** if the group does not exist.
**`409`** if any added device is already in a different group.

---

#### `DELETE /admin/forwards/:group`

Remove the group and all its `forward_device_index:*` entries.

**Response `200`:** `{ "deleted": true }`.
**`404`** if already gone.

After delete, subsequent publishes for those devices are no longer forwarded externally (internal MQTT republish is unaffected — that's driven by device membership in the group index, not by any other config).

---

### 6.6 Locked-State Activity Monitor

Per-IMEI "locked" flag (default unlocked). When a lock is **enabled**, the broker records that device's then-current position as an **anchor** — taken from the latest retained position; if the device has never reported, the next valid fix after locking becomes the anchor (`anchor.source` is `"retained"` or `"first_fix"`). Every subsequent position is checked against the anchor by great-circle (Haversine) distance. Once the device is more than `LOCK_MOVE_THRESHOLD_M` metres from the anchor (default **`250`**) — i.e. it has been driven or towed off its locked spot — a **breach cycle** opens.

**Notifications are position-driven only — there is no notification timer.** **Notification #1 fires immediately** on breach detection. **Notifications #2 / #3 fire on subsequent positions** whose `fixTime` is past the **+5 min** / **+15 min** marks since `breach_started_at` (`LOCK_NOTIFY_MARKS_MIN`, comma-separated minute list, default `5,15`). `breach_started_at` is taken from the **`fixTime`** of the position that opened the breach (not wall-clock). The 3rd (last) POST carries `"final": true`; the 1st/2nd carry `"final": false`. Total POSTs per cycle = `LOCK_NOTIFY_MARKS_MIN.length + 1` (defaults to 3).

**At most one webhook POST is emitted per ingress call.** If a single position satisfies multiple unfired marks (e.g. the device went dark for 20 min and only now reports back), the **highest applicable mark fires with `final:true`** and the subsumed lower marks are skipped — `notified` jumps to that number. `minutes_since_breach` in the body is the **actual elapsed minutes** computed from `position.fixTime - breach_started_at` (rounded), not the nominal mark. The notify counter advances even when the webhook is unreachable (1 retry, 3 s timeout), so a dead endpoint cannot wedge the cycle.

**The cleanup sweeper auto-unlocks devices via two paths** (both gated on `notified >= 1`; devices that have never breached are never auto-unlocked). The shared **5-min cleanup sweeper** (`LOCK_SWEEP_INTERVAL_MS` — also drives the §6.7 auto-lock silence-trigger pass) checks each IMEI in `locks_index`:

- **(A) Cycle complete → unconditional auto-unlock.** If `notified === LOCK_NOTIFICATION_COUNT` (i.e. POST #3 with `final:true` has fired), the sweeper calls `setLocked(false, by:'cycle-complete')` on the **next sweep regardless of activity** — wipes the `lock:<imei>` hash and removes the IMEI from `locks_index`. Effective delay 0–5 min (sweeper cadence). Rationale: the notification budget for the lock is exhausted; further movement under the current lock would be silent, so there's no operational reason to keep the lock state hanging around. **Traccar state-sync (added 2026-05-20):** all path-(A) unlocks of the tick are collated into one batched `POST ACTIVITY_LOCK_SET_WEBHOOK_URL` (`/v1/webhook/activity-lock-set`) with body `[{imei, activity_lock:false}]` — `Authorization: Bearer ${ACTIVITY_LOCK_SET_WEBHOOK_TOKEN}` (falls back to `LOCK_NOTIFY_WEBHOOK_TOKEN`), 3 s timeout, 1 retry, best-effort — so Traccar's `attributes.activity_lock` stays aligned with broker lock state. Path (B) does **not** sync Traccar.
- **(B) Partial cycle gone silent → stale auto-unlock.** If `1 <= notified < LOCK_NOTIFICATION_COUNT` AND `(now - last_position_at) >= LOCK_STALE_SILENCE_SEC` (default **300 s = 5 min**), the sweeper calls `setLocked(false, by:'stale')`. `last_position_at` is bumped on every incoming position regardless of protocol/validity, so any incoming traffic from the device resets the silence timer. Effective fire is 5–10 min after the device stops reporting.

If the device is opted into auto-lock, normal re-engagement applies after either kind of auto-unlock (next observed `ignition` on→off transition + 10 min silence → re-locks). The cleanup sweeper does **not** fire notifications. An admin can also unlock at any time via `DELETE /admin/locks/:imei` or by toggling `PUT /admin/locks/:imei {locked:false}`. **Ignition, digital inputs, the Traccar `motion` flag and engine state are irrelevant** — the only signal is physical displacement from the locked position. `valid === false` fixes and `(0, 0)` are ignored.

**Only `startek` devices are evaluated** (`LOCK_PROTOCOLS = {startek}`). A position from any other protocol never counts as "moved" and never triggers a notification — no rule ⇒ no notify. **`LOCK_NOTIFY_WEBHOOK_URL` is set and live** (`https://api.navitag.net/v1/webhook/posbroker-notify`); if it were ever unset the lock state, anchor and running distance would still be tracked (visible via `GET /admin/locks`) but no POST would be sent (logged as `notify #N skipped`).

**Webhook POST body** (`Content-Type: application/json`; optional `Authorization: Bearer ${LOCK_NOTIFY_WEBHOOK_TOKEN}`):
```json
{
  "event": "locked_device_moved",
  "imei": "865395075692234",
  "device_name": "CCM NAP 6509",
  "protocol": "startek",
  "locked_since": "2026-05-12T13:40:00.000Z",
  "breach_started_at": "2026-05-12T13:45:04.000Z",
  "minutes_since_breach": 5,
  "notification_number": 1,
  "notification_count": 3,
  "final": false,
  "anchor": { "latitude": 15.133866, "longitude": 120.639963, "at": "2026-05-12T13:38:46.000Z", "source": "retained" },
  "moved_meters": 308,
  "move_threshold_m": 250,
  "position": { "...": "the position object that tripped/refreshed the breach, verbatim from Traccar" },
  "device": { "...": "the Traccar device record" }
}
```

#### `GET /admin/locks`

List all currently-locked IMEIs and their breach-cycle state, plus the live config.

**Response `200`:**
```json
{
  "locks": [
    {
      "imei": "865395075692234",
      "locked": true,
      "locked_at": 1778594845,
      "locked_by": "admin",
      "label": "stolen — police report #1234",
      "anchor": { "latitude": 15.133866, "longitude": 120.639963, "at": 1778594826, "source": "retained" },
      "move_threshold_m": 250,
      "last_distance_m": 652,
      "breach_active": true,
      "breach_started_at": 1778594857,
      "breach_distance_m": 308,
      "notified": 1,
      "notification_count": 3,
      "cycle_complete": false,
      "last_active_at": 1778594999,
      "last_position_at": 1778594999,
      "last_notified_at": 1778595157
    }
  ],
  "notify_marks_min": [5, 15],
  "notification_count": 3,
  "stale_silence_min": 5,
  "move_threshold_m": 250,
  "protocols": ["startek"],
  "webhook_configured": false
}
```

`notify_marks_min` lists only the **delayed** marks (#2 / #3); notification #1 fires on breach detection itself and is not in the list. `notification_count` = `notify_marks_min.length + 1` is the total POSTs per cycle. `stale_silence_min` is the cleanup sweeper's silence threshold for the **partial-cycle** unlock path (B): a locked device with 1 ≤ `notified` < `notification_count` AND silent for ≥ this long is auto-unlocked. **Cycle-complete devices** (`notified === notification_count`) are unlocked unconditionally on the next sweep (path A) regardless of this value.

`last_distance_m` is the latest measured distance from the anchor (set on every startek position while locked); `breach_distance_m` is the distance at the moment the breach opened; `cycle_complete` is `true` once `notified` has reached `notification_count`.

#### `GET /admin/locks/:imei`

Lock state for one IMEI (same object shape as the entries in `GET /admin/locks`). If the IMEI has never been locked: `{ "imei": "<imei>", "locked": false }`.

#### `PUT /admin/locks/:imei`

Toggle the lock. **Body:** `{ "locked": true | false, "label"?: "..." }` (`locked` is required and must be a boolean). Setting `locked: true` (de)registers the IMEI in `locks_index` and (re)captures the anchor — re-locking always starts fresh (`notified: 0`, no breach, new anchor). Setting `locked: false` removes the IMEI from `locks_index` and deletes `lock:<imei>`, discarding any in-flight breach cycle. Passing `label` on an already-locked IMEI updates the label in place without disturbing the anchor or cycle. **Response `200`:** the same object shape as `GET /admin/locks/:imei`.

#### `POST /admin/locks/:imei`

Convenience lock — equivalent to `PUT { "locked": true }`. **Body:** `{ "label"?: "..." }` (optional; if present must be a string). On an unlocked IMEI: registers it in `locks_index`, captures the anchor (fresh cycle, `notified: 0`). On an already-locked IMEI: no re-anchor, no cycle reset; if `label` is present it's updated in place. **Response `200`:** the same object shape as `GET /admin/locks/:imei`.

#### `DELETE /admin/locks/:imei`

Convenience unlock — equivalent to `PUT { "locked": false }`. **Response `200`:** `{ "imei": "<imei>", "locked": false }`.

---

### 6.7 Auto-Lock (Parked Detection)

Per-IMEI opt-in (`auto_lock_index` SET in Redis). When an opted-in unlocked device satisfies the **parked rule**, the broker calls the same `setLocked(imei, true, {by:'auto'})` path that the manual `/admin/locks` endpoints use — from that point on the device is subject to the §6.6 breach cycle. The endpoints below only control opt-in eligibility; they never lock or unlock a device directly. To unlock a currently-locked device, use `DELETE /admin/locks/:imei`.

**Parked rule (current, deployed):** a device is parked when the broker has observed an `attributes.ignition` **on→off transition** AND `AUTOLOCK_IGN_OFF_STREAK` consecutive `ignition=false` positions (default **2**, counting the transition as the 1st) AND then stayed **silent for `AUTOLOCK_IGN_OFF_DWELL_MIN` minutes** (default **10**). Positions with `valid === false`, no `attributes.ignition` field, or non-`startek` protocol are **skipped** (no streak change). Any `ignition === true` resets the streak to 0 and arms the transition detector. An `ignition === false` advances the streak only if the immediately-preceding observation was `on` OR the streak is already ≥1; a persistently-off device (never observed `on` since opt-in or the last reset) does NOT start the streak from further `off` reports. Every advancing `off` refreshes the silence timer to wall-clock now.

The trigger fires only from a **shared 5-min sweeper** (same `setInterval` as the §6.6 breach-cleanup sweeper) — never on-ingress — because the silence condition requires the absence of subsequent positions, which only a timer can observe. Worst-case trigger delay after the rule is satisfied: ~10–15 min.

**Re-arm:** when the device is later unlocked — manually, by the sweeper's cycle-complete auto-unlock (within 5 min of POST #3, regardless of activity), or by the sweeper's stale-silence auto-unlock (~5 min after a partially-cycled device stops reporting) — the streak state machine resumes from scratch on the next valid `startek` position. No cooldown. Re-engagement still requires a fresh observed `ignition` on→off transition before the streak can start.

**Engagement webhooks (reworked 2026-05-20).** When one or more devices engage in a sweep tick, the sweeper fires **two batched POSTs** after the loop (one element per engaged device; both skipped if zero engaged). The previous dedicated `/v1/activity-lock-auto` endpoint is **no longer called** — it required Firebase ID-token auth and rejected the broker's static bearer secret with HTTP 401. The two replacements both take the shared posbroker webhook secret (`Authorization: Bearer ${LOCK_NOTIFY_WEBHOOK_TOKEN}`, 3 s timeout, 1 inline retry, best-effort, independent):

1. **FCM engagement notification** → `POST LOCK_NOTIFY_WEBHOOK_URL` (the same `posbroker-notify` pass-thru used for breach POSTs). Body: array of `[{imei, event_type:"activity_lock_engaged", title, body}]`. `title:"Activity Alert {deviceName}"`, `body:"Activity Lock has been automatically enabled for {deviceName}. Check Navitag App to view location or disable."` — `{deviceName}` is collapsed (and the result re-capitalised) when the device has no name. On success the broker stamps `last_auto_lock_notified_at`; on permanent failure it stays `null` (visible-gap reconciliation via `GET /admin/autolocks/:imei`).
2. **Traccar state-sync** → `POST ACTIVITY_LOCK_SET_WEBHOOK_URL` (`/v1/webhook/activity-lock-set`). Body: `[{imei, activity_lock:true}]` — writes Traccar `attributes.activity_lock=true` so Traccar reflects the lock immediately on engagement (the mirror of the cycle-complete `activity_lock:false` sync, §6.6).

`engagement_webhook_configured` now reflects `LOCK_NOTIFY_WEBHOOK_URL`; `traccar_sync_configured` reflects `ACTIVITY_LOCK_SET_WEBHOOK_URL`.

#### `GET /admin/autolocks`

List all opted-in IMEIs + their state, plus the broker's live auto-lock config.

**Response `200`:**
```json
{
  "autolocks": [
    {
      "imei": "865395075692234",
      "auto_lock_enabled": true,
      "enabled_at": 1778660963,
      "enabled_by": "admin",
      "label": "fleet-overnight-policy",
      "ign_off_streak": 1,
      "ign_off_streak_required": 2,
      "last_ignition": "off",
      "last_off_at": 1778594857,
      "last_position_at": 1778594890,
      "ign_off_dwell_min": 10,
      "last_auto_lock_at": null,
      "last_auto_lock_notified_at": null
    }
  ],
  "rule": "ign-off-streak+silence",
  "ign_off_streak_required": 2,
  "ign_off_dwell_min": 10,
  "sweep_interval_min": 5,
  "protocols": ["startek"],
  "rule_active": true,
  "engagement_webhook_configured": true,
  "traccar_sync_configured": true
}
```

#### `GET /admin/autolocks/:imei`

Auto-lock state for one IMEI. If the IMEI has never been opted in: `{ "imei": "<imei>", "auto_lock_enabled": false }`. Otherwise, same shape as the entries in `GET /admin/autolocks`.

#### `PUT /admin/autolocks/:imei`

Toggle opt-in. **Body:** `{ "enabled": true | false, "label"?: "..." }` (`enabled` is required and must be boolean). Enabling on a fresh IMEI registers it in `auto_lock_index` and creates `autolock:<imei>` with `enabled_at`/`enabled_by`/`label`; the next valid `startek` position then seeds `last_position_at` and starts the ignition-streak state machine. Disabling removes from `auto_lock_index` and deletes `autolock:<imei>` — but does **not** unlock a currently-locked device. Passing `label` on an already-opted-in IMEI updates the label in place without touching streak state. **Response `200`:** same object shape as `GET /admin/autolocks/:imei`.

#### `POST /admin/autolocks/:imei`

Convenience enable — equivalent to `PUT { "enabled": true }`. **Body:** `{ "label"?: "..." }` (optional; if present must be a string). **Response `200`:** same shape as `GET /admin/autolocks/:imei`.

#### `DELETE /admin/autolocks/:imei`

Convenience disable — equivalent to `PUT { "enabled": false }`. **Response `200`:** `{ "imei": "<imei>", "auto_lock_enabled": false }`.

---

### 6.8 Error Responses

| Status | Body (examples) | Cause |
|--------|-----------------|-------|
| 400 | `{"error": "devices array required (use Traccar uniqueId / IMEI values)"}` | Missing/empty `devices` on `POST /admin/permissions/:uid` |
| 400 | `{"error": "at least one of add[] or remove[] required"}` | `PATCH /admin/permissions/:uid` with an empty body or both arrays empty |
| 400 | `{"error": "subject required"}` | Missing `subject` on `POST /admin/tokens` |
| 400 | `{"error": "devices array required"}` | Missing/empty `devices` on `POST /admin/tokens` |
| 400 | `{"error": "wildcard devices not allowed"}` | `"*"` in `devices` on `POST /admin/tokens` or `POST /admin/forwards` |
| 400 | `{"error": "device uniqueIds must be non-empty strings"}` | Non-string or empty entry in `devices` |
| 400 | `{"error": "ttl_seconds or expires_at required"}` | Neither provided |
| 400 | `{"error": "ttl must be >= 60s"}` | TTL below minimum |
| 400 | `{"error": "ttl must be <= 86400s (24h)"}` | TTL above maximum |
| 400 | `{"error": "group required"}` | Missing `group` on `POST /admin/forwards` |
| 400 | `{"error": "group must match /^[a-zA-Z0-9_-]{1,64}$/"}` | Group name invalid |
| 400 | `{"error": "devices must be non-empty array"}` | Missing/empty `devices` on `POST /admin/forwards` |
| 400 | `{"error": "urls must be non-empty array"}` | Missing/empty `urls` on `POST /admin/forwards` |
| 400 | `{"error": "invalid url: ..."}` | URL not `http://` / `https://` or lacks a host |
| 401 | `{"error": "Authentication required"}` | No `Authorization` header |
| 401 | `{"error": "Invalid credentials"}` | Wrong admin username/password |
| 404 | `{"error": "not found or expired"}` | Token not found on `GET`/`DELETE /admin/tokens/:token` or `/by-hash/:hash` |
| 404 | `{"error": "not found"}` | Forwarding group not found on `GET`/`PUT`/`DELETE /admin/forwards/:group` |
| 400 | `{"error": "invalid imei"}` | IMEI on `/admin/locks/:imei` fails `/^[A-Za-z0-9_-]{1,64}$/` |
| 400 | `{"error": "body must include boolean \"locked\""}` | `PUT /admin/locks/:imei` body missing `locked` or it's not a boolean |
| 400 | `{"error": "label must be a string"}` | `PUT /admin/locks/:imei` with a non-string `label` |
| 409 | `{"error": "group <name> already exists"}` | `POST /admin/forwards` with a group name that is already in use |
| 409 | `{"error": "device <id> already in group <other>"}` | A device in the request already belongs to a different group |
| 503 | `{"error": "Admin API not configured — set ADMIN_PASS env var"}` | `ADMIN_PASS` not set in environment |

---

## 7. Traccar Server Configuration

### HTTP JSON Forwarding Setup (Production)

Traccar v6.x hard-codes the MQTT 5 client library, which Aedes does not speak. Real Traccar servers therefore forward positions to the broker over HTTPS using Traccar's built-in `forward.type=json` forwarder with a bearer token in a custom header.

Add the following to your Traccar server's `traccar.xml`:

```xml
<entry key='forward.type'>json</entry>
<entry key='forward.url'>https://posbroker.navitag.com/hooks/traccar-positions</entry>
<entry key='forward.header'>Authorization: Bearer dc85a920a30419f60ddb6bb11ca120b3a0b017ac2235699cfedde6c816e2de28</entry>
<entry key='forward.retry.enable'>true</entry>
<entry key='forward.retry.delay'>60000</entry>
```

### Endpoint

```
POST https://posbroker.navitag.com/hooks/traccar-positions
Authorization: Bearer <TRACCAR_API_KEY>
Content-Type: application/json
```

| Component | Value |
|-----------|-------|
| Method | `POST` |
| URL | `https://posbroker.navitag.com/hooks/traccar-positions` |
| Auth | `Authorization: Bearer <TRACCAR_API_KEY>` |
| Payload | Traccar standard JSON forward payload (`{ device: { uniqueId, ... }, position: { latitude, longitude, ... } }`) |
| Max body | 1 MB (`express.json({ limit: '1mb' })`) |

The request body is the standard Traccar JSON forward payload — the broker only requires `device.uniqueId` and `position` to be present. Responses:

| Status | Body | Meaning |
|--------|------|---------|
| 200 | `{"ok": true}` | Position accepted, published to `devices/<uniqueId>/pos`, OsmAnd forward fired if configured |
| 400 | `{"error": "payload must include device.uniqueId and position"}` | Missing required fields |
| 400 | `{"error": "invalid JSON"}` | Body parser rejected the payload |
| 401 | `{"error": "unauthorized"}` | Missing or wrong bearer token |
| 413 | `{"error": "payload too large"}` | Body exceeded 1 MB limit |
| 500 | `{"error": "server misconfigured"}` | `TRACCAR_API_KEY` not set on the broker — ops issue, not a client issue |

### Configuration Keys Reference

| Key | Value | Description |
|-----|-------|-------------|
| `forward.type` | `json` | Forward as HTTP JSON POST |
| `forward.url` | `https://posbroker.navitag.com/hooks/traccar-positions` | Broker ingress endpoint. Setting this key is what activates forwarding — there is no separate `forward.enable` key in current Traccar. |
| `forward.header` | `Authorization: Bearer <TRACCAR_API_KEY>` | Bearer token header. Must exactly match the broker's `TRACCAR_API_KEY` env var. |
| `forward.retry.enable` | `true` | Retry on delivery failure (non-2xx or connection error) |
| `forward.retry.delay` | `60000` | Initial retry delay in **milliseconds**. Doubles on each subsequent failure (exponential backoff). Traccar default: `100`. |
| `forward.retry.count` | *(default `10`)* | Max retry attempts before the position is dropped. |
| `forward.retry.limit` | *(default `100`)* | Max queued positions awaiting retry. Additional positions are **discarded** once this limit is reached. |

### Important Notes

- **`uniqueId` is critical:** The broker uses `device.uniqueId` from the forwarded payload to create per-device topics. Ensure each device in Traccar has a unique `uniqueId` (IMEI, serial number, or other globally unique identifier).
- **Multiple Traccar servers:** You can connect any number of Traccar servers to the same broker. Since topics are keyed by `uniqueId` (not Traccar's internal `deviceId`), there are no collisions.
- **Idempotency:** Traccar retries on non-2xx or connection error. Duplicate POSTs of the same position are harmless — retained last-writer-wins makes the publish idempotent.
- **Restart required:** After modifying `traccar.xml`, restart the Traccar server for changes to take effect.
- **Firewall:** Ensure the Traccar server can reach `posbroker.navitag.com` on port 443 (HTTPS).

### Verifying the Connection

After configuring, trigger a position from a device (or via Traccar's OsmAnd simulator on `:5055`) and check the broker logs:

```bash
docker logs navitag-stack-aedes-1 --tail 20
```

Look for one line per forwarded position: `[ingress] http uniqueId=<id> lat=<lat> lon=<lon>`

To confirm the retained last-known position is stored:

```bash
docker exec navitag-stack-redis-1 redis-cli -n 1 HEXISTS retained 'devices/<uniqueId>/pos'
# → (integer) 1
```

### Legacy MQTT Forwarding (MQTT 3.1.1 clients only)

> **DEPRECATED for real Traccar v6.x servers.** The MQTT ingress path below only works for MQTT 3.1.1 telematics sources (custom forks, test harnesses, third-party trackers). Stock Traccar v6.x clients will fail to connect with `Mqtt5ConnAckReasonCode: 0x81` because Aedes does not implement MQTT 5. Use the HTTP JSON path above for any stock Traccar server.

```xml
<!-- MQTTS — port 8883, MQTT 3.1.1 only -->
<entry key='forward.type'>mqtt</entry>
<entry key='forward.url'>mqtts://traccar:dc85a920a30419f60ddb6bb11ca120b3a0b017ac2235699cfedde6c816e2de28@posbroker.navitag.com:8883</entry>
<entry key='forward.topic'>traccar/positions</entry>
<entry key='forward.retry.enable'>true</entry>
<entry key='forward.retry.delay'>60000</entry>
```

MQTT username `traccar`, password is `TRACCAR_API_KEY`. The broker's MQTT publish handler delegates to the same `processTraccarPosition()` function as the HTTP ingress — retained-message behavior and OsmAnd forwarding are identical on both paths.

---

## 8. Frontend WebSocket Client

Frontend clients connect to the broker over WebSockets using the MQTT protocol. Authentication is either a Firebase ID token (for logged-in users) or a share-link token (for share URL recipients). **No manual subscription is ever needed** — the broker auto-subscribes the client based on its scope and immediately delivers retained last-known positions.

### 8.1 Logged-in User (Firebase)

```javascript
import mqtt from 'mqtt'
import { auth } from './firebase-config'

async function connectToBroker() {
  const firebaseUser = auth.currentUser
  if (!firebaseUser) throw new Error('Not signed in')

  const idToken = await firebaseUser.getIdToken()

  const client = mqtt.connect('wss://posbroker.navitag.com', {
    username: firebaseUser.uid,
    password: idToken,
  })

  client.on('connect', () => {
    console.log('Connected — waiting for auto-subscribed positions...')
  })

  client.on('message', (topic, message) => {
    const data = JSON.parse(message.toString())
    console.log('Position update:', {
      uniqueId: data.device.uniqueId,
      name: data.device.name,
      lat: data.position.latitude,
      lng: data.position.longitude,
      speed: data.position.speed,
      time: data.position.fixTime,
    })
  })

  client.on('error', (err) => {
    console.error('MQTT error:', err.message)
  })

  return client
}
```

**Token refresh.** Firebase ID tokens expire after 1 hour. If the broker disconnects due to an expired token, the client should fetch a fresh token via `getIdToken(true)` and reconnect.

### 8.2 Vue 3 Composable (Firebase)

```typescript
// composables/useTracking.ts
import { ref, onUnmounted } from 'vue'
import mqtt from 'mqtt'
import { auth } from '~/lib/firebase'

interface DevicePosition {
  uniqueId: string
  name: string
  latitude: number
  longitude: number
  speed: number
  course: number
  fixTime: string
  attributes: Record<string, any>
}

export function useTracking() {
  const positions = ref<Map<string, DevicePosition>>(new Map())
  const connected = ref(false)
  let client: mqtt.MqttClient | null = null

  async function connect() {
    const user = auth.currentUser
    if (!user) throw new Error('Not signed in')

    const token = await user.getIdToken()

    client = mqtt.connect('wss://posbroker.navitag.com', {
      username: user.uid,
      password: token,
    })

    client.on('connect', () => { connected.value = true })

    client.on('message', (_topic, message) => {
      const data = JSON.parse(message.toString())
      positions.value.set(data.device.uniqueId, {
        uniqueId: data.device.uniqueId,
        name: data.device.name,
        latitude: data.position.latitude,
        longitude: data.position.longitude,
        speed: data.position.speed,
        course: data.position.course,
        fixTime: data.position.fixTime,
        attributes: data.position.attributes || {},
      })
    })

    client.on('close', () => { connected.value = false })
  }

  function disconnect() {
    client?.end()
    client = null
    connected.value = false
  }

  onUnmounted(disconnect)

  return { positions, connected, connect, disconnect }
}
```

### 8.3 Share-Link Recipient (Token)

A share URL page extracts the `nvtk_...` token from its path and uses it as the MQTT password with username `token`. Recommend `reconnectPeriod: 0` so an invalid-token error does not loop — the page should show a clear "link invalid or expired" UI instead.

```javascript
import mqtt from 'mqtt'

function connectWithShareToken(token) {
  const client = mqtt.connect('wss://posbroker.navitag.com', {
    username: 'token',
    password: token,        // "nvtk_..."
    reconnectPeriod: 0,     // don't auto-retry on auth failure
  })

  client.on('connect', () => {
    console.log('Connected — retained positions will arrive shortly.')
    // Broker auto-subscribes to the device(s) scoped to this token.
  })

  client.on('message', (topic, message) => {
    const data = JSON.parse(message.toString())
    // render position on map
  })

  client.on('error', (err) => {
    if (err.message === 'Token invalid') {
      showExpiredLinkUI()
    } else {
      console.error('MQTT error:', err.message)
    }
  })

  client.on('close', () => {
    // Broker force-closes token clients at expiry or on admin revocation.
    // A reconnect attempt will surface "Token invalid" via the error handler.
  })

  return client
}
```

**Recommendations for share-link pages:**

- Put the token in a **path segment** (`/share/nvtk_...`), not a query string — keeps it out of referrer headers and many web-log formats.
- Add `<meta name="referrer" content="no-referrer">` to the page so outbound links don't leak the URL.
- Treat `Token invalid` as a terminal state for the session: show an expiry/invalid message, do not auto-retry.

---

## 9. Error Reference

### MQTT Connection Errors

| Error Message | Return Code | Cause |
|---------------|-------------|-------|
| `Auth failed` | 4 | Generic fallback — invalid Firebase token, wrong Traccar API key, malformed password, or Firebase SDK threw during verification |
| `Token invalid` | 4 | Share-link token not found, past expiry, or has an invalid scope (server logs the specific reason; client sees a single message by design) |

### MQTT Subscribe Errors

| Error Message | Cause |
|---------------|-------|
| `Invalid topic` | Topic doesn't match `devices/{uniqueId}/pos` exactly (e.g., `+`/`#` wildcards attempted by a token client) |
| `Not authorized for this device` | Firebase UID lacks permission for that `uniqueId`, or the `uniqueId` is not in the token's scope |

### MQTT Publish Errors

| Error Message | Cause |
|---------------|-------|
| `Publish not allowed` | Non-Traccar client attempted to publish |

### Admin API Errors

See [§6.6 Error Responses](#66-error-responses) for the full table.
