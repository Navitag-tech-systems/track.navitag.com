<script setup>
// Plays one recorded clip. Two strategies behind a single Play action:
//   synced  — the hub-sync job has uploaded the mp4 to DASHCAM_MEDIA_BASE;
//             plain <video>. Decided by a HEAD request.
//   remote  — ask the dashcam to push the clip to the Traccar jt1078
//             receiver (9201); the same live.m3u8 URL then carries the
//             playback. 9202 stop on close/unmount.
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import InlineLoader from '@/components/InlineLoader.vue';
import HlsVideo from './HlsVideo.vue';
import {
  clipUrl, clipIsSynced, body9201, body9202, customCommand, sendCommand,
  hlsUrl, waitForHls, clipDurationSec, formatDuration, formatMB,
} from '@/utils/dashcam';

const props = defineProps({
  device: { type: Object, required: true },
  clip: { type: Object, required: true },
});
const emit = defineEmits(['close']);

const userStore = useUserStore();
const server = computed(() => userStore.server_url);

// checking | synced | unsynced | starting | playing | stopped | error
const state = ref('checking');
const strategy = ref(null); // 'synced' | 'remote'
const src = ref('');
const errorMsg = ref('');
let abort = null;
let remoteActive = false;

const syncedUrl = computed(() => clipUrl(props.device.uniqueId, props.clip));
const dateLabel = computed(() => props.clip.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
const timeLabel = computed(() => {
  const f = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${f(props.clip.start)} – ${f(props.clip.end)}`;
});

async function check() {
  state.value = 'checking';
  src.value = '';
  const ok = await clipIsSynced(syncedUrl.value);
  state.value = ok ? 'synced' : 'unsynced';
}

function playSynced() {
  strategy.value = 'synced';
  src.value = syncedUrl.value;
  state.value = 'playing';
}

async function playRemote() {
  if (!server.value) return;
  strategy.value = 'remote';
  state.value = 'starting';
  errorMsg.value = '';
  abort = new AbortController();
  const ch = props.clip.ch;

  try {
    await sendCommand(server.value, props.device.id, customCommand('9201', body9201({
      ch,
      start: props.clip.start,
      end: props.clip.end,
    })));
    remoteActive = true;
  } catch (err) {
    state.value = 'error';
    errorMsg.value = err?.status === 403
      ? 'You do not have permission to control this dashcam.'
      : (err?.message || 'Could not send the playback command.');
    return;
  }

  const url = hlsUrl(server.value, props.device.id, ch);
  try {
    await waitForHls(url, 45_000, { signal: abort.signal });
  } catch (err) {
    if (err?.message === 'aborted') return;
    state.value = 'error';
    errorMsg.value = 'The dashcam did not start playback within 45 s.';
    await stopRemote();
    return;
  }
  src.value = `${url}?t=${Date.now()}`;
  state.value = 'playing';
}

async function stopRemote() {
  if (abort) { abort.abort(); abort = null; }
  if (!remoteActive || !server.value) return;
  remoteActive = false;
  try {
    await sendCommand(server.value, props.device.id, customCommand('9202', body9202(props.clip.ch, 2)));
  } catch { /* best effort */ }
}

async function stop() {
  src.value = '';
  await stopRemote();
  state.value = strategy.value === 'remote' ? 'stopped' : 'synced';
}

function onPlayerError(msg) {
  if (state.value !== 'playing') return;
  state.value = 'error';
  errorMsg.value = msg || 'Playback failed.';
  stopRemote();
}

async function close() {
  src.value = '';
  await stopRemote();
  emit('close');
}

watch(() => props.clip?.id, () => { stopRemote(); check(); }, { immediate: true });
onBeforeRouteLeave(() => { stopRemote(); });
onBeforeUnmount(() => { stopRemote(); });
</script>

<template>
  <div class="fixed inset-0 z-40 bg-black/80 flex flex-col justify-end sm:justify-center sm:items-center" @click.self="close">
    <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden pb-safe-bottom">
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div class="min-w-0">
          <p class="text-sm font-bold text-gray-800 truncate">{{ dateLabel }} · {{ timeLabel }}</p>
          <p class="text-[11px] text-gray-400">
            Ch {{ clip.ch }} · {{ formatDuration(clipDurationSec(clip)) }} · {{ formatMB(clip.size) }}
            <span v-if="clip.alarm" class="ml-1 text-red-500 font-bold">ALARM</span>
          </p>
        </div>
        <button type="button" @click="close" class="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded-full" aria-label="Close">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <div class="relative aspect-video bg-black">
        <HlsVideo v-if="src" :src="src" :native="strategy === 'synced'" :muted="false" @error="onPlayerError" />

        <div v-if="state === 'checking' || state === 'starting'" class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white">
          <InlineLoader size="2xl" class="text-white mb-3" />
          <p class="text-sm font-bold">{{ state === 'checking' ? 'Checking cloud copy…' : 'Asking the dashcam to play…' }}</p>
          <p v-if="state === 'starting'" class="text-xs text-white/70 mt-1">Usually 5–15 s on LTE</p>
        </div>

        <div v-else-if="state === 'error'" class="absolute inset-0 flex flex-col items-center justify-center text-red-200 px-6 text-center">
          <i class="fa-solid fa-triangle-exclamation text-3xl mb-2 text-red-400"></i>
          <p class="text-sm leading-snug">{{ errorMsg }}</p>
        </div>

        <div v-else-if="state !== 'playing'" class="absolute inset-0 flex flex-col items-center justify-center text-white/80">
          <i class="fa-solid fa-film text-4xl mb-2 text-white/60"></i>
          <p v-if="state === 'unsynced'" class="text-xs text-white/70">Not yet synced to the cloud</p>
          <p v-else-if="state === 'stopped'" class="text-xs text-white/70">Playback stopped</p>
        </div>
      </div>

      <div class="p-4 space-y-2">
        <button
          v-if="state === 'synced'"
          type="button"
          @click="playSynced"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <i class="fa-solid fa-cloud"></i> Play synced copy
        </button>

        <button
          v-if="state === 'unsynced' || state === 'stopped' || state === 'error'"
          type="button"
          @click="playRemote"
          :disabled="!server"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
        >
          <i class="fa-solid fa-satellite-dish"></i> {{ state === 'error' ? 'Retry from dashcam' : 'Play from dashcam' }}
        </button>

        <button
          v-if="state === 'starting' || state === 'playing'"
          type="button"
          @click="stop"
          class="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <i class="fa-solid fa-stop"></i> {{ state === 'starting' ? 'Cancel' : 'Stop' }}
        </button>

        <p v-if="state === 'unsynced'" class="text-[11px] text-gray-400 leading-snug">
          Streams the clip from the dashcam over LTE (~{{ formatMB(clip.size) }}). It will sync to the cloud automatically when the vehicle reaches the hub WiFi.
        </p>
      </div>
    </div>
  </div>
</template>
