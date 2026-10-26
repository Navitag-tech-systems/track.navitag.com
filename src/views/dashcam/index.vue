<script setup>
// /dashcam/:deviceId — Live | Clips | Settings for one dashcam (V5-C or V5N,
// up to 4 cameras). Tabs are v-if'd so leaving Live unmounts LiveStream, which
// sends videoStop for every camera it started; clip playback goes through
// Traccar's per-channel HLS endpoint instead.
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { isDashcam } from '@/utils/dashcam';
import SharedBadge from '@/components/SharedBadge.vue';
import LiveStream from '@/components/dashcam/LiveStream.vue';
import ClipBrowser from '@/components/dashcam/ClipBrowser.vue';
import DashcamConfig from '@/components/dashcam/DashcamConfig.vue';
import ChannelSelect from '@/components/dashcam/ChannelSelect.vue';
import { demoEnabled, loadManifest } from '@/utils/dashcamDemo';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();

const deviceId = route.params.deviceId;
const device = computed(() => deviceStore.devices[deviceId]);
const capable = computed(() => isDashcam(device.value));

const TABS = [
  { key: 'live', label: 'Live', icon: 'fa-video' },
  { key: 'clips', label: 'Clips', icon: 'fa-film' },
  { key: 'settings', label: 'Settings', icon: 'fa-gear' },
];
// Demo media (scripts/medusa/dashcam-demo): when this device has a manifest,
// the page is the channel picker for the Live / Playback viewer instead of
// the device-command tabs below.
const manifest = ref(null);
const manifestChecked = ref(!demoEnabled());
watch(() => device.value?.uniqueId, async (uid) => {
  if (!uid || !demoEnabled()) return;
  manifest.value = await loadManifest(uid);
  manifestChecked.value = true;
}, { immediate: true });

const tab = ref(TABS.some((t) => t.key === route.query.tab) ? route.query.tab : 'live');

function pick(key) {
  tab.value = key;
  router.replace({ query: { ...route.query, tab: key } });
}
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface relative z-10 pointer-events-auto">
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200 safe-top">
      <div class="p-4 flex items-center">
        <button
          @click="router.back()"
          class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none"
          aria-label="Back"
        >
          <i class="fa-solid fa-arrow-left text-lg"></i>
        </button>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h1 class="text-lg font-bold text-gray-800 truncate">{{ device?.name || 'Dashcam' }}</h1>
            <SharedBadge v-if="device" :device="device" />
          </div>
          <p v-if="device" class="text-[11px] text-gray-400 font-mono truncate">{{ device.uniqueId }}</p>
        </div>
      </div>

      <div v-if="device && capable && manifestChecked && !manifest" class="flex border-t border-gray-100">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          @click="pick(t.key)"
          class="flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors"
          :class="tab === t.key ? 'border-brand text-brand' : 'border-transparent text-gray-400 hover:text-gray-600'"
        >
          <i class="fa-solid" :class="t.icon"></i>
          {{ t.label }}
        </button>
      </div>
    </div>

    <div v-if="!device" class="p-10 text-center text-gray-500">
      <p v-if="!deviceStore.hasLoadedOnce">Loading…</p>
      <p v-else>Device not found.</p>
    </div>

    <div v-else-if="!capable" class="p-10 text-center text-gray-500">
      <i class="fa-solid fa-video-slash text-3xl text-gray-300 mb-3"></i>
      <p>This device has no camera.</p>
    </div>

    <div v-else-if="!manifestChecked" class="p-10 text-center text-gray-500">Loading…</div>

    <div v-else-if="manifest" class="p-4 pb-10 max-w-2xl mx-auto w-full">
      <ChannelSelect :device="device" :manifest="manifest" />
    </div>

    <div v-else class="p-4 pb-10 max-w-md mx-auto w-full">
      <LiveStream v-if="tab === 'live'" :device="device" />
      <ClipBrowser v-else-if="tab === 'clips'" :device="device" />
      <DashcamConfig v-else :device="device" />
    </div>
  </div>
</template>
