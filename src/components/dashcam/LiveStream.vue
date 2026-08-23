<script setup>
// Live view for one dashcam. Only ONE live stream per device at a time, so
// switching channel stops the current one first, and the component always
// sends videoStop on unmount / route leave.
import { ref, computed, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useToastStore } from '@/stores/toast.js';
import InlineLoader from '@/components/InlineLoader.vue';
import HlsVideo from './HlsVideo.vue';
import {
  videoChannels, liveStartCommand, videoStopCommand, LIVE_HLS_URL,
  sendCommand, waitForHls, SUB_STREAM_KBPS, estimateDataMB,
} from '@/utils/dashcam';

const props = defineProps({
  device: { type: Object, required: true },
});

const userStore = useUserStore();
const toast = useToastStore();

const channels = computed(() => videoChannels(props.device));
const channel = ref(channels.value[0]?.index ?? 1);

// idle | starting | playing | stopped | error
const state = ref('idle');
const errorMsg = ref('');
const streamUrl = ref('');
const elapsed = ref(0);
let ticker = null;
let abort = null;
// Channel the device was told to start; stop() targets this, not the chip
// the user may have tapped since.
let activeChannel = null;

const server = computed(() => userStore.server_url);
const busy = computed(() => state.value === 'starting');
const live = computed(() => state.value === 'playing');
const dataHint = computed(() => `~${SUB_STREAM_KBPS} kbps sub-stream · ${estimateDataMB(elapsed.value).toFixed(1)} MB so far`);

const elapsedLabel = computed(() => {
  const s = elapsed.value;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
});

function startTicker() {
  stopTicker();
  elapsed.value = 0;
  ticker = setInterval(() => { elapsed.value += 1; }, 1000);
}
function stopTicker() {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

async function start() {
  if (busy.value || !server.value) return;
  if (activeChannel != null) await stop(true);

  state.value = 'starting';
  errorMsg.value = '';
  streamUrl.value = '';
  const ch = channel.value;
  activeChannel = ch;
  abort = new AbortController();

  try {
    await sendCommand(server.value, props.device.id, liveStartCommand(ch));
  } catch (err) {
    activeChannel = null;
    state.value = 'error';
    errorMsg.value = err?.status === 403
      ? 'You do not have permission to control this dashcam.'
      : (err?.message || 'Could not send the start command.');
    return;
  }

  const url = LIVE_HLS_URL;
  try {
    await waitForHls(url, 45_000, { signal: abort.signal });
  } catch (err) {
    if (err?.message === 'aborted') return;
    state.value = 'error';
    errorMsg.value = 'The dashcam did not start streaming within 45 s. Check that it is powered and online, then try again.';
    await stop(true);
    return;
  }

  // Cache-bust so a re-start after stop does not replay a stale manifest.
  streamUrl.value = `${url}?t=${Date.now()}`;
  startTicker();
  // HlsVideo flips us to 'playing' on the first frame; until then keep the
  // spinner up over the player.
}

function onPlaying() {
  if (state.value === 'starting') state.value = 'playing';
}

function onPlayerError(msg) {
  if (state.value === 'stopped' || state.value === 'idle') return;
  state.value = 'error';
  errorMsg.value = msg || 'Playback failed.';
  stop(true);
}

// `silent` = do not touch the visible state (used by error/cleanup paths).
async function stop(silent = false) {
  if (abort) { abort.abort(); abort = null; }
  stopTicker();
  streamUrl.value = '';
  const ch = activeChannel;
  activeChannel = null;
  if (!silent) state.value = 'stopped';
  if (ch == null || !server.value) return;
  try {
    await sendCommand(server.value, props.device.id, videoStopCommand(ch));
  } catch (err) {
    if (!silent) toast.show('Stop command failed — the dashcam may keep streaming briefly.', { variant: 'error' });
  }
}

function pickChannel(idx) {
  if (idx === channel.value) return;
  channel.value = idx;
  if (live.value || busy.value) start();
}

onBeforeRouteLeave(() => { stop(true); });
onBeforeUnmount(() => { stop(true); });
</script>

<template>
  <div class="space-y-4">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div class="relative aspect-video bg-black">
        <HlsVideo
          v-if="streamUrl"
          :src="streamUrl"
          @playing="onPlaying"
          @error="onPlayerError"
        />

        <div
          v-if="state === 'starting'"
          class="absolute inset-0 flex flex-col items-center justify-center text-white/90 bg-black/60"
        >
          <InlineLoader size="2xl" class="text-white mb-3" />
          <p class="text-sm font-bold">Waking the dashcam…</p>
          <p class="text-xs text-white/70 mt-1">Usually 5–15 s on LTE</p>
        </div>

        <div
          v-else-if="state !== 'playing'"
          class="absolute inset-0 flex flex-col items-center justify-center text-white/80"
        >
          <i class="fa-solid fa-video text-4xl mb-3" :class="state === 'error' ? 'text-red-400' : 'text-white/60'"></i>
          <p v-if="state === 'error'" class="text-sm text-center px-6 leading-snug text-red-200">{{ errorMsg }}</p>
          <p v-else-if="state === 'stopped'" class="text-sm">Stream stopped</p>
          <p v-else class="text-sm">Tap Start to view live video</p>
        </div>

        <div
          v-if="live"
          class="absolute top-2 left-2 flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md"
        >
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
          </span>
          Live · {{ elapsedLabel }}
        </div>
      </div>

      <div class="p-4 space-y-4">
        <div>
          <p class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Camera</p>
          <div class="flex gap-2 flex-wrap">
            <button
              v-for="c in channels"
              :key="c.index"
              type="button"
              @click="pickChannel(c.index)"
              class="px-3 py-1.5 rounded-full text-sm font-bold border transition-colors"
              :class="channel === c.index
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-100'"
            >
              {{ c.name }}
            </button>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            v-if="!live && !busy"
            type="button"
            @click="start"
            :disabled="!server"
            class="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
          >
            <i class="fa-solid fa-play"></i> Start
          </button>
          <button
            v-else
            type="button"
            @click="stop()"
            class="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            <InlineLoader v-if="busy" class="text-white" />
            <i v-else class="fa-solid fa-stop"></i>
            {{ busy ? 'Cancel' : 'Stop' }}
          </button>
        </div>

        <p class="text-[11px] text-gray-400 flex items-center gap-1.5">
          <i class="fa-solid fa-signal"></i>
          {{ dataHint }}
        </p>
      </div>
    </div>
  </div>
</template>
