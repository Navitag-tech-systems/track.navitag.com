import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const sendCommand = vi.fn(() => Promise.resolve({}));
const labelLive = vi.fn(() => Promise.resolve());

vi.mock('@/utils/dashcam', async (importOriginal) => ({
  ...(await importOriginal()),
  sendCommand: (...a) => sendCommand(...a),
  liveStartCommand: (ch) => ({ type: 'custom', ch: Number(ch) }),
  labelLive: (...a) => labelLive(...a),
  waitForHls: () => Promise.resolve(true),
}));
vi.mock('@/stores/user.js', () => ({ useUserStore: () => ({ server_url: 'tserver1.navitag.com' }) }));
vi.mock('@/stores/toast.js', () => ({ useToastStore: () => ({ show: vi.fn() }) }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: () => {} }));

import LiveStream from './LiveStream.vue';
import { LIVE_SESSION_LIMIT_S } from '@/utils/dashcam';

const device = {
  id: 249,
  uniqueId: '991318145295',
  attributes: { videoChannels: [{ index: 1, name: 'Front' }, { index: 2, name: 'Cabin' }] },
};

const types = () => sendCommand.mock.calls.map(([, , p]) => (p.type === 'videoStop' ? `stop:${p.attributes.index}` : `start:${p.ch}`));
const button = (w, label) => w.findAll('button').find((b) => b.text().trim() === label);

async function mountAndStart() {
  const w = mount(LiveStream, {
    props: { device },
    global: { stubs: { HlsVideo: true, InlineLoader: true, TrackMap: true } },
  });
  await button(w, 'Start').trigger('click');
  await vi.advanceTimersByTimeAsync(1000);  // 300 ms between channel sends
  await flushPromises();
  return w;
}

describe('LiveStream session limit', () => {
  beforeEach(() => { vi.useFakeTimers(); sendCommand.mockReset(); sendCommand.mockImplementation(() => Promise.resolve({})); labelLive.mockReset(); labelLive.mockImplementation(() => Promise.resolve()); });
  afterEach(() => { vi.useRealTimers(); });

  it('stops the camera after the limit and shows the paused screen', async () => {
    const w = await mountAndStart();
    expect(types()).toEqual(['start:1']);

    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000 - 5000);
    expect(types()).toEqual(['start:1']);           // not yet
    expect(w.text()).not.toContain('Live paused');

    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1']);
    expect(w.text()).toContain('Live paused');
    expect(w.text()).toContain(`Paused after ${LIVE_SESSION_LIMIT_S / 60} min`);
  });

  it('Resume starts the same camera again with a fresh window', async () => {
    const w = await mountAndStart();
    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000);
    await flushPromises();

    const resume = w.findAll('button').filter((b) => b.text().includes('Resume'));
    expect(resume.length).toBe(2);                // overlay + bottom bar
    await resume[0].trigger('click');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1', 'start:1']);
    expect(w.text()).not.toContain('Live paused');

    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000);
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1', 'start:1', 'stop:1']);
  });

  it('a manual Stop cancels the limit', async () => {
    const w = await mountAndStart();
    const stopBtn = w.findAll('button').find((b) => /Stop|Cancel/.test(b.text()));
    await stopBtn.trigger('click');
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1']);

    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000);
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1']);
    expect(w.text()).not.toContain('Live paused');
    expect(w.text()).toContain('Stream stopped');
  });
});

describe('LiveStream all cameras', () => {
  beforeEach(() => { vi.useFakeTimers(); sendCommand.mockReset(); sendCommand.mockImplementation(() => Promise.resolve({})); labelLive.mockReset(); labelLive.mockImplementation(() => Promise.resolve()); });
  afterEach(() => { vi.useRealTimers(); });
  const mountIt = () => mount(LiveStream, { props: { device }, global: { stubs: { HlsVideo: true, InlineLoader: true, TrackMap: true } } });
  const allBtn = (w) => w.findAll('button').find((b) => /All \(2\)/.test(b.text()));

  it('offers All for a multi-camera unit, not for a single camera', () => {
    expect(mountIt().findAll('button').map((b) => b.text().trim())).toEqual(['Front', 'Cabin', 'All (2)', 'Start']);
    const one = mount(LiveStream, {
      props: { device: { ...device, attributes: { videoChannels: [{ index: 1, name: 'Front' }] } } },
      global: { stubs: { HlsVideo: true, InlineLoader: true, TrackMap: true } },
    });
    expect(one.text()).not.toMatch(/All \(/);
  });

  it('All starts every camera, one send at a time, in a labelled grid', async () => {
    const w = mountIt();
    await allBtn(w).trigger('click');
    await button(w, 'Start').trigger('click');
    await flushPromises();
    expect(types()).toEqual(['start:1']);          // second send waits the gap
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(types()).toEqual(['start:1', 'start:2']);
    expect(w.text()).toContain('Front');
    expect(w.text()).toContain('Cabin');
    expect(w.find('.grid').exists()).toBe(true);
  });

  it('Stop closes every camera; the session limit stops them all', async () => {
    const w = mountIt();
    await allBtn(w).trigger('click');
    await button(w, 'Start').trigger('click');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    await w.findAll('button').find((b) => /Stop|Cancel/.test(b.text())).trigger('click');
    await flushPromises();
    expect(types().sort()).toEqual(['start:1', 'start:2', 'stop:1', 'stop:2'].sort());

    sendCommand.mockClear();
    await button(w, 'Start').trigger('click');
    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000);
    await flushPromises();
    expect(types().filter((t) => t.startsWith('stop')).sort()).toEqual(['stop:1', 'stop:2']);
    expect(w.text()).toContain('Live paused');
  });

  it('All -> one camera stops both streams before starting the one', async () => {
    const w = mountIt();
    await allBtn(w).trigger('click');
    await button(w, 'Start').trigger('click');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    sendCommand.mockClear();
    await button(w, 'Front').trigger('click');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    const t = types();
    expect(t.slice(0, 2).sort()).toEqual(['stop:1', 'stop:2']);
    expect(t.slice(2)).toEqual(['start:1']);
    expect(w.find('.grid').exists()).toBe(false);
  });

  it('one camera failing leaves the other playing and the limit running', async () => {
    sendCommand.mockImplementation((s, id, p) => (p.ch === 2 ? Promise.reject(Object.assign(new Error('cam 2 down'), { status: 500 })) : Promise.resolve({})));
    const w = mountIt();
    await allBtn(w).trigger('click');
    await button(w, 'Start').trigger('click');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(w.text()).toContain('cam 2 down');
    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000);
    await flushPromises();
    expect(w.text()).toContain('Live paused');
  });
});

describe('LiveStream one camera at a time', () => {
  beforeEach(() => { vi.useFakeTimers(); sendCommand.mockReset(); sendCommand.mockImplementation(() => Promise.resolve({})); labelLive.mockReset(); labelLive.mockImplementation(() => Promise.resolve()); });
  afterEach(() => { vi.useRealTimers(); });

  it('switching camera stops the current stream before starting the next', async () => {
    const w = await mountAndStart();
    await button(w, 'Cabin').trigger('click');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1', 'start:2']);
  });

  it('a switch while the start command is in flight closes that camera again', async () => {
    let release;
    sendCommand.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const w = mount(LiveStream, { props: { device }, global: { stubs: { HlsVideo: true, InlineLoader: true, TrackMap: true } } });
    await button(w, 'Start').trigger('click');
    await flushPromises();
    await button(w, 'Cabin').trigger('click');
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1', 'start:2']);
    release({});
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1', 'start:2', 'stop:1']);  // never stop:2
  });
});

describe('LiveStream races found in review', () => {
  beforeEach(() => { vi.useFakeTimers(); sendCommand.mockReset(); sendCommand.mockImplementation(() => Promise.resolve({})); labelLive.mockReset(); labelLive.mockImplementation(() => Promise.resolve()); });
  afterEach(() => { vi.useRealTimers(); });
  const mountIt = () => mount(LiveStream, { props: { device }, global: { stubs: { HlsVideo: true, InlineLoader: true, TrackMap: true } } });

  it('Cancel while the medusa label is in flight never sends the start', async () => {
    let releaseLabel;
    labelLive.mockImplementationOnce(() => new Promise((r) => { releaseLabel = r; }));
    const w = mountIt();
    await button(w, 'Start').trigger('click');
    await flushPromises();
    await w.findAll('button').find((b) => /Cancel|Stop/.test(b.text())).trigger('click');
    await flushPromises();
    releaseLabel();
    await flushPromises();
    expect(types()).toEqual(['stop:1']);
  });

  it('a switch while the label is in flight never starts the old camera', async () => {
    let releaseLabel;
    labelLive.mockImplementationOnce(() => new Promise((r) => { releaseLabel = r; }));
    const w = mountIt();
    await button(w, 'Start').trigger('click');
    await flushPromises();
    await button(w, 'Cabin').trigger('click');
    await flushPromises();
    releaseLabel();
    await flushPromises();
    expect(types()).toEqual(['stop:1', 'start:2']);
  });

  it('shows the next camera waking (not Start) while the old one is being stopped', async () => {
    const w = await mountAndStart();
    let releaseStop;
    sendCommand.mockImplementationOnce(() => new Promise((r) => { releaseStop = r; }));
    await button(w, 'Cabin').trigger('click');
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1']);
    expect(button(w, 'Start')).toBeUndefined();
    expect(w.text()).toContain('Waking the camera');
    expect(w.text()).not.toContain('Tap Start');
    releaseStop({});
    await flushPromises();
    expect(types()).toEqual(['start:1', 'stop:1', 'start:2']);
  });

  it('leaving while a switch waits on the old stop sends no new start', async () => {
    const w = await mountAndStart();
    let releaseStop;
    sendCommand.mockImplementationOnce(() => new Promise((r) => { releaseStop = r; }));
    await button(w, 'Cabin').trigger('click');
    await flushPromises();
    w.unmount();
    releaseStop({});
    await flushPromises();
    expect(types().filter((t) => t.startsWith('start'))).toEqual(['start:1']);
  });

  it('a start error stays on screen; the session limit does not replace it', async () => {
    sendCommand.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('nope'), { status: 500 })));
    const w = mountIt();
    await button(w, 'Start').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('nope');
    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000 + 1000);
    await flushPromises();
    expect(w.text()).toContain('nope');
    expect(w.text()).not.toContain('Live paused');
    expect(types()).toEqual(['start:1']);
  });
});
