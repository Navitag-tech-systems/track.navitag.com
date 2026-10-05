import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { reactive, nextTick } from 'vue';

// Shared-device notifications (api plan Part 1, F2): shared_devices, the bulk
// All on / All off call, and the refetch when a share gains/loses
// notification:read mid-session.

const send = vi.fn();
vi.mock('@/utils/http', () => ({
  request: { send: (...a) => send(...a) },
  RECONNECT_TIMEOUT_MS: 30000,
  CONNECT_TIMEOUT_MS: 15000,
}));
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ idToken: 'tok' }) }));
const devicesStub = reactive({ sharedToMe: [] });
vi.mock('@/stores/devices', () => ({ useDevicesStore: () => devicesStub }));

import { useNotificationsStore } from './notifications.js';

const PERMS = {
  notifications_enabled: true,
  emergency_notifications_enabled: true,
  rules: [
    { device_imei: 'OWN1', event_type: 'alarm:powerCut' },
    { device_imei: 'SHR1', event_type: 'ignitionOn' },
  ],
  owned_devices: [{ imei: 'OWN1', name: 'Mine' }],
  shared_devices: [{ imei: 'SHR1', name: 'Civic', owner_name: 'Burke' }],
  available_event_types: [],
  default_event_types: [],
};
const EVENTS = { events: ['ignitionOn', 'alarm:powerCut'] };

function routeSend() {
  send.mockImplementation(async ({ url }) => {
    if (url.endsWith('/notification/permissions')) return PERMS;
    if (url.endsWith('/notification/events')) return EVENTS;
    if (url.endsWith('/notification/permissions/rule/bulk')) return { status: 'success', devices: 2, changed: 1 };
    throw new Error(`unexpected ${url}`);
  });
}
const calls = (suffix) => send.mock.calls.filter(([o]) => o.url.endsWith(suffix));

describe('notifications store — shared devices', () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    send.mockReset();
    devicesStub.sharedToMe = [];
    routeSend();
    store = useNotificationsStore();
  });
  // Each test's store owns a watcher on the shared devices stub; dispose it so
  // a later test's stub change does not refetch through an old store.
  afterEach(() => store.$dispose());

  it('stores shared_devices and targets owned + shared', async () => {
    await store.fetch();
    expect(store.shared_devices).toEqual(PERMS.shared_devices);
    expect(store.notifyImeis().sort()).toEqual(['OWN1', 'SHR1']);
    expect(store.hasRule('SHR1', 'ignitionOn')).toBe(true);
  });

  it('bulkSet PUTs the bulk endpoint then force-refetches', async () => {
    await store.fetch();
    send.mockClear();
    const res = await store.bulkSet('alarm:powerCut', false);
    expect(res.changed).toBe(1);
    const [bulk] = calls('/notification/permissions/rule/bulk');
    expect(bulk[0]).toMatchObject({ method: 'PUT', data: { event_type: 'alarm:powerCut', enabled: false } });
    expect(calls('/notification/permissions').length).toBe(1);
  });

  it('refetches when a share gains notification:read, not on unrelated changes', async () => {
    await store.fetch();
    send.mockClear();

    devicesStub.sharedToMe = [{ imei: 'SHR1', scopes: ['position:live'] }];
    await nextTick();
    expect(calls('/notification/permissions').length).toBe(0);

    devicesStub.sharedToMe = [{ imei: 'SHR1', scopes: ['position:live', 'notification:read'] }];
    await nextTick();
    expect(calls('/notification/permissions').length).toBe(1);
  });

  it('reset clears shared_devices', async () => {
    await store.fetch();
    store.reset();
    expect(store.shared_devices).toEqual([]);
  });
});
