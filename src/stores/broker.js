// Posbroker (MQTT 3.1.1 over WSS) client store.
//
// Lives at wss://posbroker.navitag.com. The transport is a plain browser
// WebSocket with subprotocol "mqtt"; the application layer is hand-rolled
// MQTT 3.1.1 (no dependency). See "posbroker API docs.md" for the auth
// contract — username = Firebase uid, password = Firebase ID token.
//
// Resilience model:
//   - Intentional teardowns (logout, lifecycle.stopSession, the outer
//     reloadAndReconnect path) call disconnect(), which nulls the WS
//     listeners *before* close() so the onclose-driven reconnect never
//     fires.
//   - Unintentional drops (network blip, broker restart) hit onclose with
//     listeners still attached → schedule a 5s reconnect that first calls
//     userStore.getFreshToken() so the next CONNECT carries a current
//     Firebase ID token (the token is the MQTT password, not a per-frame
//     bearer, so stale-on-reconnect = CONNACK code 5).
//   - CONNACK refusal codes 4/5 (auth) get a single refresh-and-retry. A
//     second auth refusal stops the loop — the user will need to log out
//     and back in, or the outer session.js paths will eventually retrigger
//     a fresh connect.
//   - userStore.internet is honored — same gate Traccar's reconnect uses.
//
// Why hand-rolled instead of `mqtt` / `mqtt-packet`:
//   - the `mqtt` package adds ~150 KB gzipped of code we mostly don't use
//     (publish, QoS 1/2 ack tracking, will messages, subscription manager —
//     the broker auto-subscribes us, so we never call subscribe()).
//   - `mqtt-packet` 9.x is a Node CJS module that depends on `bl`,
//     `process-nextick-args`, and `debug` — the Buffer polyfill chain
//     alone wipes out the bundle saving and adds Vite config drag.
//   - the surface we actually need is tiny: encode CONNECT, parse CONNACK
//     and PUBLISH, send PINGREQ on a timer, encode DISCONNECT. ~80 lines
//     of codec we own and can read.

import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';

const BROKER_URL = 'wss://posbroker.navitag.com';
const KEEPALIVE_SEC = 30;
const PING_INTERVAL_MS = (KEEPALIVE_SEC - 5) * 1000; // send PINGREQ a bit before the broker's idle cut-off
const RECONNECT_DELAY_MS = 500;                      // matches Traccar's session.handleSocketDisconnect cadence

const PKT = {
  CONNECT:     1,
  CONNACK:     2,
  PUBLISH:     3,
  PINGREQ:     12,
  PINGRESP:    13,
  DISCONNECT:  14,
};

const CONNACK_REASON = {
  0: 'accepted',
  1: 'unacceptable protocol version',
  2: 'identifier rejected',
  3: 'server unavailable',
  4: 'bad username or password',
  5: 'not authorized',
};

// --- Codec helpers (MQTT 3.1.1, Uint8Array only — no Buffer polyfill) ---

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Variable-length "remaining length" — 1-4 bytes, 7 data bits + continuation.
function encodeRemainingLength(length) {
  const bytes = [];
  do {
    let b = length & 0x7F;
    length >>>= 7;
    if (length > 0) b |= 0x80;
    bytes.push(b);
  } while (length > 0);
  return bytes;
}

// 2-byte big-endian length prefix + UTF-8 bytes.
function encodeUtf8String(str) {
  const utf8 = textEncoder.encode(str);
  const out = new Uint8Array(2 + utf8.length);
  out[0] = (utf8.length >> 8) & 0xFF;
  out[1] = utf8.length & 0xFF;
  out.set(utf8, 2);
  return out;
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function buildConnectPacket({ clientId, username, password, keepAlive }) {
  const protoName = encodeUtf8String('MQTT'); // 6 bytes (2 len + 4 chars)
  let flags = 0x02;                            // clean session
  if (username) flags |= 0x80;
  if (password) flags |= 0x40;
  const variableHeader = new Uint8Array([
    ...protoName,
    4,                                         // protocol level = MQTT 3.1.1
    flags,
    (keepAlive >> 8) & 0xFF,
    keepAlive & 0xFF,
  ]);
  const cidBytes = encodeUtf8String(clientId ?? '');
  const uBytes = username ? encodeUtf8String(username) : new Uint8Array(0);
  const pBytes = password ? encodeUtf8String(password) : new Uint8Array(0);
  const payload = concat([cidBytes, uBytes, pBytes]);
  const remLen = variableHeader.length + payload.length;
  return concat([
    Uint8Array.from([0x10, ...encodeRemainingLength(remLen)]), // CONNECT fixed header
    variableHeader,
    payload,
  ]);
}

const PINGREQ_BYTES    = Uint8Array.from([0xC0, 0x00]);
const DISCONNECT_BYTES = Uint8Array.from([0xE0, 0x00]);

// Streaming frame parser — a single WS message may contain multiple MQTT
// packets, or a partial one that completes on the next message.
class FrameDecoder {
  constructor() { this.buf = new Uint8Array(0); }

  reset() { this.buf = new Uint8Array(0); }

  feed(bytes) {
    const merged = new Uint8Array(this.buf.length + bytes.length);
    merged.set(this.buf, 0);
    merged.set(bytes, this.buf.length);
    this.buf = merged;

    const out = [];
    while (true) {
      const pkt = this._tryParseOne();
      if (!pkt) break;
      out.push(pkt);
    }
    return out;
  }

  _tryParseOne() {
    if (this.buf.length < 2) return null;
    const fixedHeader = this.buf[0];
    const type  = (fixedHeader >> 4) & 0x0F;
    const flags = fixedHeader & 0x0F;

    let remLen = 0, multiplier = 1, varintBytes = 0, off = 1;
    while (true) {
      if (off >= this.buf.length) return null; // need more bytes
      const b = this.buf[off];
      remLen += (b & 0x7F) * multiplier;
      varintBytes++;
      off++;
      if ((b & 0x80) === 0) break;
      multiplier *= 128;
      if (varintBytes >= 4) throw new Error('Malformed MQTT remaining-length varint');
    }

    const totalLength = off + remLen;
    if (this.buf.length < totalLength) return null;

    const body = this.buf.slice(off, totalLength);
    this.buf = this.buf.slice(totalLength);
    return { type, flags, body };
  }
}

function decodePublishBody(body, qos) {
  const topicLen = (body[0] << 8) | body[1];
  const topic = textDecoder.decode(body.slice(2, 2 + topicLen));
  let off = 2 + topicLen;
  if (qos > 0) off += 2; // skip packet identifier (QoS 1/2 only)
  const payload = body.slice(off);
  return { topic, payload };
}

// --- Pinia store ---

export const useBrokerStore = defineStore('broker', () => {
  const connected = ref(false);          // CONNACK accepted, ready for messages
  const lastError = ref(null);           // user-friendly last failure
  const socket    = shallowRef(null);    // raw WebSocket; shallow so Pinia doesn't deep-proxy it
  const decoder   = new FrameDecoder();
  let keepaliveTimer    = null;
  let reconnectTimer    = null;
  let lastConnackRefusal = null;         // set in onmessage right before close(); read by onclose to classify the drop
  let authRetryAttempted = false;        // true once we've done the single refresh-and-retry for an auth refusal

  function _stopKeepalive() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  function _clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function _scheduleReconnect(reason) {
    if (reconnectTimer) return;          // already armed
    console.log('[Broker] reconnect in ' + RECONNECT_DELAY_MS + 'ms — ' + reason);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      const userStore = useUserStore();
      if (!userStore.isLoggedIn || !userStore.internet) {
        console.log('[Broker] reconnect aborted — logged out or offline');
        return;
      }
      // Defer while the page is hidden — the WS handshake + CONNECT under
      // a throttled tab tends to either fail or eat the once-only auth
      // refresh budget for nothing. The appStateChange foreground handler
      // will self-heal when the page wakes up.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        console.log('[Broker] reconnect deferred — page hidden, foreground will self-heal');
        return;
      }
      // Force-refresh before reconnect. The Firebase ID token is the MQTT
      // CONNECT password, set once per session. ~1h after CONNACK accepted
      // it goes stale; reusing the cached one would land us in CONNACK 5.
      await userStore.getFreshToken();
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function _onPacket(pkt) {
    if (pkt.type === PKT.CONNACK) {
      const returnCode = pkt.body[1];
      if (returnCode === 0) {
        connected.value = true;
        authRetryAttempted = false;      // good auth — release the once-only retry budget
        lastConnackRefusal = null;
        console.log('[Broker] CONNACK accepted');
        keepaliveTimer = setInterval(() => {
          if (socket.value?.readyState === WebSocket.OPEN) {
            socket.value.send(PINGREQ_BYTES);
          }
        }, PING_INTERVAL_MS);
      } else {
        // Stash the code synchronously so onclose (which fires next) can
        // route this as an auth failure vs. a generic drop.
        lastConnackRefusal = returnCode;
        lastError.value = 'CONNACK refused: ' + (CONNACK_REASON[returnCode] ?? 'code ' + returnCode);
        console.warn('[Broker]', lastError.value);
        try { socket.value?.close(); } catch {}
      }
      return;
    }

    if (pkt.type === PKT.PUBLISH) {
      const qos = (pkt.flags >> 1) & 0x03;
      const { topic, payload } = decodePublishBody(pkt.body, qos);
      _onPublish(topic, payload);
      return;
    }

    if (pkt.type === PKT.PINGRESP) return; // expected
    // We don't publish or manually subscribe, so we shouldn't see SUBACK /
    // PUBACK / etc. Log and ignore if we do.
    console.log('[Broker] unhandled packet type', pkt.type);
  }

  function _onPublish(topic, payload) {
    let json;
    try {
      json = JSON.parse(textDecoder.decode(payload));
    } catch (err) {
      console.warn('[Broker] bad JSON payload on', topic, err?.message || err);
      return;
    }
    if (!json.device || !json.position) {
      console.warn('[Broker] payload missing device or position keys on', topic);
      return;
    }
    // Reuse the Traccar socket handler. The broker payload shape is
    // identical (one device + one position). processSocketData() uses
    // Object.assign on the device row, so Phase 1's `shared:true` and
    // `scopes` survive every position update.
    const deviceStore = useDevicesStore();
    deviceStore.processSocketData({
      devices:   [json.device],
      positions: [json.position],
    });
  }

  function connect() {
    if (socket.value) {
      console.warn('[Broker] connect() ignored — socket already exists');
      return;
    }
    const userStore = useUserStore();
    const uid = userStore.user?.uid;
    const idToken = userStore.idToken;
    if (!uid || !idToken) {
      lastError.value = 'Missing Firebase uid or idToken';
      console.warn('[Broker]', lastError.value);
      return;
    }

    lastError.value = null;
    decoder.reset();

    const ws = new WebSocket(BROKER_URL, ['mqtt']);
    ws.binaryType = 'arraybuffer';
    socket.value = ws;

    // Property-style listeners (mirrors userStore.connectSocket) so a
    // deliberate disconnect() can null them out *before* close(), keeping
    // intentional teardowns out of any future reconnect-on-drop path.
    ws.onopen = () => {
      console.log('[Broker] WS open, sending CONNECT');
      try {
        const packet = buildConnectPacket({
          clientId: 'navitag-track-' + Math.random().toString(36).slice(2, 10),
          username: uid,
          password: idToken,
          keepAlive: KEEPALIVE_SEC,
        });
        ws.send(packet);
      } catch (err) {
        lastError.value = 'Failed to send CONNECT: ' + (err?.message || err);
        try { ws.close(); } catch {}
      }
    };

    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) {
        // Shouldn't happen since binaryType is 'arraybuffer', but ignore
        // string frames defensively.
        return;
      }
      const bytes = new Uint8Array(ev.data);
      let packets;
      try {
        packets = decoder.feed(bytes);
      } catch (err) {
        lastError.value = 'Decode error: ' + (err?.message || err);
        try { ws.close(); } catch {}
        return;
      }
      for (const p of packets) _onPacket(p);
    };

    ws.onerror = () => {
      // The browser intentionally hides WebSocket error details for security.
      console.warn('[Broker] WS error event');
    };

    ws.onclose = (ev) => {
      console.log('[Broker] WS close code=' + ev.code + ' reason=' + (ev.reason || '-'));
      _stopKeepalive();
      connected.value = false;
      socket.value = null;

      // Classify the drop based on whether we saw a CONNACK refusal first.
      // Read-and-clear so a later natural drop doesn't get mis-classified.
      const refusal = lastConnackRefusal;
      lastConnackRefusal = null;

      const userStore = useUserStore();
      if (!userStore.isLoggedIn || !userStore.internet) {
        console.log('[Broker] not reconnecting — logged out or offline');
        return;
      }

      if (refusal === 4 || refusal === 5) {
        // Bad credentials / not authorized. Token may just be stale — the
        // scheduled reconnect always force-refreshes before CONNECT. But
        // only spend one retry on this; a second auth refusal means the
        // problem isn't the token, so stop until the outer session paths
        // re-trigger us.
        if (authRetryAttempted) {
          console.warn('[Broker] auth refused again after token refresh — stopping');
          return;
        }
        authRetryAttempted = true;
        _scheduleReconnect('auth refused (code ' + refusal + ') — retrying once with fresh token');
        return;
      }

      // Anything else: network blip, broker bounce, transient protocol
      // refusal (codes 1/2/3). Same 5s cadence Traccar uses.
      _scheduleReconnect('connection dropped');
    };
  }

  function disconnect() {
    // Cancel any pending reconnect first — if onclose previously armed one
    // and the outer session.js is now driving a deliberate disconnect +
    // reconnect, the leftover timer would race with the new connect() and
    // double up.
    _clearReconnect();
    authRetryAttempted = false;
    lastConnackRefusal = null;

    const ws = socket.value;
    if (!ws) return;

    // Detach close/error so the deliberate close below isn't picked up by
    // the reconnect-on-drop handler. open/message are also cleared so any
    // frames buffered in-flight after this point are dropped.
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;

    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(DISCONNECT_BYTES);
      }
    } catch {}
    try { ws.close(); } catch {}

    // Listeners are gone, so do the cleanup the onclose handler would have
    // done.
    _stopKeepalive();
    connected.value = false;
    socket.value = null;
  }

  return { connected, lastError, socket, connect, disconnect };
});
