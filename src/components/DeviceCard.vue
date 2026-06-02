<script setup>
// One device row, extracted so a single device's live position update
// re-renders ONLY its own card instead of the whole list — the key
// scalability lever for 100+ device accounts. Online is computed once per
// card here (recency-gated via the store) and reused across the template.
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { useToastStore } from '@/stores/toast.js';
import SharedBadge from '@/components/SharedBadge.vue';
import { hasScope } from '@/utils/scopes';
import { getSignalLevel, getBatteryPercentage, getGpsQuality, getWarnings, formatDate } from '@/utils/deviceMetrics';

const props = defineProps({
  device: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
const emit = defineEmits(['select', 'share']);

const router = useRouter();
const deviceStore = useDevicesStore();
const toast = useToastStore();

// Computed ONCE per card (was called ~5× per render in the old inline template).
const online = computed(() => deviceStore.isDeviceOnline(props.device));
const warnings = computed(() => getWarnings(props.device));
const gps = computed(() => getGpsQuality(props.device));

const lockBusy = ref(false);
const toggleLock = async () => {
  if (lockBusy.value) return;
  lockBusy.value = true;
  try {
    const next = !props.device.attributes?.activity_lock;
    const res = await deviceStore.setActivityLock(props.device.id, next);
    if (!res?.ok) {
      const label = props.device.name || props.device.uniqueId;
      toast.show(`Failed to ${next ? 'lock' : 'unlock'} ${label}.`, { variant: 'error' });
    }
  } finally {
    lockBusy.value = false;
  }
};

const goToHistory = () => router.push(`/history/${props.device.uniqueId}`);
const goToDetails = () => router.push(`/devices/${props.device.id}`);
const goToSettings = () => router.push(`/device/settings/${props.device.id}`);
</script>

<template>
  <div
    @click="emit('select')"
    class="device-card bg-white rounded-xl shadow-sm border p-4 my-2 relative overflow-hidden transition-all duration-200 cursor-pointer"
    :class="[
      warnings.length > 0 ? 'border-red-200' : 'border-gray-200',
      selected ? 'ring-2 ring-brand shadow-md' : 'hover:shadow-md'
    ]"
  >
    <div class="flex items-start mb-3">
      <div class="p-2 rounded-full bg-brand-light text-brand mr-3">
        <i class="fa-solid fa-truck text-lg"></i>
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-bold text-gray-800 leading-tight truncate">{{ device.name || 'Unnamed Tracker' }}</h2>
          <SharedBadge :device="device" />
          <button
            v-if="hasScope(device, 'share:public')"
            @click.stop="emit('share')"
            class="w-6 h-6 flex items-center justify-center bg-gray-100 text-gray-500 rounded-full hover:bg-gray-200 transition-colors shrink-0"
            aria-label="Share tracking link"
          >
            <i class="fa-solid fa-share-nodes text-xs"></i>
          </button>
        </div>
        <p class="text-[11px] text-gray-400 font-mono mt-0.5 truncate">IMEI: {{ device.uniqueId }}</p>
      </div>

      <div class="flex items-center space-x-1.5 px-2 py-1 rounded-md border shrink-0 ml-2"
          :class="online ? 'bg-green-50 border-green-100 text-green-600' : 'bg-red-50 border-red-100 text-red-600'">
        <span class="relative flex h-2.5 w-2.5">
          <span v-if="online" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2.5 w-2.5" :class="online ? 'bg-green-500' : 'bg-red-500'"></span>
        </span>
        <span class="text-[10px] font-bold uppercase tracking-wider">
          {{ online ? 'ONLINE' : 'OFFLINE' }}
        </span>
      </div>
    </div>

    <div v-if="warnings.length > 0" class="mb-4 bg-red-50 border border-red-100 rounded-lg p-2.5 flex items-start gap-2">
      <i class="fa-solid fa-triangle-exclamation text-red-500 mt-0.5 text-xs"></i>
      <div class="flex flex-col">
        <span v-for="(warn, idx) in warnings" :key="idx" class="text-xs font-semibold text-red-700 leading-tight">
          {{ warn }}
        </span>
      </div>
    </div>

    <div :class="{ 'opacity-60 saturate-50': !online }">

      <div class="grid grid-cols-2 gap-2 mb-4">
        <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
          <div class="w-6 text-brand text-center"><i class="fa-solid fa-gauge-high"></i></div>
          <span class="font-medium ml-1">{{ device.speed ? Math.round(device.speed * 1.852) : 0 }} km/h</span>
        </div>

        <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
          <div class="w-6 text-center" :class="device.ignition ? 'text-green-500' : 'text-gray-400'">
            <i class="fa-solid fa-key"></i>
          </div>
          <span class="font-medium ml-1">{{ device.ignition ? 'On' : 'Off' }}</span>
        </div>

        <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
          <div class="w-6 text-accent text-center"><i class="fa-solid fa-bolt"></i></div>
          <span class="font-medium ml-1">{{ device.power !== undefined ? `${Number(device.power).toFixed(2)}V` : 'N/A' }}</span>
        </div>

        <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
          <div class="w-6 text-green-500 text-center"><i class="fa-solid fa-battery-full"></i></div>
          <span class="font-medium ml-1">{{ getBatteryPercentage(device.battery) }}</span>
        </div>

        <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
          <div class="w-6 text-purple-500 text-center"><i class="fa-solid fa-signal"></i></div>
          <span class="font-medium ml-1 uppercase text-xs">{{ getSignalLevel(device.signalLevel) }}</span>
        </div>

        <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
          <div class="w-6 text-center" :class="gps.color">
            <i class="fa-solid" :class="gps.icon"></i>
          </div>
          <span class="font-medium ml-1 text-xs">{{ gps.label }}</span>
          <span v-if="device.sat" class="ml-auto text-[10px] text-gray-400 font-mono">{{ device.sat }} sats</span>
        </div>
      </div>

      <div class="pt-3 border-t border-gray-100">
        <div class="flex items-start text-xs text-gray-600 mb-2">
          <div class="w-5 mt-0.5 text-gray-400 text-center"><i class="fa-solid fa-location-dot"></i></div>
          <span class="line-clamp-1 leading-tight">{{ device.address || 'Address calculating...' }}</span>
        </div>
        <div class="flex items-center text-[10px] text-gray-400 pl-1">
          <i class="fa-regular fa-clock mr-1.5"></i>
          Updated: {{ formatDate(device.lastUpdate) }}
        </div>
      </div>

    </div>

    <div v-if="selected" class="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center animate-fade-in gap-2">

      <button
        @click.stop="goToSettings"
        :disabled="!hasScope(device, 'energy:read')"
        :title="hasScope(device, 'energy:read') ? '' : 'Settings not available for this share'"
        class="flex-1 flex flex-col items-center justify-center bg-surface hover:bg-gray-100 py-2 rounded-lg transition-colors group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface"
      >
        <i class="fa-solid fa-gear text-lg text-gray-500 group-hover:text-brand mb-1"></i>
        <span class="text-[10px] font-bold text-gray-600 group-hover:text-brand">Settings</span>
      </button>

      <button
        @click.stop="goToHistory"
        :disabled="!hasScope(device, 'history:read')"
        :title="hasScope(device, 'history:read') ? '' : 'History access not granted'"
        class="flex-1 flex flex-col items-center justify-center bg-surface hover:bg-gray-100 py-2 rounded-lg transition-colors group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface"
      >
        <i class="fa-solid fa-clock-rotate-left text-lg text-gray-500 group-hover:text-brand mb-1"></i>
        <span class="text-[10px] font-bold text-gray-600 group-hover:text-brand">History</span>
      </button>

      <button @click.stop="goToDetails" class="flex-1 flex flex-col items-center justify-center bg-surface hover:bg-gray-100 py-2 rounded-lg transition-colors group">
        <i class="fa-solid fa-circle-info text-lg text-gray-500 group-hover:text-brand mb-1"></i>
        <span class="text-[10px] font-bold text-gray-600 group-hover:text-brand">Details</span>
      </button>

      <button
        @click.stop="toggleLock"
        :disabled="device.shared || lockBusy"
        :aria-label="device.attributes?.activity_lock ? 'Unlock device' : 'Lock device'"
        :title="device.shared ? 'Activity lock can only be controlled by the device owner' : ''"
        class="flex-1 flex flex-col items-center justify-center bg-surface hover:bg-gray-100 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface"
      >
        <i v-if="lockBusy" class="fa-solid fa-circle-notch fa-spin text-lg text-gray-500 mb-1"></i>
        <i
          v-else
          :class="[
            'text-lg mb-1',
            device.attributes?.activity_lock ? 'fa-solid fa-lock text-red-500' : 'fa-solid fa-lock-open text-green-600',
          ]"
        ></i>
        <span
          class="text-[10px] font-bold"
          :class="device.attributes?.activity_lock ? 'text-red-500' : 'text-green-600'"
        >
          {{ device.attributes?.activity_lock ? 'Locked' : 'Unlocked' }}
        </span>
      </button>

    </div>

  </div>
</template>

<style scoped>
/* Render-virtualization without a windowing library: the browser skips layout
 * + paint for off-screen cards while keeping them in the DOM (so scroll and
 * measurement just work). `auto` intrinsic-size remembers each card's last
 * measured height, so variable/expanded heights don't jump. Degrades to normal
 * rendering on engines without content-visibility (older WKWebView). */
.device-card {
  content-visibility: auto;
  contain-intrinsic-size: auto 220px;
}

.animate-fade-in {
  animation: fadeIn 0.2s ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
