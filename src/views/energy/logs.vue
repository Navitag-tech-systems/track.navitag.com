<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { useUserStore } from '@/stores/user.js';
import { request } from '@/utils/http.js';
import { baseUrl } from '@/utils/variables';
import { hasScope } from '@/utils/scopes';
import SharedBadge from '@/components/SharedBadge.vue';
import InlineLoader from '@/components/InlineLoader.vue';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();
const userStore = useUserStore();

const deviceId = route.params.id;
const device = computed(() => deviceStore.devices[deviceId]);
const deviceImei = computed(() => device.value?.uniqueId || '');

// Energy reads also gate on a grant scope when the device is shared.
const hasEnergyRead  = computed(() => hasScope(device.value, 'energy:read'));
const canWriteEnergy = computed(() => hasScope(device.value, 'energy:write'));
// Mirrors deviceSettings.vue: entry buttons need both read AND write.
const canLogEnergy   = computed(() => hasEnergyRead.value && canWriteEnergy.value);

// Month is a YYYY-MM string in the USER'S LOCAL calendar. The backend resolves
// the local month to a UTC range (it receives the `timezone` sent below), so the
// report reflects the user's own month rather than a UTC month.
function toMonthString(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const currentMonth = ref(toMonthString());
const items = ref([]);
const truncated = ref(false);
// Entries the API accepted but could not process. Writes return 200 and are
// handled after the response, so without this a permanent failure produced no
// row, no error and no notification — the user had already been told it saved.
const failedEntries = ref([]);
const pendingCount = ref(0);
const loading = ref(false);
const errorMsg = ref('');

const monthLabel = computed(() => {
  const [y, m] = currentMonth.value.split('-').map(Number);
  if (!y || !m) return currentMonth.value;
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
});

const isCurrentMonth = computed(() => currentMonth.value === toMonthString());

function shiftMonth(delta) {
  const [y, m] = currentMonth.value.split('-').map(Number);
  if (!y || !m) return;
  const d = new Date(y, m - 1 + delta, 1);
  currentMonth.value = toMonthString(d);
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
}

function formatNumber(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(fractionDigits);
}

async function fetchLogs() {
  if (!deviceImei.value) return;
  if (!hasEnergyRead.value) {
    items.value = [];
    truncated.value = false;
    errorMsg.value = 'This device was shared without energy access. Ask the owner to grant the Energy (read) scope.';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await request.send({
      url: `${baseUrl}/energy/logs/${deviceImei.value}`,
      method: 'GET',
      params: { month: currentMonth.value, ...(userTz ? { timezone: userTz } : {}) },
      token: userStore.idToken,
    });
    items.value = Array.isArray(res?.items) ? res.items : [];
    truncated.value = !!res?.truncated;
    failedEntries.value = Array.isArray(res?.issues?.failed) ? res.issues.failed : [];
    pendingCount.value = Number(res?.issues?.pending) || 0;
  } catch (err) {
    console.error('Failed to fetch energy logs:', err);
    errorMsg.value = err?.message || 'Failed to load energy logs.';
    items.value = [];
    truncated.value = false;
    failedEntries.value = [];
    pendingCount.value = 0;
  } finally {
    loading.value = false;
  }
}

watch([deviceImei, currentMonth], () => fetchLogs(), { immediate: true });

onMounted(() => {
  if (!device.value) {
    errorMsg.value = 'Device not found.';
  }
});

// Plain-language copy for the backend's stable reason codes. Mapping on the code
// rather than the raw last_error keeps internal strings off the screen.
const FAILURE_COPY = {
  no_position_for_date: 'The tracker had not reported a position near that date, so there was no distance reading to record against it.',
  gave_up_retrying: 'This could not be processed after several attempts.',
  invalid_entry: 'This entry could not be read.',
  processing_failed: 'This entry could not be processed.',
};
const failureCopy = (e) => FAILURE_COPY[e?.reason_code] || FAILURE_COPY.processing_failed;

const kindLabel = { fuel: 'Refuel', charge: 'Charge', odometer: 'Odometer' };

const kindMeta = {
  fuel:     { icon: 'fa-gas-pump', tint: 'text-brand bg-brand-light' },
  charge:   { icon: 'fa-bolt',     tint: 'text-brand bg-brand-light' },
  odometer: { icon: 'fa-gauge',    tint: 'text-gray-600 bg-surface' },
};
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
      <h1 class="text-lg font-bold text-gray-800 truncate">Energy logs</h1>
    </div>

    <div class="px-4 sm:px-6 lg:px-8 py-4 space-y-5 w-full pb-safe-bottom">

      <div v-if="device" class="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center text-brand">
          <i class="fa-solid fa-clock-rotate-left"></i>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <p class="text-sm font-bold text-gray-800 truncate">{{ device.name }}</p>
            <SharedBadge :device="device" />
          </div>
          <p class="text-xs text-gray-500 truncate">IMEI {{ deviceImei }}</p>
        </div>
      </div>

      <div v-if="device" class="grid grid-cols-2 gap-3">
        <button
          type="button"
          @click="router.push(`/energy/forms/refuel/${deviceId}`)"
          :disabled="!canLogEnergy"
          class="flex items-center justify-center gap-2 bg-brand-light text-brand py-3 rounded-xl text-sm font-bold cursor-pointer hover:bg-brand-light transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-light"
        >
          <i class="fa-solid fa-gas-pump"></i> Log refuel
        </button>
        <button
          type="button"
          @click="router.push(`/energy/forms/recharge/${deviceId}`)"
          :disabled="!canLogEnergy"
          class="flex items-center justify-center gap-2 bg-brand-light text-brand py-3 rounded-xl text-sm font-bold cursor-pointer hover:bg-brand-light transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-light"
        >
          <i class="fa-solid fa-bolt"></i> Log charge
        </button>
        <button
          type="button"
          @click="router.push(`/energy/forms/odometer/${deviceId}`)"
          :disabled="!canLogEnergy"
          class="flex items-center justify-center gap-2 bg-white text-gray-600 py-3 rounded-xl text-sm font-bold cursor-pointer hover:bg-gray-100 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
        >
          <i class="fa-solid fa-gauge"></i> Odometer
        </button>
        <button
          type="button"
          @click="router.push(`/energy/forms/tank-capacity/${deviceId}`)"
          :disabled="!canLogEnergy"
          class="flex items-center justify-center gap-2 bg-white text-gray-600 py-3 rounded-xl text-sm font-bold cursor-pointer hover:bg-gray-100 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
        >
          <i class="fa-solid fa-oil-can"></i> Tank size
        </button>
        <button
          type="button"
          @click="router.push(`/energy/forms/battery-capacity/${deviceId}`)"
          :disabled="!canLogEnergy"
          class="col-span-2 flex items-center justify-center gap-2 bg-white text-gray-600 py-3 rounded-xl text-sm font-bold cursor-pointer hover:bg-gray-100 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
        >
          <i class="fa-solid fa-car-battery"></i> Battery size
        </button>
      </div>

      <!--
        Entries the API accepted but could not turn into a log row. This is the
        only place they surface: writes are processed AFTER the 200 response, so
        the app has already shown a success toast by the time one of these dies.
        Sits above the month navigator because it is about entries the user
        believes they made, not about the month they are browsing.
      -->
      <div v-if="pendingCount > 0" class="bg-blue-50 text-blue-700 text-sm p-3 rounded-xl border border-blue-100 flex items-start gap-2">
        <i class="fa-solid fa-hourglass-half mt-0.5"></i>
        <div>
          {{ pendingCount }} {{ pendingCount === 1 ? 'entry is' : 'entries are' }} still being processed
          and will appear here shortly.
        </div>
      </div>

      <div v-if="failedEntries.length" class="bg-red-50 rounded-2xl border border-red-100 overflow-hidden">
        <div class="px-4 py-3 border-b border-red-100 flex items-center gap-2">
          <i class="fa-solid fa-circle-exclamation text-red-500"></i>
          <span class="font-bold text-sm text-red-700">
            {{ failedEntries.length }} {{ failedEntries.length === 1 ? 'entry was not saved' : 'entries were not saved' }}
          </span>
        </div>
        <div class="divide-y divide-red-100">
          <div v-for="e in failedEntries" :key="e.id" class="px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-bold text-red-700">{{ kindLabel[e.kind] || e.kind }}</span>
              <span class="text-[11px] text-red-500 shrink-0">{{ formatTime(e.submitted_at) }}</span>
            </div>
            <p class="text-xs text-red-600 mt-1 leading-snug">{{ failureCopy(e) }}</p>
          </div>
        </div>
        <p class="px-4 py-2 text-[11px] text-red-500 leading-snug border-t border-red-100">
          Re-enter these using the buttons above. Nothing was recorded for them.
        </p>
      </div>

      <div class="flex items-center justify-between bg-white rounded-2xl border border-gray-100 px-3 py-2">
        <button
          type="button"
          @click="shiftMonth(-1)"
          aria-label="Previous month"
          class="w-9 h-9 flex items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <i class="fa-solid fa-chevron-left text-sm"></i>
        </button>
        <span class="text-sm font-bold text-gray-800">{{ monthLabel }}</span>
        <button
          type="button"
          @click="shiftMonth(1)"
          :disabled="isCurrentMonth"
          aria-label="Next month"
          class="w-9 h-9 flex items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <i class="fa-solid fa-chevron-right text-sm"></i>
        </button>
      </div>

      <div v-if="loading" class="flex items-center justify-center p-6 text-gray-400 text-sm">
        <InlineLoader label="Loading…" />
      </div>

      <div v-else-if="errorMsg" class="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2">
        <i class="fa-solid fa-circle-exclamation"></i>
        {{ errorMsg }}
      </div>

      <div v-else-if="items.length === 0" class="bg-white rounded-2xl border border-gray-100 p-6 text-center text-sm text-gray-500 leading-snug">
        <div class="w-12 h-12 rounded-full bg-surface flex items-center justify-center text-gray-400 mx-auto mb-3">
          <i class="fa-solid fa-folder-open"></i>
        </div>
        No fuel, charge, or odometer entries this month.
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="item in items"
          :key="`${item.kind}-${item.id}`"
          class="bg-white rounded-2xl border border-gray-100 p-3 flex gap-3"
        >
          <div
            :class="['w-9 h-9 rounded-full flex items-center justify-center shrink-0', kindMeta[item.kind]?.tint || 'text-gray-500 bg-surface']"
          >
            <i :class="['fa-solid', kindMeta[item.kind]?.icon || 'fa-circle-question']" class="text-xs"></i>
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-baseline justify-between gap-2">
              <p class="text-sm font-bold text-gray-800 capitalize">{{ item.kind }}</p>
              <p class="text-xs text-gray-400 whitespace-nowrap">
                {{ formatTime(item.event_at || item.recorded_at) }}
              </p>
            </div>

            <div v-if="item.kind === 'fuel'" class="mt-1 text-xs text-gray-700 leading-snug">
              <span class="font-bold">{{ formatNumber(item.liters_refueled, 2) }} L</span>
              <span v-if="item.amount_paid != null"> · paid {{ formatNumber(item.amount_paid, 2) }}</span>
              <span v-if="item.odometer_km != null"> · odo {{ formatNumber(item.odometer_km, 1) }} km</span>
              <span v-if="item.ending_fuel_eighths != null"> · tank {{ item.ending_fuel_eighths }}/8</span>
            </div>

            <div v-else-if="item.kind === 'charge'" class="mt-1 text-xs text-gray-700 leading-snug">
              <span class="font-bold">{{ formatNumber(item.kwh_added, 2) }} kWh</span>
              <span v-if="item.starting_battery_pct != null && item.ending_battery_pct != null">
                · {{ item.starting_battery_pct }}% → {{ item.ending_battery_pct }}%
              </span>
              <span v-else-if="item.ending_battery_pct != null"> · to {{ item.ending_battery_pct }}%</span>
              <span v-if="item.amount_paid != null"> · paid {{ formatNumber(item.amount_paid, 2) }}</span>
              <span v-if="item.odometer_km != null"> · odo {{ formatNumber(item.odometer_km, 1) }} km</span>
            </div>

            <div v-else-if="item.kind === 'odometer'" class="mt-1 text-xs text-gray-700 leading-snug">
              <span class="font-bold">{{ formatNumber(item.odometer_km, 1) }} km</span>
            </div>

            <p
              v-if="item.station_name || item.station_address"
              class="text-[11px] text-gray-500 truncate mt-1"
            >
              <i class="fa-solid fa-location-dot text-gray-400 mr-1"></i>
              {{ item.station_name || item.station_address }}
            </p>
          </div>
        </div>

        <p v-if="truncated" class="text-[11px] text-amber-600 text-center pt-1 leading-snug">
          Showing the latest 500 entries for this month. Older items in this month are not shown.
        </p>
      </div>

    </div>
  </div>
</template>
