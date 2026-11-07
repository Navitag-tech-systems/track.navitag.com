import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';

const push = vi.fn();
const route = reactive({ params: {}, query: {} });
vi.mock('vue-router', () => ({ useRouter: () => ({ push, back: vi.fn() }), useRoute: () => route }));

const store = reactive({ devices: {}, deviceSelectedObject: null });
vi.mock('@/stores/devices.js', () => ({ useDevicesStore: () => store }));

import HistorySetup from './setup.vue';
import { OWNER_SENTINEL } from '@/utils/scopes';

const OWNED = [OWNER_SENTINEL];
const cam = { id: 248, uniqueId: '991318145911', name: 'NLQ 2537', protocol: 'jt808', latlon: [14.6, 121], scopes: OWNED, attributes: {} };
const tracker = { id: 227, uniqueId: '863911061025676', name: 'Canter', protocol: 'startek', latlon: [14.7, 121], scopes: OWNED, attributes: {} };

const mountFor = (device) => {
  store.devices = { [device.id]: device };
  route.params = { imei: device.uniqueId };
  return mount(HistorySetup, { global: { stubs: { DatePicker: true, SharedBadge: true } } });
};
const videoButton = (w) => w.findAll('button').find((b) => b.text().includes('Video Playback'));

describe('Route History setup: dashcam video playback', () => {
  beforeEach(() => {
    push.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 10, 30)); // 10:30 local
  });
  afterEach(() => vi.useRealTimers());

  it('regular tracker: no hour selector, no Video Playback button', () => {
    const w = mountFor(tracker);
    expect(w.find('select#video-hour').exists()).toBe(false);
    expect(videoButton(w)).toBeUndefined();
    expect(w.text()).toContain('Generate Report');
  });

  it('dashcam: hour selector after the date, button below Generate Report', () => {
    const w = mountFor(cam);
    const select = w.find('select#video-hour');
    expect(select.exists()).toBe(true);
    const html = w.html();
    expect(html.indexOf('date-picker-stub')).toBeLessThan(html.indexOf('video-hour'));
    expect(html.indexOf('Generate Report')).toBeLessThan(html.indexOf('Video Playback'));
    expect(videoButton(w)).toBeDefined();
  });

  it('defaults to the current hour and disables later hours today', () => {
    const w = mountFor(cam);
    const opts = w.findAll('select#video-hour option');
    expect(opts).toHaveLength(24);
    expect(w.find('select#video-hour').element.value).toBe('10');
    expect(opts[10].attributes('disabled')).toBeUndefined();
    expect(opts[11].attributes('disabled')).toBeDefined();
  });

  it('opens the Playback tab with the date and hour prefilled', async () => {
    const w = mountFor(cam);
    await w.find('select#video-hour').setValue('7');
    await videoButton(w).trigger('click');
    expect(push).toHaveBeenCalledWith({
      path: '/dashcam/248',
      query: { tab: 'playback', day: '2026-11-07', hour: '7' },
    });
  });
});
