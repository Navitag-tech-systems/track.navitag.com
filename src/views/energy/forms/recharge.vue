<script setup>
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

const kwhAdded = ref('');
const startingPct = ref('');
const endingPct = ref('');
const amountPaid = ref('');
const odometerKm = ref('');
const stationName = ref('');
const stationAddress = ref('');
const useCurrentTime = ref(true);
const eventAtLocal = ref('');

const submitting = ref(false);
const errorMsg = ref('');

const kwhNum = computed(() => {
  const n = Number(String(kwhAdded.value).trim());
  return Number.isFinite(n) ? n : null;
});
const isKwhValid = computed(() => kwhNum.value !== null && kwhNum.value > 0 && kwhNum.value <= 500);

function parseIntOrNull(raw) {
  const s = String(raw).trim();
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
}

const startNum = computed(() => parseIntOrNull(startingPct.value));
const endNum = computed(() => parseIntOrNull(endingPct.value));

const isStartValid = computed(() => {
  if (startingPct.value === '') return true;
  return Number.isInteger(startNum.value) && startNum.value >= 0 && startNum.value <= 100;
});
const isEndValid = computed(() => {
  if (endingPct.value === '') return false;
  return Number.isInteger(endNum.value) && endNum.value >= 0 && endNum.value <= 100;
});
const isOrderValid = computed(() => {
  if (startingPct.value === '' || endingPct.value === '') return true;
  if (!isStartValid.value || !isEndValid.value) return true;
  return endNum.value > startNum.value;
});

const amountNum = computed(() => {
  const raw = String(amountPaid.value).trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
});
const isAmountValid = computed(() => amountPaid.value === '' || (amountNum.value !== null && amountNum.value >= 0));

const odoNum = computed(() => {
  const raw = String(odometerKm.value).trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
});
const isOdoValid = computed(() => odometerKm.value === '' || (odoNum.value !== null && odoNum.value >= 0 && odoNum.value <= 9999999));

const canSubmit = computed(() =>
  !submitting.value &&
  !!deviceImei.value &&
  canWriteEnergy.value &&
  isKwhValid.value &&
  isStartValid.value &&
  isEndValid.value &&
  isOrderValid.value &&
  isAmountValid.value &&
  isOdoValid.value
);

function buildEventAt() {
  if (useCurrentTime.value) return undefined;
  const raw = eventAtLocal.value;
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMsg.value = '';
  try {
    const body = {
      imei: deviceImei.value,
      kwh_added: kwhNum.value,
    };
    if (startingPct.value !== '') body.starting_battery_pct = startNum.value;
    body.ending_battery_pct = endNum.value;
    if (amountPaid.value !== '') body.amount_paid = amountNum.value;
    if (odometerKm.value !== '') body.odometer_km = odoNum.value;
    if (stationName.value.trim()) body.station_name = stationName.value.trim();
    if (stationAddress.value.trim()) body.station_address = stationAddress.value.trim();
    const eventAt = buildEventAt();
    if (eventAt) body.event_at = eventAt;

    await request.send({
      url: `${baseUrl}/energy/charge`,
      method: 'POST',
      data: body,
      token: userStore.idToken,
    });
    toast.show('Charge logged.', { variant: 'success' });
    router.back();
  } catch (err) {
    console.error('Failed to log charge:', err);
    errorMsg.value = err?.message || 'Failed to log charge.';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  if (!device.value) {
    errorMsg.value = 'Device not found.';
  }
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
      <h1 class="text-lg font-bold text-gray-800 truncate">Log Charge</h1>
    </div>

    <div class="p-4 space-y-6 max-w-md mx-auto w-full pb-safe-bottom">

      <div v-if="device" class="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center text-brand">
          <i class="fa-solid fa-bolt"></i>
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
          <h2 class="text-lg font-bold text-gray-800">Charge</h2>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">kWh added <span class="text-red-500">*</span></label>
            <div class="relative">
              <i class="fa-solid fa-bolt absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                v-model="kwhAdded"
                type="text"
                inputmode="decimal"
                placeholder="e.g. 18.2"
                :disabled="submitting"
                class="w-full pl-11 pr-16 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
              />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase tracking-wider">kWh</span>
            </div>
            <p v-if="kwhAdded !== '' && !isKwhValid" class="text-xs text-red-500 mt-1.5">
              Enter a value between 0 and 500 kWh.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-2">Start %</label>
              <div class="relative">
                <input
                  v-model="startingPct"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="3"
                  placeholder="e.g. 22"
                  :disabled="submitting"
                  class="w-full pl-4 pr-9 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
                />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">%</span>
              </div>
              <p v-if="startingPct !== '' && !isStartValid" class="text-xs text-red-500 mt-1.5">
                0–100 integer.
              </p>
            </div>
            <div>
              <label class="block text-sm font-bold text-gray-700 mb-2">End % <span class="text-red-500">*</span></label>
              <div class="relative">
                <input
                  v-model="endingPct"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="3"
                  placeholder="e.g. 80"
                  :disabled="submitting"
                  class="w-full pl-4 pr-9 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
                />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">%</span>
              </div>
              <p v-if="endingPct !== '' && !isEndValid" class="text-xs text-red-500 mt-1.5">
                0–100 integer.
              </p>
            </div>
          </div>
          <p v-if="!isOrderValid" class="text-xs text-red-500 -mt-2">
            End % must be greater than start %.
          </p>
          <p class="text-xs text-gray-500 leading-snug">
            Providing the start % each charge improves battery capacity inference.
          </p>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 class="text-lg font-bold text-gray-800">Details <span class="text-xs font-normal text-gray-400">(optional)</span></h2>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Amount paid</label>
            <div class="relative">
              <i class="fa-solid fa-money-bill-wave absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                v-model="amountPaid"
                type="text"
                inputmode="decimal"
                placeholder="e.g. 320.00"
                :disabled="submitting"
                class="w-full pl-11 pr-4 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
              />
            </div>
            <p v-if="amountPaid !== '' && !isAmountValid" class="text-xs text-red-500 mt-1.5">
              Must be 0 or greater.
            </p>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Odometer</label>
            <div class="relative">
              <i class="fa-solid fa-gauge absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                v-model="odometerKm"
                type="text"
                inputmode="decimal"
                placeholder="e.g. 7820.4"
                :disabled="submitting"
                class="w-full pl-11 pr-16 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
              />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase tracking-wider">km</span>
            </div>
            <p v-if="odometerKm !== '' && !isOdoValid" class="text-xs text-red-500 mt-1.5">
              Must be between 0 and 9,999,999.
            </p>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Station name</label>
            <div class="relative">
              <i class="fa-solid fa-charging-station absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                v-model="stationName"
                type="text"
                placeholder="e.g. Tesla Supercharger"
                :disabled="submitting"
                class="w-full pl-11 pr-4 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Station address</label>
            <div class="relative">
              <i class="fa-solid fa-location-dot absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                v-model="stationAddress"
                type="text"
                placeholder="e.g. SM Megamall"
                :disabled="submitting"
                class="w-full pl-11 pr-4 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">When</label>
            <div class="p-3 border border-gray-200 rounded-xl bg-surface mb-2">
              <label class="relative flex items-center justify-between w-full cursor-pointer">
                <input
                  type="checkbox"
                  v-model="useCurrentTime"
                  :disabled="submitting"
                  class="sr-only peer"
                />
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-light rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                <span class="text-md font-medium text-gray-900">Use current time</span>
              </label>
            </div>
            <input
              v-if="!useCurrentTime"
              v-model="eventAtLocal"
              type="datetime-local"
              :disabled="submitting"
              class="w-full px-4 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
            />
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
          {{ submitting ? 'Saving…' : 'Log Charge' }}
        </button>
      </form>

    </div>
  </div>
</template>
