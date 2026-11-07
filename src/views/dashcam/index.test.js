import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, defineComponent, h } from 'vue';

const route = reactive({ params: { deviceId: '248' }, query: {} });
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: vi.fn(), back: vi.fn() }), useRoute: () => route }));
vi.mock('@/utils/dashcamDemo', () => ({ demoEnabled: () => false, loadManifest: vi.fn() }));

const store = reactive({ devices: { 248: { id: 248, uniqueId: '991318145911', name: 'NLQ 2537', protocol: 'jt808', attributes: {} } }, hasLoadedOnce: true });
vi.mock('@/stores/devices.js', () => ({ useDevicesStore: () => store }));

const PlaybackStub = defineComponent({ name: 'PlaybackView', props: { device: Object, startAt: Number }, render: () => h('div', 'playback') });

import DashcamPage from './index.vue';

const mountWith = (query) => {
  route.query = query;
  return mount(DashcamPage, {
    global: { stubs: { PlaybackView: PlaybackStub, LiveStream: true, DashcamConfig: true, ChannelSelect: true, SharedBadge: true } },
  });
};

describe('dashcam page: Playback start from ?day=&hour=', () => {
  afterEach(() => vi.useRealTimers());

  it('passes the linked hour to the Playback tab', () => {
    const w = mountWith({ tab: 'playback', day: '2026-11-06', hour: '9' });
    expect(w.findComponent(PlaybackStub).props('startAt')).toBe(new Date(2026, 10, 6, 9).getTime());
  });

  it('passes null without a day/hour, so Playback opens on the latest driving hour', () => {
    const w = mountWith({ tab: 'playback' });
    expect(w.findComponent(PlaybackStub).props('startAt')).toBeNull();
  });

  it('passes null for a future hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 10, 30));
    const w = mountWith({ tab: 'playback', day: '2026-11-07', hour: '23' });
    expect(w.findComponent(PlaybackStub).props('startAt')).toBeNull();
  });
});
