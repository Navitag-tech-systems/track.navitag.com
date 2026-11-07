import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';

const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/stores/user.js', () => ({ useUserStore: () => ({}) }));
vi.mock('@/stores/userLocation.js', () => ({ useUserLocationStore: () => ({ enabled: false, requesting: false, toggle: vi.fn() }) }));

const store = reactive({ devices: {}, deviceSelectedObject: null, deviceSelected: null, locationLabels: {}, isDeviceOnline: () => true });
vi.mock('@/stores/devices.js', () => ({ useDevicesStore: () => store }));

import MapView from './index.vue';
import { OWNER_SENTINEL } from '@/utils/scopes';

const mountView = () => mount(MapView, { global: { stubs: { ShareModal: true, SharedBadge: true } } });

describe('map view selected-device panel: Video button', () => {
  beforeEach(() => push.mockReset());

  it('shows for a dashcam and opens its video page', async () => {
    store.deviceSelectedObject = { id: 248, name: 'NLQ 2537', protocol: 'jt808', scopes: [OWNER_SENTINEL], attributes: {} };
    const w = mountView();
    const btn = w.find('button[aria-label="Dashcam video"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(push).toHaveBeenCalledWith('/dashcam/248');
  });

  it('shows for a device with configured video channels', () => {
    store.deviceSelectedObject = { id: 9, name: 'Cam', protocol: 'osmand', attributes: { videoChannels: '[1,2]' } };
    expect(mountView().find('button[aria-label="Dashcam video"]').exists()).toBe(true);
  });

  it('is hidden for a regular tracker', () => {
    store.deviceSelectedObject = { id: 227, name: 'Canter', protocol: 'startek', scopes: [OWNER_SENTINEL], attributes: {} };
    const w = mountView();
    expect(w.find('button[aria-label="Dashcam video"]').exists()).toBe(false);
    expect(w.text()).toContain('Details');
  });
});
