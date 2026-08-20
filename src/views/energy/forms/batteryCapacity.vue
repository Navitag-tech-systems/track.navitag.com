<script setup>
/**
 * Battery capacity — the EV counterpart to tankCapacity.vue.
 *
 * WHY THIS EXISTS. `POST /energy/baselines/{imei}` has always accepted
 * `battery_capacity_kwh`, and computeChargeMetrics needs it to convert a
 * battery-percentage delta into kWh — exactly as tank capacity converts a fuel
 * gauge into liters. But nothing in the app ever sent it: there was no route and
 * no form, only "Tank size".
 *
 * The one remaining path was self-inference, which requires a charge log
 * carrying `starting_battery_pct` with a >= 20 point delta — and that field is
 * optional on the charge form. So an EV owner who left it blank saw "battery
 * capacity needed for accurate reporting" with nothing in the product able to
 * resolve it.
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { useUserStore } from '@/stores/user.js';
import { useToastStore } from '@/stores/toast.js';
import { request } from '@/utils/http.js';
import { baseUrl } from '@/utils/variables';
import { hasScope } from '@/utils/scopes';
import SharedBadge from '@/components/SharedBadge.vue';
import InlineLoader from '@/components/InlineLoader.vue';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();
const userStore = useUserStore();
const toast = useToastStore();

const deviceId = route.params.id;
const device = computed(() => deviceStore.devices[deviceId]);
const deviceImei = computed(() => device.value?.uniqueId || '');

const canWriteEnergy = computed(() => hasScope(device.value, 'energy:write'));

const batteryKwh = ref('');

const submitting = ref(false);
const errorMsg = ref('');

const existingBattery = computed(() => {
  const v = device.value?.attributes?.battery_capacity;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
});

// The backend annotates an inferred capacity through energy_metric_alerts rather
// than a sentinel, so read that rather than inventing a second convention.
const isEstimated = computed(() => {
  const raw = device.value?.attributes?.energy_metric_alerts;
  if (!raw) return false;
  try {
    const parsed = typeof raw === 'object' ? raw : JSON.parse(raw);
    return typeof parsed?.battery_capacity === 'string';
  } catch {
    return false;
  }
});

const battNum = computed(() => {
  const raw = String(batteryKwh.value).trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
});
// Matches the backend's (0, 500] validation on battery_capacity_kwh.
const isBattValid = computed(() => battNum.value !== null && battNum.value > 0 && battNum.value <= 500);

const canSubmit = computed(() =>
  !submitting.value && !!deviceImei.value && canWriteEnergy.value && isBattValid.value
  && Number(battNum.value) !== Number(existingBattery.value)
);

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMsg.value = '';
  try {
    await request.send({
      url: `${baseUrl}/energy/baselines/${deviceImei.value}`,
      method: 'POST',
      data: { battery_capacity_kwh: battNum.value },
      token: userStore.idToken,
    });
    toast.show('Battery capacity saved.', { variant: 'success' });
    router.back();
  } catch (err) {
    console.error('Failed to set battery capacity:', err);
    errorMsg.value = err?.message || 'Failed to save battery capacity.';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  if (!device.value) {
    errorMsg.value = 'Device not found.';
    return;
  }
  if (existingBattery.value != null) batteryKwh.value = String(existingBattery.value);
});
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
      <h1 class="text-lg font-bold text-gray-800 truncate">Battery Capacity</h1>
    </div>

    <div class="p-4 space-y-6 max-w-md mx-auto w-full pb-safe-bottom">

      <div v-if="device" class="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center text-brand">
          <i class="fa-solid fa-car-battery"></i>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <p class="text-sm font-bold text-gray-800 truncate">{{ device.name }}</p>
            <SharedBadge :device="device" />
          </div>
          <p class="text-xs text-gray-500 truncate">IMEI {{ deviceImei }}</p>
        </div>
      </div>

      <div v-if="device && !canWriteEnergy" class="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-start gap-2">
        <i class="fa-solid fa-circle-exclamation mt-0.5"></i>
        <div>
          This device was shared without energy-write access. Ask the owner to grant the
          <span class="font-bold">Energy data (write)</span> scope.
        </div>
      </div>

      <form v-if="!device || canWriteEnergy" @submit.prevent="submit" class="space-y-6">

        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 class="text-lg font-bold text-gray-800">Battery pack size</h2>

          <div v-if="existingBattery && isEstimated" class="bg-amber-50 text-amber-700 text-sm p-3 rounded-xl border border-amber-100 flex items-start gap-2">
            <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
            <div>
              An <span class="font-bold">estimated</span> capacity of
              <span class="font-bold">{{ existingBattery }} kWh</span> is in use, worked out from your
              charge history. Entering the manufacturer figure replaces it.
            </div>
          </div>

          <div v-else-if="existingBattery" class="bg-blue-50 text-blue-700 text-sm p-3 rounded-xl border border-blue-100 flex items-start gap-2">
            <i class="fa-solid fa-circle-info mt-0.5"></i>
            <div>
              Currently set to <span class="font-bold">{{ existingBattery }} kWh</span>.
              Edit the value below to correct it.
            </div>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Capacity <span class="text-red-500">*</span></label>
            <div class="relative">
              <i class="fa-solid fa-car-battery absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                v-model="batteryKwh"
                type="text"
                inputmode="decimal"
                placeholder="e.g. 64"
                :disabled="submitting"
                class="w-full pl-11 pr-16 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase tracking-wider">kWh</span>
            </div>
            <p v-if="batteryKwh !== '' && !isBattValid" class="text-xs text-red-500 mt-1.5">
              Enter a value between 0 and 500 kWh.
            </p>
            <p class="text-xs text-gray-500 mt-2 leading-snug">
              Use the usable pack size from your owner's manual. Used to convert battery-level
              readings into kWh, so charge efficiency is only as accurate as this number.
            </p>
          </div>
        </div>

        <div v-if="errorMsg" class="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2">
          <i class="fa-solid fa-circle-exclamation"></i>
          {{ errorMsg }}
        </div>

        <button
          type="submit"
          :disabled="!canSubmit"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <InlineLoader v-if="submitting" />
          <i v-else class="fa-solid fa-check"></i>
          {{ submitting ? 'Saving…' : 'Save Capacity' }}
        </button>
      </form>

    </div>
  </div>
</template>
