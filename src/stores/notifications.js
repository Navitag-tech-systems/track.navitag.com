import { defineStore } from 'pinia';
import { ref } from 'vue';
import { baseUrl } from '@/utils/variables';
import { request } from '@/utils/http';
import { useUserStore } from '@/stores/user';

export const useNotificationsStore = defineStore('notifications', () => {
  const loaded = ref(false);
  const loading = ref(false);
  const error = ref(null);

  const notifications_enabled = ref(false);
  const emergency_notifications_enabled = ref(false);

  // Rules stored as a Set of "imei::event_type" strings for O(1) lookup.
  const rules = ref(new Set());
  const owned_devices = ref([]);
  const available_event_types = ref([]);
  const default_event_types = ref([]);
  // Backend-curated list of event types the UI should render (subset of
  // available_event_types plus alarm subtypes). Source of truth for which
  // toggles appear on the per-device notification page.
  const events = ref([]);

  const ruleKey = (imei, event_type) => `${imei}::${event_type}`;
  const hasRule = (imei, event_type) => rules.value.has(ruleKey(imei, event_type));

  async function fetch({ force = false } = {}) {
    if (loading.value) return;
    if (loaded.value && !force) return;

    const userStore = useUserStore();
    loading.value = true;
    error.value = null;
    try {
      const [permsData, eventsData] = await Promise.all([
        request.send({
          url: `${baseUrl}/notification/permissions`,
          token: userStore.idToken,
        }),
        request.send({
          url: `${baseUrl}/notification/events`,
          token: userStore.idToken,
        }),
      ]);
      notifications_enabled.value = !!permsData.notifications_enabled;
      emergency_notifications_enabled.value = !!permsData.emergency_notifications_enabled;
      rules.value = new Set((permsData.rules || []).map((r) => ruleKey(r.device_imei, r.event_type)));
      owned_devices.value = permsData.owned_devices || [];
      available_event_types.value = permsData.available_event_types || [];
      default_event_types.value = permsData.default_event_types || [];
      events.value = eventsData?.events || [];
      loaded.value = true;
    } catch (err) {
      console.error('Failed to fetch notification permissions:', err);
      error.value = err?.message || 'Failed to load notification preferences.';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function setMaster(enabled) {
    const userStore = useUserStore();
    try {
      const data = await request.send({
        url: `${baseUrl}/notification/permissions/master`,
        method: 'PUT',
        data: { enabled },
        token: userStore.idToken,
      });
      notifications_enabled.value = !!data.notifications_enabled;
      return true;
    } catch (err) {
      console.error('Failed to set master notification switch:', err);
      throw err;
    }
  }

  async function setEmergency(enabled) {
    const userStore = useUserStore();
    try {
      const data = await request.send({
        url: `${baseUrl}/notification/permissions/emergency`,
        method: 'PUT',
        data: { enabled },
        token: userStore.idToken,
      });
      emergency_notifications_enabled.value = !!data.emergency_notifications_enabled;
      return true;
    } catch (err) {
      console.error('Failed to set emergency notification switch:', err);
      throw err;
    }
  }

  async function toggleRule(device_imei, event_type, enabled) {
    const userStore = useUserStore();
    const key = ruleKey(device_imei, event_type);
    try {
      await request.send({
        url: `${baseUrl}/notification/permissions/rule`,
        method: 'PUT',
        data: { device_imei, event_type, enabled },
        token: userStore.idToken,
      });
      if (enabled) rules.value.add(key);
      else rules.value.delete(key);
      return true;
    } catch (err) {
      console.error('Failed to toggle notification rule:', err);
      throw err;
    }
  }

  function reset() {
    loaded.value = false;
    loading.value = false;
    error.value = null;
    notifications_enabled.value = false;
    emergency_notifications_enabled.value = false;
    rules.value = new Set();
    owned_devices.value = [];
    available_event_types.value = [];
    default_event_types.value = [];
    events.value = [];
  }

  return {
    loaded,
    loading,
    error,
    notifications_enabled,
    emergency_notifications_enabled,
    rules,
    owned_devices,
    available_event_types,
    default_event_types,
    events,
    hasRule,
    fetch,
    setMaster,
    setEmergency,
    toggleRule,
    reset,
  };
});
