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

const odometerKm = ref('');

const submitting = ref(false);
const errorMsg = ref('');

const odoNum = computed(() => {
  const raw = String(odometerKm.value).trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
});
const isOdoValid = computed(() => odoNum.value !== null && odoNum.value >= 0 && odoNum.value <= 9999999);

const canSubmit = computed(() =>
  !submitting.value && !!deviceImei.value && canWriteEnergy.value && isOdoValid.value
);

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMsg.value = '';
  try {
    await request.send({
      url: `${baseUrl}/energy/odometer`,
      method: 'POST',
      data: {
        imei: deviceImei.value,
        odometer_km: odoNum.value,
      },
      token: userStore.idToken,
    });
    toast.show('Odometer updated.', { variant: 'success' });
    router.back();
  } catch (err) {
    console.error('Failed to update odometer:', err);
    errorMsg.value = err?.message || 'Failed to update odometer.';
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
      <h1 class="text-lg font-bold text-gray-800 truncate">Update Odometer</h1>
    </div>

    <div class="p-4 space-y-6 max-w-md mx-auto w-full pb-safe-bottom">

      <div v-if="device" class="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center text-brand">
          <i class="fa-solid fa-gauge"></i>
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
          <h2 class="text-lg font-bold text-gray-800">Reading</h2>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Current odometer <span class="text-red-500">*</span></label>
            <div class="relative">
              <i class="fa-solid fa-gauge absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                v-model="odometerKm"
                type="text"
                inputmode="decimal"
                placeholder="e.g. 12420.1"
                :disabled="submitting"
                class="w-full pl-11 pr-16 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
              />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase tracking-wider">km</span>
            </div>
            <p v-if="odometerKm !== '' && !isOdoValid" class="text-xs text-red-500 mt-1.5">
              Enter a value between 0 and 9,999,999 km.
            </p>
            <p class="text-xs text-gray-500 mt-2 leading-snug">
              The reading is applied as the current value and pushed to your device's distance counter.
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
          {{ submitting ? 'Saving…' : 'Update Odometer' }}
        </button>
      </form>

    </div>
  </div>
</template>
