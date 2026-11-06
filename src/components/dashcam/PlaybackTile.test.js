import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const sendCommand = vi.fn(() => Promise.resolve({}));

vi.mock('@/utils/dashcam', async (importOriginal) => ({
  ...(await importOriginal()),
  sendCommand: (...a) => sendCommand(...a),
  waitForHls: () => Promise.resolve(true),
}));
vi.mock('@/utils/dashcamPlayback', async (importOriginal) => ({
  ...(await importOriginal()),
  labelPlayback: () => Promise.resolve(),
  playbackCommand: (d, ch) => ({ type: 'play', ch }),
  stopPlaybackCommand: (ch) => ({ type: 'stopPlay', ch }),
}));

import PlaybackTile from './PlaybackTile.vue';

const H = Date.UTC(2026, 10, 6, 2, 0, 0);
const device = { id: 249, uniqueId: '991318145295' };
// Camera 2 has an SD-card clip 02:00-02:10; the cache holds 02:20-02:30.
const clips = [{ ch: 2, start: new Date(H), end: new Date(H + 600_000) }];
const cache = { 2: [{ start: H + 1_200_000, end: H + 1_800_000, url: 'https://mcp.navitag.com/live/x/2/rec.m3u8' }] };
const cmds = () => sendCommand.mock.calls.map(([, , p]) => `${p.type}:${p.ch}`);

function mountTile(props = {}) {
  return mount(PlaybackTile, {
    props: {
      device, server: 'tserver1.navitag.com', ch: 2, name: 'Cabin', t: H + 60_000,
      playing: false, allowRemote: false, online: true, clips, cache,
      hubCheck: () => Promise.resolve(false),    // not synced to the hub
      ...props,
    },
    global: { stubs: { HlsVideo: true, InlineLoader: true } },
  });
}

describe('PlaybackTile', () => {
  beforeEach(() => { sendCommand.mockReset(); sendCommand.mockImplementation(() => Promise.resolve({})); });

  it('plays cached video for its camera without any command', async () => {
    const w = mountTile({ t: H + 1_300_000 });
    await flushPromises();
    expect(w.vm.source?.kind).toBe('cache');
    expect(cmds()).toEqual([]);
    expect(w.text()).toContain('Cabin');
  });

  it('never wakes the camera while the main player is paused', async () => {
    const w = mountTile();
    await flushPromises();
    expect(w.vm.status).toBe('tap');
    expect(w.text()).toContain('Plays with the main camera');
    expect(cmds()).toEqual([]);
  });

  it('streams its own camera while playing and stops it on pause', async () => {
    const w = mountTile();
    await flushPromises();
    await w.setProps({ playing: true, allowRemote: true });
    await flushPromises();
    expect(cmds()).toEqual(['play:2']);
    expect(w.vm.source?.kind).toBe('remote');

    // Playhead ticks inside the stream: no restart.
    await w.setProps({ t: H + 65_000 });
    await flushPromises();
    expect(cmds()).toEqual(['play:2']);

    await w.setProps({ playing: false, allowRemote: false });
    await flushPromises();
    expect(cmds()).toEqual(['play:2', 'stopPlay:2']);
    expect(w.vm.status).toBe('tap');
  });

  it('stops its camera stream on unmount', async () => {
    const w = mountTile({ playing: true, allowRemote: true });
    await flushPromises();
    expect(cmds()).toEqual(['play:2']);
    w.unmount();
    await flushPromises();
    expect(cmds()).toEqual(['play:2', 'stopPlay:2']);
  });

  it('says so when the camera is off, and has no video outside its clips', async () => {
    const off = mountTile({ online: false, playing: true, allowRemote: true });
    await flushPromises();
    expect(off.vm.status).toBe('asleep');
    expect(cmds()).toEqual([]);

    const none = mountTile({ t: H + 900_000 });
    await flushPromises();
    expect(none.vm.status).toBe('novideo');
  });
});
