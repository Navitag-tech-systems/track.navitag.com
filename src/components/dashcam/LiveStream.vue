<script setup>
// Live view for one dashcam: a single camera, or every camera at once in a
// grid. Each channel is its own device stream (0x9101) and its own HLS
// playlist on the medusa re-mux (keyed by SIM + channel), so channels start,
// fail and stop independently. The component always sends videoStop for every
// started channel on stop / unmount / route leave.
import { ref, reactive, computed, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useToastStore } from '@/stores/toast.js';
import InlineLoader from '@/components/InlineLoader.vue';
import HlsVideo from './HlsVideo.vue';
import {
  videoChannels, liveStartCommand, videoStopCommand, liveHlsUrl,
  sendCommand, waitForHls, SUB_STREAM_KBPS, estimateDataMB,
} from '@/utils/dashcam';

const props = defineProps({
  device: { type: Object, required: true },
});

const userStore = useUserStore();
const toast = useToastStore();

const ALL = 'all';
const channels = computed(() => videoChannels(props.device));
const multi = computed(() => channels.value.length > 1);
// A channel index, or ALL.
const choice = ref(channels.value[0]?.index ?? 1);
const targets = computed(() => (choice.value === ALL ? channels.value.map((c) => c.index) : [choice.value]));

// Per started channel: { url, state: 'starting' | 'playing' | 'error', error }
const sessions = reactive({});
// Channels the device was told to start; stop() targets these, not the chips
// the user may have tapped since.
const started = ref([]);
let abort = null;
const running = ref(false);
const stopped = ref(false);

const elapsed = ref(0);
let ticker = null;

const server = computed(() => userStore.server_url);
const tiles = computed(() => started.value.map((ch) => ({ ch, ...sessions[ch] })));
const anyPlaying = computed(() => tiles.value.some((t) => t.state === 'playing'));
const allFailed = computed(() => tiles.value.length > 0 && tiles.value.every((t) => t.state === 'error'));
const busy = computed(() => running.value && !anyPlaying.value && !allFailed.value);
const playingCount = computed(() => tiles.value.filter((t) => t.state === 'playing').length);
const dataHint = computed(() => {
  const n = Math.max(1, playingCount.value);
  const rate = `~${SUB_STREAM_KBPS * n} kbps${n > 1 ? ` (${n} cameras)` : ' sub-stream'}`;
  return `${rate} · ${estimateDataMB(elapsed.value, SUB_STREAM_KBPS, playingCount.value).toFixed(1)} MB so far`;
});
const gridClass = computed(() => (tiles.value.length > 1 ? 'grid grid-cols-2 gap-0.5' : ''));

const elapsedLabel = computed(() => {
  const s = elapsed.value;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
});

const channelName = (ch) => channels.value.find((c) => c.index === ch)?.name || `Camera ${ch}`;

function startTicker() {
  if (ticker) return;
  elapsed.value = 0;
  ticker = setInterval(() => { elapsed.value += 1; }, 1000);
}
function stopTicker() {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

function commandError(err) {
  return err?.status === 403
    ? 'You do not have permission to control this dashcam.'
    : (err?.message || 'Could not send the start command.');
}

async function startChannel(ch, signal) {
  sessions[ch] = { url: '', state: 'starting', error: '' };
  try {
    await sendCommand(server.value, props.device.id, liveStartCommand(ch));
  } catch (err) {
    sessions[ch] = { url: '', state: 'error', error: commandError(err) };
    return;
  }
  const url = liveHlsUrl(props.device, ch);
  try {
    await waitForHls(url, 45_000, { signal });
  } catch (err) {
    if (err?.message === 'aborted') return;
    sessions[ch] = { url: '', state: 'error', error: 'No video within 45 s. Check the camera is connected and the dashcam is online.' };
    sendCommand(server.value, props.device.id, videoStopCommand(ch)).catch(() => {});
    return;
  }
  // Cache-bust so a re-start after stop does not replay a stale manifest.
  // HlsVideo flips the tile to 'playing' on its first frame.
  if (!signal.aborted) sessions[ch] = { url: `${url}?t=${Date.now()}`, state: 'starting', error: '' };
}

async function start() {
  if (busy.value || !server.value) return;
  if (started.value.length) await stop(true);
  stopped.value = false;
  running.value = true;
  started.value = [...targets.value];
  abort = new AbortController();
  const { signal } = abort;
  // Sequential sends: the device handles one 0x9101 at a time more reliably,
  // and the waits then run in parallel.
  const waits = [];
  for (const ch of started.value) {
    waits.push(startChannel(ch, signal));
    await new Promise((r) => setTimeout(r, 300));
  }
  await Promise.all(waits);
}

function onPlaying(ch) {
  if (sessions[ch]?.state === 'starting') {
    sessions[ch] = { ...sessions[ch], state: 'playing' };
    startTicker();
  }
}

function onPlayerError(ch, msg) {
  if (!running.value || !sessions[ch]) return;
  sessions[ch] = { url: '', state: 'error', error: msg || 'Playback failed.' };
  sendCommand(server.value, props.device.id, videoStopCommand(ch)).catch(() => {});
}

// `silent` = do not show the stopped state or toast (error/cleanup paths).
async function stop(silent = false) {
  if (abort) { abort.abort(); abort = null; }
  stopTicker();
  const chs = started.value;
  started.value = [];
  running.value = false;
  for (const k of Object.keys(sessions)) delete sessions[k];
  if (!silent) stopped.value = true;
  if (!chs.length || !server.value) return;
  const results = await Promise.allSettled(
    chs.map((ch) => sendCommand(server.value, props.device.id, videoStopCommand(ch))),
  );
  if (!silent && results.some((r) => r.status === 'rejected')) {
    toast.show('Stop command failed — the dashcam may keep streaming briefly.', { variant: 'error' });
  }
}

function pick(next) {
  if (next === choice.value) return;
  choice.value = next;
  if (running.value) start();
}

onBeforeRouteLeave(() => { stop(true); });
onBeforeUnmount(() => { stop(true); });
</script>

<template>
  <div class="space-y-4">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div class="relative bg-black" :class="tiles.length > 1 ? '' : 'aspect-video'">
        <div v-if="tiles.length" :class="gridClass" class="h-full">
          <div v-for="t in tiles" :key="t.ch" class="relative aspect-video bg-black overflow-hidden">
            <HlsVideo
              v-if="t.url"
              :src="t.url"
              @playing="onPlaying(t.ch)"
              @error="(msg) => onPlayerError(t.ch, msg)"
            />

            <div
              v-if="t.state === 'starting'"
              class="absolute inset-0 flex flex-col items-center justify-center text-white/90 bg-black/60"
            >
              <InlineLoader :size="tiles.length > 1 ? 'xl' : '2xl'" class="text-white mb-2" />
              <p class="text-xs font-bold">Waking the camera…</p>
              <p v-if="tiles.length === 1" class="text-xs text-white/70 mt-1">Usually 5–15 s on LTE</p>
            </div>

            <div
              v-else-if="t.state === 'error'"
              class="absolute inset-0 flex flex-col items-center justify-center text-red-200 px-3 text-center"
            >
              <i class="fa-solid fa-video-slash mb-2 text-red-400" :class="tiles.length > 1 ? 'text-xl' : 'text-4xl'"></i>
              <p class="leading-snug" :class="tiles.length > 1 ? 'text-[11px]' : 'text-sm'">{{ t.error }}</p>
            </div>

            <div
              v-if="tiles.length > 1"
              class="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded"
            >
              {{ channelName(t.ch) }}
            </div>
          </div>
        </div>

        <div
          v-else
          class="absolute inset-0 flex flex-col items-center justify-center text-white/80"
        >
          <i class="fa-solid fa-video text-4xl mb-3 text-white/60"></i>
          <p v-if="stopped" class="text-sm">Stream stopped</p>
          <p v-else class="text-sm">Tap Start to view live video</p>
        </div>

        <div
          v-if="anyPlaying"
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
              @click="pick(c.index)"
              class="px-3 py-1.5 rounded-full text-sm font-bold border transition-colors"
              :class="choice === c.index
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-100'"
            >
              {{ c.name }}
            </button>
            <button
              v-if="multi"
              type="button"
              @click="pick(ALL)"
              class="px-3 py-1.5 rounded-full text-sm font-bold border transition-colors flex items-center gap-1.5"
              :class="choice === ALL
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-100'"
            >
              <i class="fa-solid fa-table-cells-large text-xs"></i> All ({{ channels.length }})
            </button>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            v-if="!running"
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
