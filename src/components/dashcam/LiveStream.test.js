import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const sendCommand = vi.fn(() => Promise.resolve({}));

vi.mock('@/utils/dashcam', async (importOriginal) => ({
  ...(await importOriginal()),
  sendCommand: (...a) => sendCommand(...a),
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

const types = () => sendCommand.mock.calls.map(([, , p]) => (p.type === 'videoStop' ? `stop:${p.attributes.index}` : 'start'));
const button = (w, label) => w.findAll('button').find((b) => b.text().trim() === label);

async function mountAndStart() {
  const w = mount(LiveStream, {
    props: { device },
    global: { stubs: { HlsVideo: true, InlineLoader: true } },
  });
  await button(w, 'Start').trigger('click');
  await vi.advanceTimersByTimeAsync(1000);  // 300 ms between channel sends
  await flushPromises();
  return w;
}

describe('LiveStream session limit', () => {
  beforeEach(() => { vi.useFakeTimers(); sendCommand.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stops every started channel after the limit and shows the paused screen', async () => {
    const w = await mountAndStart();
    expect(types()).toEqual(['start']);

    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000 - 5000);
    expect(types()).toEqual(['start']);           // not yet
    expect(w.text()).not.toContain('Live paused');

    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(types()).toEqual(['start', 'stop:1']);
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
    expect(types()).toEqual(['start', 'stop:1', 'start']);
    expect(w.text()).not.toContain('Live paused');

    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000);
    await flushPromises();
    expect(types()).toEqual(['start', 'stop:1', 'start', 'stop:1']);
  });

  it('a manual Stop cancels the limit', async () => {
    const w = await mountAndStart();
    const stopBtn = w.findAll('button').find((b) => /Stop|Cancel/.test(b.text()));
    await stopBtn.trigger('click');
    await flushPromises();
    expect(types()).toEqual(['start', 'stop:1']);

    await vi.advanceTimersByTimeAsync(LIVE_SESSION_LIMIT_S * 1000);
    await flushPromises();
    expect(types()).toEqual(['start', 'stop:1']);
    expect(w.text()).not.toContain('Live paused');
    expect(w.text()).toContain('Stream stopped');
  });
});
