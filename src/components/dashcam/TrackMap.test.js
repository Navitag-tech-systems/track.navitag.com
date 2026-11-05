import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import L from 'leaflet';

const layers = vi.hoisted(() => ({ list: ['liq', 'osm', 'esriHybrid', 'esriNight'] }));
vi.mock('@/utils/variables', () => ({
  liqKey: 'LIQ',
  arcgisKey: 'ESRI',
  get mapLayers() { return layers.list; },
}));

import TrackMap from './TrackMap.vue';

const KEY = 'navitag.mapLayer';
let tileSpy;
let wrappers = [];

// Tile URL templates added to the map, in order.
const urls = () => tileSpy.mock.calls.map(([url]) => url);
const mountMap = () => {
  const w = mount(TrackMap, { attachTo: document.body, props: { mode: 'live' } });
  wrappers.push(w);
  return w;
};
const layerButton = (w) => w.find('button[aria-label^="Change map"]');

beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  tileSpy = vi.spyOn(L, 'tileLayer');
  layers.list = ['liq', 'osm', 'esriHybrid', 'esriNight'];
  localStorage.clear();
});

afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
  vi.restoreAllMocks();
});

describe('TrackMap base layer', () => {
  it('opens on the main map\'s saved layer', () => {
    localStorage.setItem(KEY, 'esriNight');
    mountMap();
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toContain('arcgis/navigation-night');
    expect(urls()[0]).toContain('token=ESRI');
  });

  it('falls back to Streets when nothing is saved', () => {
    mountMap();
    expect(urls()).toEqual(['https://{s}-tiles.locationiq.com/v3/streets/r/{z}/{x}/{y}.png?key=LIQ']);
  });

  it('falls back to Streets when the saved layer is not offered (native)', () => {
    layers.list = ['liq', 'osm'];
    localStorage.setItem(KEY, 'esriHybrid');
    mountMap();
    expect(urls()[0]).toContain('locationiq.com');
  });

  it('Satellite = imagery plus the labels overlay', () => {
    localStorage.setItem(KEY, 'esriHybrid');
    mountMap();
    expect(urls()).toHaveLength(2);
    expect(urls()[0]).toContain('World_Imagery');
    expect(urls()[1]).toContain('arcgis/imagery/labels');
  });

  it('the layer button cycles the offered layers and never writes the main map\'s choice', async () => {
    localStorage.setItem(KEY, 'osm');
    const w = mountMap();
    const btn = layerButton(w);
    expect(btn.attributes('title')).toBe('Map: OpenStreetMap');

    await btn.trigger('click');
    expect(btn.attributes('title')).toBe('Map: Satellite');
    await btn.trigger('click');
    expect(btn.attributes('title')).toBe('Map: Night');
    await btn.trigger('click');
    expect(btn.attributes('title')).toBe('Map: Streets');
    expect(urls().at(-1)).toContain('locationiq.com');

    expect(localStorage.getItem(KEY)).toBe('osm');
  });

  it('cycles only Streets and OSM when the Esri layers are not offered', async () => {
    layers.list = ['liq', 'osm'];
    const w = mountMap();
    const btn = layerButton(w);
    await btn.trigger('click');
    expect(btn.attributes('title')).toBe('Map: OpenStreetMap');
    await btn.trigger('click');
    expect(btn.attributes('title')).toBe('Map: Streets');
  });

  it('hides the layer button when only one layer is offered', () => {
    layers.list = ['liq'];
    const w = mountMap();
    expect(layerButton(w).exists()).toBe(false);
  });
});
