<script setup>
// Channel picker: Live or Playback, then one of the camera channels. Picking a
// channel opens the combined video + map viewer.
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { mediaUrl, fmtDay } from '@/utils/dashcamDemo';

const props = defineProps({
  device: { type: Object, required: true },
  manifest: { type: Object, required: true },
});

const router = useRouter();
const route = useRoute();

const hasLive = computed(() => !!props.manifest.live);
const hasClips = computed(() => props.manifest.clips.length > 0);
const mode = ref(route.query.mode === 'playback' || !hasLive.value ? 'playback' : 'live');

function setMode(m) {
  mode.value = m;
  router.replace({ query: { ...route.query, mode: m } });
}

// Channels that actually have footage in the chosen mode.
function available(ch) {
  const key = String(ch.index);
  if (mode.value === 'live') return !!props.manifest.live?.videos?.[key];
  return props.manifest.clips.some((c) => c.videos?.[key]);
}

function clipCount(ch) {
  const key = String(ch.index);
  return props.manifest.clips.filter((c) => c.videos?.[key]).length;
}

const latestClip = computed(() => props.manifest.clips[0] || null);

function open(ch) {
  if (!available(ch)) return;
  router.push({
    name: 'dashcam-view',
    params: { deviceId: props.device.id },
    query: { mode: mode.value, ch: ch.index },
  });
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex bg-gray-100 rounded-xl p-1">
      <button
        type="button"
        :disabled="!hasLive"
        @click="setMode('live')"
        class="flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
        :class="mode === 'live' ? 'bg-white shadow-sm text-red-600' : 'text-gray-500'"
      >
        <span class="w-2 h-2 rounded-full" :class="mode === 'live' ? 'bg-red-600 animate-pulse' : 'bg-gray-400'"></span>
        Live
      </button>
      <button
        type="button"
        :disabled="!hasClips"
        @click="setMode('playback')"
        class="flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
        :class="mode === 'playback' ? 'bg-white shadow-sm text-brand' : 'text-gray-500'"
      >
        <i class="fa-solid fa-clock-rotate-left"></i>
        Playback
      </button>
    </div>

    <p class="text-xs text-gray-500 px-1">
      <template v-if="mode === 'live'">Select a camera to watch it live with the vehicle's position.</template>
      <template v-else>
        Select a camera to replay its recordings with the route driven.
        <span v-if="latestClip"> Latest: {{ fmtDay(new Date(latestClip.start)) }}.</span>
      </template>
    </p>

    <div class="grid grid-cols-2 gap-3">
      <button
        v-for="ch in manifest.channels"
        :key="ch.index"
        type="button"
        @click="open(ch)"
        :disabled="!available(ch)"
        class="group text-left bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition hover:shadow-md hover:border-brand disabled:opacity-40 disabled:hover:shadow-sm disabled:hover:border-gray-200"
      >
        <div class="relative aspect-video bg-gray-900">
          <img
            v-if="ch.poster"
            :src="mediaUrl(manifest.uniqueId || device.uniqueId, ch.poster)"
            :alt="`Channel ${ch.index}`"
            class="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
          <div v-else class="absolute inset-0 flex items-center justify-center text-gray-600">
            <i class="fa-solid fa-video text-2xl"></i>
          </div>
          <span
            v-if="mode === 'live' && available(ch)"
            class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold tracking-wide flex items-center gap-1"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> LIVE
          </span>
          <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
            <span class="w-11 h-11 rounded-full bg-black/55 flex items-center justify-center text-white">
              <i class="fa-solid fa-play ml-0.5"></i>
            </span>
          </div>
        </div>
        <div class="px-3 py-2">
          <div class="text-sm font-bold text-gray-800">CH{{ ch.index }} · {{ ch.name }}</div>
          <div class="text-[11px] text-gray-400">
            <template v-if="mode === 'live'">{{ available(ch) ? 'Streaming' : 'No signal' }}</template>
            <template v-else>{{ clipCount(ch) }} recording{{ clipCount(ch) === 1 ? '' : 's' }}</template>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
