import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

// Video found by "Looking for video" starts by itself, also when its only copy
// is on the camera (streamed via 0x9201): no "tap to play" step in between.

vi.mock('@/utils/http', () => ({ request: { send: vi.fn() } }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));
vi.mock('@/stores/user.js', () => ({ useUserStore: () => ({ server_url: 'tserver1.navitag.com' }) }));

const devState = reactive({ online: true });
vi.mock('@/stores/devices.js', () => ({ useDevicesStore: () => ({ isDeviceOnline: () => devState.online }) }));

const sendCommand = vi.fn(async () => ({}));
vi.mock('@/utils/dashcam', async (orig) => ({
  ...(await orig()),
  videoChannels: () => [{ index: 1, name: 'Front' }],
  deviceTimeZone: () => null,
  sendCommand: (...a) => sendCommand(...a),
  liveHlsUrl: () => 'https://live.test/1.m3u8',
  waitForHls: vi.fn(async () => true),
  clipIsSynced: vi.fn(async () => false),      // not on the hub: camera only
}));

const at = (h, m = 0) => new Date(2026, 10, 7, h, m).getTime();
const CLIP = { id: '1-0910-0920', ch: 1, start: new Date(at(9, 10)), end: new Date(at(9, 20)), alarm: 0, size: 1000 };
let answered = false;
vi.mock('@/utils/dashcamPlayback', async (orig) => ({
  ...(await orig()),
  fetchPositions: vi.fn(async () => []),
  fetchDailyKm: vi.fn(async () => []),
  fetchRecIndex: vi.fn(async () => ({})),       // nothing in the medusa cache
  labelPlayback: vi.fn(async () => {}),
  listCommand: () => ({ kind: 'list' }),
  playbackCommand: () => ({ kind: 'play' }),
  stopPlaybackCommand: () => ({ kind: 'stop' }),
  fetchListEntries: vi.fn(async () => [{ id: 'a1', receivedMs: Date.now() }]),
  pickListAnswer: () => (answered ? null : (answered = true, { id: 'a1', clips: [CLIP], clean: true })),
}));

import PlaybackView from './PlaybackView.vue';

const device = { id: 248, uniqueId: '991318145911', name: 'NLQ 2537', protocol: 'jt808', attributes: {} };
const stubs = { HlsVideo: true, TrackMap: true, PlaybackTimeline: true, DayHourPicker: true, DownloadSheet: true, PlaybackTile: true, InlineLoader: true };
const sent = (kind) => sendCommand.mock.calls.filter((c) => c[2]?.kind === kind).length;

async function run(ms) {
  for (let i = 0; i < ms / 500; i++) { await vi.advanceTimersByTimeAsync(500); await flushPromises(); }
}

describe('PlaybackView: automatic start after locating video', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 10, 30));
    localStorage.clear();
    sendCommand.mockClear();
    answered = false;
    devState.online = true;
  });
  afterEach(() => vi.useRealTimers());

  it('streams the found camera video without a tap', async () => {
    const w = mount(PlaybackView, { props: { device, startAt: at(9) }, global: { stubs } });
    await run(4000);
    expect(sent('list')).toBe(1);
    expect(sent('play')).toBe(1);                         // 0x9201 sent by itself
    expect(w.text()).not.toContain('Video at');        // no "tap to play" screen
    expect(w.text()).toContain('Loading video');
    w.unmount();
  });

  it('does not wake a camera that is off', async () => {
    devState.online = false;
    const w = mount(PlaybackView, { props: { device, startAt: at(9) }, global: { stubs } });
    await run(4000);
    expect(sent('play')).toBe(0);
    w.unmount();
  });
});
