import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Geofence name replaces the address (README "Project Status"):
//   owned  -> Traccar geofenceIds, filtered to the caller's geofences
//   shared -> point-in-polygon on the caller's own geofences
// Synthetic fixtures. The owner's account has geofences 101/102; the sharee
// has its own copy of "Depot" (201) over the same area. Traccar reports the
// owner's ids on positions, also to the sharee.

const send = vi.fn();
vi.mock('@/utils/http', () => ({
  request: { send: (...a) => send(...a) },
  RECONNECT_TIMEOUT_MS: 30000,
  CONNECT_TIMEOUT_MS: 15000,
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/stores/user.js', () => ({ useUserStore: () => ({ idToken: 'tok' }) }));

import { useDevicesStore } from './devices.js';

// Traccar WKT is "lat lon".
const DEPOT = 'POLYGON ((10.000 120.000, 10.000 120.010, 10.010 120.010, 10.010 120.000, 10.000 120.000))';
const YARD  = 'POLYGON ((10.100 120.100, 10.100 120.110, 10.110 120.110, 10.110 120.100, 10.100 120.100))';

const OWNER_GEOFENCES  = [{ id: 101, name: 'Depot', area: DEPOT }, { id: 102, name: 'Yard', area: YARD }];
const SHAREE_GEOFENCES = [{ id: 201, name: 'Depot', area: DEPOT }];

// Unit A inside Depot; Traccar reports the owner's id 101.
const POS_A = { deviceId: 1, latitude: 10.005, longitude: 120.005, geofenceIds: [101], address: 'Inside Street', serverTime: '2026-11-07T01:00:00Z', attributes: {} };
// Unit B outside every geofence.
const POS_B = { deviceId: 2, latitude: 10.500, longitude: 120.500, geofenceIds: null, address: 'Outside Road', serverTime: '2026-11-07T01:00:00Z', attributes: {} };

async function storeWith(geofences, shared) {
  setActivePinia(createPinia());
  const store = useDevicesStore();
  send.mockReset();
  send.mockResolvedValueOnce(geofences);
  await store.fetchGeofences();
  store.devices[1] = { id: 1, name: 'A', shared };
  store.devices[2] = { id: 2, name: 'B', shared };
  store.processSocketData({ positions: [POS_A, POS_B] });
  return store;
}

describe('location label', () => {
  beforeEach(() => vi.useRealTimers());

  it('owner: geofence name from Traccar geofenceIds, address outside', async () => {
    const store = await storeWith(OWNER_GEOFENCES, false);
    expect(store.locationLabels[1]).toBe('Depot');
    expect(store.locationLabels[2]).toBe('Outside Road');
  });

  it('sharee with own geofence: point-in-polygon finds it', async () => {
    const store = await storeWith(SHAREE_GEOFENCES, true);
    expect(store.locationLabels[1]).toBe('Depot');
    expect(store.locationLabels[2]).toBe('Outside Road');
  });

  it('sharee without geofences: address, never the owner geofence', async () => {
    const store = await storeWith([], true);
    expect(store.locationLabels[1]).toBe('Inside Street');
  });

  it('sharee: geofenceIds are never used, only the polygon test', async () => {
    // Id 201 is in the sharee's list, but the position is outside its polygon.
    const store = await storeWith(SHAREE_GEOFENCES, true);
    store.processSocketData({ positions: [{ ...POS_B, geofenceIds: [201] }] });
    expect(store.locationLabels[2]).toBe('Outside Road');
  });

  it('owned device: an id not in the caller list falls back to the address', async () => {
    const store = await storeWith(SHAREE_GEOFENCES, false);
    expect(store.locationLabels[1]).toBe('Inside Street');
  });

  it('label updates when geofences load after the position', async () => {
    const store = await storeWith([], true);
    expect(store.locationLabels[1]).toBe('Inside Street');
    send.mockResolvedValueOnce(SHAREE_GEOFENCES);
    await store.fetchGeofences();
    expect(store.locationLabels[1]).toBe('Depot');
  });
});
