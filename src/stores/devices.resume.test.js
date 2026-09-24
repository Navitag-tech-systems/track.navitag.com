import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

// Resume / offline fix (README "Project Status"): marker data survives a
// reconnect, colours derive from one rule, rows merge on refetch, and a warm
// fetchAll never raises the splash gate.

const send = vi.fn();
vi.mock('@/utils/http', () => ({
  request: { send: (...a) => send(...a) },
  RECONNECT_TIMEOUT_MS: 30000,
  CONNECT_TIMEOUT_MS: 15000,
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/stores/user.js', () => ({ useUserStore: () => ({ idToken: 'tok' }) }));

import { useDevicesStore, markerColor, MARKER_ALARM, MARKER_ONLINE, MARKER_OFFLINE } from './devices.js';

const T0 = new Date('2026-09-24T10:00:00Z').getTime();
const iso = (ms) => new Date(ms).toISOString();

function position(deviceId, ms, extra = {}) {
  return {
    deviceId,
    latitude: 14.5 + deviceId, longitude: 121, course: 90, speed: 10,
    serverTime: iso(ms), fixTime: iso(ms), address: `addr ${deviceId}`,
    attributes: { ignition: false, ...extra },
  };
}

describe('markerColor', () => {
  it('alarm beats online beats offline', () => {
    const fresh = { status: 'online', lastSeenMs: T0 };
    expect(markerColor({ ...fresh, alarm: 'sos' }, T0)).toBe(MARKER_ALARM);
    expect(markerColor(fresh, T0)).toBe(MARKER_ONLINE);
    expect(markerColor({ status: 'offline', lastSeenMs: T0 }, T0)).toBe(MARKER_OFFLINE);
  });

  it('online is recency-gated, ignition is irrelevant', () => {
    const d = { status: 'online', lastSeenMs: T0, ignition: false };
    expect(markerColor(d, T0 + 4 * 60 * 1000)).toBe(MARKER_ONLINE);
    expect(markerColor(d, T0 + 6 * 60 * 1000)).toBe(MARKER_OFFLINE);
  });
});

describe('devices store on reconnect', () => {
  let store;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    setActivePinia(createPinia());
    store = useDevicesStore();
    send.mockReset();
    store.devices[1] = { id: 1, name: 'A', category: 'car', status: 'online', lastSeenMs: T0 };
  });
  afterEach(() => vi.useRealTimers());

  it('writes every position into deviceMarkers, not only the first', () => {
    store.processSocketData({ positions: [position(1, T0)] });
    const first = store.deviceMarkers[1];
    expect(first.latlon).toEqual([15.5, 121]);
    expect(first.color).toBe(MARKER_ONLINE);

    store.processSocketData({ positions: [{ ...position(1, T0 + 1000), latitude: 16, course: 45 }] });
    const second = store.deviceMarkers[1];
    expect(second).not.toBe(first);            // replaced, not mutated
    expect(second.latlon).toEqual([16, 121]);
    expect(second.bearing).toBe(45);
  });

  it('turns red on an alarm and clears on the next normal position', () => {
    store.processSocketData({ positions: [position(1, T0, { alarm: 'sos' })] });
    expect(store.deviceMarkers[1].color).toBe(MARKER_ALARM);
    store.processSocketData({ positions: [position(1, T0 + 1000)] });
    expect(store.deviceMarkers[1].color).toBe(MARKER_ONLINE);
  });

  it('recolours on a status-only devices frame', () => {
    store.processSocketData({ positions: [position(1, T0)] });
    store.processSocketData({ devices: [{ id: 1, status: 'offline', lastUpdate: iso(T0) }] });
    expect(store.deviceMarkers[1].color).toBe(MARKER_OFFLINE);
  });

  it('greys out a silent device on the 60 s tick without a socket message', async () => {
    store.processSocketData({ positions: [position(1, T0)] });
    const before = store.deviceMarkers[1];
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    await nextTick();
    expect(store.deviceMarkers[1]).not.toBe(before);
    expect(store.deviceMarkers[1].color).toBe(MARKER_OFFLINE);
    expect(store.deviceMarkers[1].latlon).toEqual(before.latlon);
  });

  it('fetchDevices merges into the existing row and keeps live fields', async () => {
    store.processSocketData({ positions: [position(1, T0 + 5000)] });
    send.mockImplementation(async ({ url }) => {
      if (url.endsWith('/device/list')) {
        return { devices: [{ id: 1, name: 'A renamed', category: 'car', status: 'online', lastUpdate: iso(T0) }] };
      }
      if (url.endsWith('/user/device-expiration')) return { status: 'success', devices: [] };
      throw new Error(`unexpected ${url}`);
    });
    await store.fetchDevices();
    const row = store.devices[1];
    expect(row.name).toBe('A renamed');
    expect(row.address).toBe('addr 1');           // survived the refetch
    expect(row.latlon).toEqual([15.5, 121]);
    expect(row.lastSeenMs).toBe(T0 + 5000);         // not rewound to lastUpdate
    expect(row.shared).toBe(false);
  });

  it('warm fetchAll leaves `loading` down; cold raises it', async () => {
    send.mockImplementation(async ({ url }) => {
      if (url.endsWith('/device/list')) return { devices: [{ id: 1, name: 'A', lastUpdate: iso(T0) }] };
      if (url.endsWith('/user/device-expiration')) return { status: 'success', devices: [] };
      if (url.endsWith('/geofence')) return [];
      if (url.endsWith('/share/tome')) return { shared_devices: [] };
      throw new Error(`unexpected ${url}`);
    });

    const seen = [];
    const warm = store.fetchAll({ warm: true });
    seen.push(store.loading);
    expect(await warm).toBe(true);
    expect(seen).toEqual([false]);
    expect(store.loading).toBe(false);

    const cold = store.fetchAll();
    expect(store.loading).toBe(true);
    expect(await cold).toBe(true);
    expect(store.loading).toBe(true);              // released by the first frame
    store.processSocketData({ positions: [position(1, T0)] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.loading).toBe(false);
  });

  it('applies the reconnect timeout to every fetchAll request', async () => {
    send.mockImplementation(async ({ url }) => {
      if (url.endsWith('/device/list')) return { devices: [] };
      if (url.endsWith('/user/device-expiration')) return { status: 'success', devices: [] };
      if (url.endsWith('/geofence')) return [];
      if (url.endsWith('/share/tome')) return { shared_devices: [] };
    });
    await store.fetchAll({ warm: true });
    expect(send).toHaveBeenCalledTimes(4);
    for (const [opts] of send.mock.calls) expect(opts.timeout).toBe(30000);
  });
});
