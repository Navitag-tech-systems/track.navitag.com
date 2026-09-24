import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Web path of the self-location store: enable → one fix then a watch; the
// marker shape the map consumes; suspend/resume drop and re-arm the watch;
// a denied permission surfaces as a toast and leaves the toggle off.

const toastShow = vi.fn();
vi.mock('@/stores/toast.js', () => ({ useToastStore: () => ({ show: toastShow }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: {} }));

import { useUserLocationStore, SELF_MARKER_ID } from './userLocation.js';

const fix = (lat, lng, heading = null) => ({ coords: { latitude: lat, longitude: lng, accuracy: 5, heading } });

describe('userLocation (web)', () => {
  let geo, store, watchCb, watchErr;

  beforeEach(() => {
    setActivePinia(createPinia());
    toastShow.mockReset();
    watchCb = null; watchErr = null;
    geo = {
      getCurrentPosition: vi.fn((ok) => ok(fix(14.5, 121))),
      watchPosition: vi.fn((ok, err) => { watchCb = ok; watchErr = err; return 7; }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    store = useUserLocationStore();
  });
  afterEach(() => { delete navigator.geolocation; });

  it('starts off, never persisted', () => {
    expect(store.enabled).toBe(false);
    expect(store.marker).toBeNull();
  });

  it('enable: immediate fix, then a watch; marker has the map shape', async () => {
    await store.enable();
    expect(store.enabled).toBe(true);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(store.marker).toEqual({
      id: SELF_MARKER_ID, latlon: [14.5, 121], bearing: 0, color: '#0076f5', label: 'Me', type: 'circle',
    });

    watchCb(fix(14.6, 121.1, 270));
    expect(store.marker.latlon).toEqual([14.6, 121.1]);
    expect(store.marker.bearing).toBe(270);
  });

  it('suspend drops the watch but keeps the toggle and last position; resume re-arms', async () => {
    await store.enable();
    store.suspend();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(store.enabled).toBe(true);
    expect(store.marker.latlon).toEqual([14.5, 121]);

    await store.resumeFromBackground();
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  });

  it('disable clears the watch and the marker', async () => {
    await store.enable();
    store.disable();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(store.enabled).toBe(false);
    expect(store.marker).toBeNull();
    expect(store.position).toBeNull();
  });

  it('denied permission: toast with the settings hint, toggle stays off', async () => {
    geo.getCurrentPosition = vi.fn((_ok, err) => err({ code: 1, message: 'User denied Geolocation' }));
    await store.enable();
    expect(store.enabled).toBe(false);
    expect(toastShow).toHaveBeenCalledWith(expect.stringMatching(/permission is off/i), { variant: 'error' });
  });

  it('a watch error mid-session turns the feature off', async () => {
    await store.enable();
    watchErr({ code: 2, message: 'Position unavailable' });
    expect(store.enabled).toBe(false);
    expect(toastShow).toHaveBeenCalledWith('Could not get your location.', { variant: 'error' });
  });

  it('ignores a fix without finite coordinates', async () => {
    await store.enable();
    watchCb({ coords: { latitude: NaN, longitude: 121 } });
    expect(store.marker.latlon).toEqual([14.5, 121]);
  });
});
