<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { hasScope } from '@/utils/scopes';
import ShareModal from '@/components/ShareModal.vue';
import SharedBadge from '@/components/SharedBadge.vue';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();

const showShareModal = ref(false);

// Get the device ID from the URL
const deviceId = route.params.id;

// Find the device in the store
const device = computed(() => {
  return deviceStore.devices[deviceId];
});

// Helper to format dates
const formatDate = (isoString) => {
  if (!isoString) return 'N/A';
  return new Date(isoString).toLocaleString();
};

// Helper to format booleans/nulls
const formatValue = (val) => {
  if (val === true) return 'Yes';
  if (val === false) return 'No';
  if (val === null || val === undefined) return 'N/A';
  return val;
};

// Action to jump to this device on the map
const viewOnMap = () => {
  if (!device.value) return;
  // Select the device in the store (this usually triggers map centering watchers)
  deviceStore.deviceSelected = device.value.id; 
  router.push('/');
};

// Action to view history
const viewHistory = () => {
  if (!device.value) return;
  router.push(`/history/${device.value.uniqueId}`);
};

// --- Energy metrics (mirrored Traccar attributes) ---

function formatNumber(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(fractionDigits);
}

const hasFuelBaseline = computed(() => Number(device.value?.attributes?.has_fuel_baseline) === 1);
const hasChargeBaseline = computed(() => Number(device.value?.attributes?.has_charge_baseline) === 1);

const energyAlerts = computed(() => {
  const raw = device.value?.attributes?.energy_metric_alerts;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
});

const tankCapacity = computed(() => {
  const v = device.value?.attributes?.tank_capacity;
  return v == null ? null : formatNumber(v, 1);
});
const tankIsEstimated = computed(() =>
  tankCapacity.value != null && device.value?.attributes?.tank_capacity_intervals !== -1
);
const batteryCapacity = computed(() => {
  const v = device.value?.attributes?.battery_capacity;
  return v == null ? null : formatNumber(v, 1);
});

const kmPerLiterAvg = computed(() => formatNumber(device.value?.attributes?.km_per_liter_avg));
const kmPerLiterInterval = computed(() => formatNumber(device.value?.attributes?.km_per_liter_interval));
const kmPerKwhAvg = computed(() => formatNumber(device.value?.attributes?.km_per_kwh_avg));
const kmPerKwhInterval = computed(() => formatNumber(device.value?.attributes?.km_per_kwh_interval));

const costPerKmAvg = computed(() => formatNumber(device.value?.attributes?.cost_per_km_avg));
const costPerLiterAvg = computed(() => formatNumber(device.value?.attributes?.cost_per_liter_avg));
const costPerKwhAvg = computed(() => formatNumber(device.value?.attributes?.cost_per_kwh_avg));

const hasAnyEnergyData = computed(() =>
  hasFuelBaseline.value ||
  hasChargeBaseline.value ||
  tankCapacity.value != null ||
  batteryCapacity.value != null ||
  kmPerLiterAvg.value != null ||
  kmPerKwhAvg.value != null
);

// Which warning tooltip is currently visible. Single ref so only one tooltip
// is open at a time (mirrors the Activity Lock info pattern in deviceSettings).
const openAlertKey = ref(null);
const alertFor = (key) => energyAlerts.value?.[key] ?? null;

// Owners pass via OWNER_SENTINEL; shared devices need the matching scope
// from their /share/tome list.
const canHistory     = computed(() => hasScope(device.value, 'history:read'));
const canReadEnergy  = computed(() => hasScope(device.value, 'energy:read'));

// --- Activity Lock toggle (same flow as deviceSettings.vue) ---
const activityLock = computed(() => !!device.value?.attributes?.activity_lock);
const activityLockBusy = ref(false);
const lockError = ref('');

async function toggleActivityLock() {
  if (activityLockBusy.value || !device.value) return;
  activityLockBusy.value = true;
  lockError.value = '';
  const res = await deviceStore.setActivityLock(deviceId, !activityLock.value);
  if (!res.ok) lockError.value = 'Activity lock update failed. Please try again.';
  activityLockBusy.value = false;
}
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface relative z-10 pointer-events-auto">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200 p-4 flex items-center safe-top">
      <button 
        @click="router.back()" 
        class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none"
      >
        <i class="fa-solid fa-arrow-left text-lg"></i>
      </button>
      <h1 class="text-lg font-bold text-gray-800">Device Details</h1>
    </div>

    <div v-if="!device" class="p-10 text-center text-gray-500">
      <p>Device not found or loading...</p>
    </div>

    <div v-else class="p-4 space-y-4 pb-10">
      
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div class="flex justify-between items-start mb-4">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-bold text-gray-800">{{ device.name }}</h2>
              <SharedBadge :device="device" />
              <button
                v-if="hasScope(device, 'share:public')"
                @click="showShareModal = true"
                class="w-6 h-6 flex items-center justify-center bg-gray-100 text-gray-500 rounded-full hover:bg-gray-200 transition-colors shrink-0"
                aria-label="Share tracking link"
              >
                <i class="fa-solid fa-share-nodes text-xs"></i>
              </button>
            </div>
            <p class="text-xs text-gray-400 font-mono mt-1">IMEI: {{ device.uniqueId }}</p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <span 
              class="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border"
              :class="device.status === 'online' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-surface text-gray-500 border-gray-200'"
            >
              {{ device.status }}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3 mt-4">
          <button
            @click="viewOnMap"
            class="flex items-center justify-center gap-2 bg-brand-light text-brand py-2.5 rounded-lg text-sm font-bold hover:bg-brand-light transition-colors"
          >
            <i class="fa-solid fa-map-location-dot"></i> Map
          </button>
          <button
            @click="viewHistory"
            :disabled="!canHistory"
            :aria-label="canHistory ? 'View history' : 'History access not granted'"
            :title="canHistory ? '' : 'History access not granted'"
            :class="[
              'flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors',
              canHistory
                ? 'bg-surface text-gray-600 hover:bg-gray-100'
                : 'bg-surface text-gray-300 cursor-not-allowed',
            ]"
          >
            <i class="fa-solid fa-clock-rotate-left"></i> History
          </button>
          <button
            @click="router.push(`/device/settings/${deviceId}`)"
            :disabled="!canReadEnergy"
            :aria-label="canReadEnergy ? 'Open settings' : 'Settings not available'"
            :title="canReadEnergy ? '' : 'Settings not available for this share'"
            :class="[
              'flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors',
              canReadEnergy
                ? 'bg-surface text-gray-600 hover:bg-gray-100'
                : 'bg-surface text-gray-300 cursor-not-allowed',
            ]"
          >
            <i class="fa-solid fa-gear"></i> Settings
          </button>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-surface px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">
          Status & Sensors
        </div>
        <div class="divide-y divide-gray-100">
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Ignition</span>
            <span class="font-bold" :class="device.ignition ? 'text-green-600' : 'text-gray-400'">{{ device.ignition ? 'ON' : 'OFF' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Motion</span>
            <span class="font-bold text-gray-800">{{ formatValue(device.motion) }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Speed</span>
            <span class="font-bold text-gray-800">{{ device.speed ? Math.round(device.speed * 1.852) + ' km/h' : '0 km/h' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">External Power</span>
            <span class="font-bold text-gray-800">{{ device.power ? device.power + ' V' : 'N/A' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Battery Level</span>
            <span class="font-bold text-gray-800">{{ device.battery ? device.battery + '%' : 'N/A' }}</span>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-surface px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">
          Location
        </div>
        <div class="divide-y divide-gray-100">
          <div class="p-3 text-sm">
            <span class="block text-gray-500 mb-1">Address</span>
            <span class="block font-medium text-gray-800 leading-snug">{{ device.address || 'Resolving address...' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Coordinates</span>
            <span class="font-mono text-gray-700 text-xs mt-0.5">
              {{ device.latlon ? `${device.latlon[0].toFixed(5)}, ${device.latlon[1].toFixed(5)}` : 'N/A' }}
            </span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Course / Bearing</span>
            <span class="font-bold text-gray-800">{{ device.bearing }}°</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Accuracy</span>
            <span class="font-bold text-gray-800">{{ device.accuracy ? device.accuracy + ' m' : 'N/A' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Last Update (Server)</span>
            <span class="font-bold text-gray-800 text-xs mt-0.5">{{ formatDate(device.updateTime) }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">GPS Fix Time</span>
            <span class="font-bold text-gray-800 text-xs mt-0.5">{{ formatDate(device.fixTime) }}</span>
          </div>
        </div>
      </div>

      <div v-if="!device.shared" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-surface px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">
          Activity Lock
        </div>
        <div class="divide-y divide-gray-100">
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Activity Lock</span>
            <span class="font-bold" :class="device.attributes?.activity_lock ? 'text-red-500' : 'text-gray-400'">
              {{ device.attributes?.activity_lock ? 'ON' : 'OFF' }}
            </span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Auto Activity Lock</span>
            <span class="font-bold" :class="device.attributes?.auto_lock ? 'text-red-500' : 'text-gray-400'">
              {{ device.attributes?.auto_lock ? 'ON' : 'OFF' }}
            </span>
          </div>
        </div>
        <div class="p-3 border-t border-gray-100">
          <button
            type="button"
            @click="toggleActivityLock"
            :disabled="activityLockBusy"
            :aria-label="activityLock ? 'Activity lock engaged. Tap to unlock.' : 'Activity lock disengaged. Tap to lock.'"
            :aria-pressed="activityLock"
            :class="[
              'w-full py-6 rounded-xl text-white flex items-center justify-center transition-colors shadow-sm active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed',
              activityLock ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-400 hover:bg-gray-500',
            ]"
          >
            <i v-if="activityLockBusy" class="fa-solid fa-circle-notch fa-spin text-3xl"></i>
            <i v-else :class="activityLock ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'" class="text-3xl"></i>
          </button>
          <p v-if="lockError" class="text-xs text-red-500 mt-2">{{ lockError }}</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-surface px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span class="font-bold text-sm text-gray-700">Usage Metrics</span>
          <button
            v-if="canReadEnergy"
            @click="router.push(`/energy/logs/${deviceId}`)"
            class="text-xs font-bold text-brand hover:text-brand-dark transition-colors flex items-center gap-1"
          >
            View Logs
            <i class="fa-solid fa-chevron-right text-[10px]"></i>
          </button>
        </div>

        <div v-if="!hasAnyEnergyData" class="p-4 text-center text-sm text-gray-500 leading-snug">
          No fuel or charge events logged yet. Use the actions below to start tracking efficiency and cost.
        </div>

        <div v-else class="divide-y divide-gray-100">
          <div v-if="tankCapacity != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Tank capacity
              <span v-if="alertFor('tank_capacity')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'tank_capacity'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'tank_capacity'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('tank_capacity') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">
              {{ tankCapacity }} L
              <span v-if="tankIsEstimated" class="text-[10px] uppercase tracking-wider text-amber-600 font-bold ml-1">est</span>
            </span>
          </div>
          <div v-if="batteryCapacity != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Battery capacity
              <span v-if="alertFor('battery_capacity')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'battery_capacity'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'battery_capacity'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('battery_capacity') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">{{ batteryCapacity }} kWh</span>
          </div>

          <div v-if="kmPerLiterAvg != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Avg Fuel Usage
              <span v-if="alertFor('km_per_liter_avg')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'km_per_liter_avg'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'km_per_liter_avg'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('km_per_liter_avg') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">{{ kmPerLiterAvg }} km/L</span>
          </div>
          <div v-if="kmPerLiterInterval != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Latest fuel usage
              <span v-if="alertFor('km_per_liter_interval')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'km_per_liter_interval'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'km_per_liter_interval'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('km_per_liter_interval') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">{{ kmPerLiterInterval }} km/L</span>
          </div>

          <div v-if="kmPerKwhAvg != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Avg Electricity Usage
              <span v-if="alertFor('km_per_kwh_avg')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'km_per_kwh_avg'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'km_per_kwh_avg'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('km_per_kwh_avg') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">{{ kmPerKwhAvg }} km/kWh</span>
          </div>
          <div v-if="kmPerKwhInterval != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Latest Electric Usage
              <span v-if="alertFor('km_per_kwh_interval')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'km_per_kwh_interval'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'km_per_kwh_interval'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('km_per_kwh_interval') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">{{ kmPerKwhInterval }} km/kWh</span>
          </div>

          <div v-if="costPerLiterAvg != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Avg cost per liter
              <span v-if="alertFor('cost_per_liter_avg')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'cost_per_liter_avg'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'cost_per_liter_avg'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('cost_per_liter_avg') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">{{ costPerLiterAvg }}</span>
          </div>
          <div v-if="costPerKwhAvg != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Avg cost per kWh
              <span v-if="alertFor('cost_per_kwh_avg')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'cost_per_kwh_avg'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'cost_per_kwh_avg'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('cost_per_kwh_avg') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">{{ costPerKwhAvg }}</span>
          </div>
          <div v-if="costPerKmAvg != null" class="flex justify-between p-3 text-sm">
            <span class="text-gray-500 flex items-center gap-1.5">
              Avg cost per km
              <span v-if="alertFor('cost_per_km_avg')" class="relative">
                <button
                  type="button"
                  tabindex="-1"
                  @mouseenter="openAlertKey = 'cost_per_km_avg'"
                  @mouseleave="openAlertKey = null"
                  aria-label="Alert"
                  class="text-amber-500 hover:text-amber-600 transition-colors cursor-help"
                >
                  <i class="fa-solid fa-triangle-exclamation text-xs"></i>
                </button>
                <div
                  v-if="openAlertKey === 'cost_per_km_avg'"
                  role="tooltip"
                  class="absolute top-full left-0 mt-2 w-max max-w-[240px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
                >
                  {{ alertFor('cost_per_km_avg') }}
                  <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
                </div>
              </span>
            </span>
            <span class="font-bold text-gray-800">{{ costPerKmAvg }}</span>
          </div>
        </div>

      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-surface px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">
          Network
        </div>
        <div class="divide-y divide-gray-100">
           <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Connection Type</span>
            <span class="font-bold text-gray-800 uppercase">{{ device.connectionType || 'N/A' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Signal Strength</span>
            <span class="font-bold text-gray-800">{{ device.signalLevel || 'N/A' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Mobile Operator (MCC/MNC)</span>
            <span class="font-bold text-gray-800">{{ device.mobileCountryCode || '?' }} / {{ device.mobileNetworkCode || '?' }}</span>
          </div>
        </div>
      </div>


    </div>

    <ShareModal
      v-if="device"
      v-model="showShareModal"
      :imei="device.uniqueId"
      :label="device.name"
    />
  </div>
</template>