<script setup>
// Live view for one dashcam: one camera, or every camera at once in a grid
// ("All"). Each camera is its own device stream (0x9101 -> its own JT1078
// connection to the medusa re-mux, keyed by SIM + channel), so cameras start,
// fail and stop independently. JT1078 has no "switch channel" on an open
// stream, so a change of choice closes every current stream (videoStop) BEFORE
// asking for the next set; start/stop are serialised. The component always
// sends videoStop for every started camera on stop / unmount / route leave,
// and stops itself LIVE_SESSION_LIMIT_S after Start.
// Below the video, the same map as Playback shows the vehicle's current
// position from the live device store (socket), with a trail of the fixes
// received while this view is open.
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useToastStore } from '@/stores/toast.js';
import InlineLoader from '@/components/InlineLoader.vue';
import HlsVideo from './HlsVideo.vue';
import TrackMap from './TrackMap.vue';
import { useVideoAspect } from './dashcamAspect';
import {
  videoChannels, liveStartCommand, labelLive, videoStopCommand, liveHlsUrl,
  sendCommand, waitForHls, LIVE_SESSION_LIMIT_S,
} from '@/utils/dashcam';
import { KNOTS_TO_KMH } from '@/utils/dashcamPlayback';

const props = defineProps({
  device: { type: Object, required: true },
});

const userStore = useUserStore();
const toast = useToastStore();

const ALL = 'all';
const channels = computed(() => videoChannels(props.device));
const multi = computed(() => channels.value.length > 1);
const { aspect, onAspect } = useVideoAspect(props.device.id, 'live');
// A camera index, or ALL.
const choice = ref(channels.value[0]?.index ?? 1);
const targets = computed(() => (choice.value === ALL ? channels.value.map((c) => c.index) : [choice.value]));

// The streams the device was told to start, one per camera:
// { ch, run, url, state: 'starting' | 'playing' | 'error', error }.
// stop() targets these cameras, not the chips the user may have tapped since.
const sessions = ref([]);
let run = 0;
let abort = null;
// Serialises start/stop so a quick double switch cannot overlap streams.
let chain = Promise.resolve();
let disposed = false;
const running = ref(false);
const stopped = ref(false);
// Set when the session limit (not the user) stopped the stream.
const timedOut = ref(false);
let limitTimer = null;
const limitMinutes = Math.round(LIVE_SESSION_LIMIT_S / 60);
// Gap between the 0x9101s of an All start: the device handles one at a time
// more reliably; the HLS waits still run in parallel.
const SEND_GAP_MS = 300;

const elapsed = ref(0);
let ticker = null;

const server = computed(() => userStore.server_url);
const anyPlaying = computed(() => sessions.value.some((s) => s.state === 'playing'));
const allFailed = computed(() => sessions.value.length > 0 && sessions.value.every((s) => s.state === 'error'));
const busy = computed(() => running.value && !anyPlaying.value && !allFailed.value);
const grid = computed(() => sessions.value.length > 1);
// The video box keeps the frame's shape per tile: 2 columns, as many rows as needed.
const boxAspect = computed(() => {
  const n = sessions.value.length;
  if (n <= 1) return aspect.value;
  const cols = 2;
  const rows = Math.ceil(n / cols);
  return (aspect.value * cols) / rows;
});
const channelName = (ch) => channels.value.find((c) => c.index === ch)?.name || `Camera ${ch}`;

const elapsedLabel = computed(() => {
  const s = elapsed.value;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
});

// --- Map: current position + trail of fixes seen while open ---------------
const TRAIL_MAX = 500;
const mapPosition = computed(() => {
  const ll = props.device?.latlon;
  if (!ll || ll[0] == null || ll[1] == null || (ll[0] === 0 && ll[1] === 0)) return null;
  return { lat: ll[0], lng: ll[1], course: props.device.bearing || 0 };
});
const trail = ref([]);
watch(mapPosition, (p) => {
  if (!p) return;
  const last = trail.value[trail.value.length - 1];
  if (last && last[0] === p.lat && last[1] === p.lng) return;
  const next = [...trail.value, [p.lat, p.lng]];
  trail.value = next.length > TRAIL_MAX ? next.slice(-TRAIL_MAX) : next;
}, { immediate: true });
const speedKmh = computed(() => Math.max(0, Math.round((Number(props.device?.speed) || 0) * KNOTS_TO_KMH)));
const fixLabel = computed(() => {
  const ms = Date.parse(props.device?.fixTime || '');
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
});

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

const sendStop = (ch) => sendCommand(server.value, props.device.id, videoStopCommand(ch));

function clearLimit() {
  if (limitTimer) { clearTimeout(limitTimer); limitTimer = null; }
}

// Update camera `ch` of run `r` only; a stream from an earlier run is gone.
function patch(r, ch, fields) {
  sessions.value = sessions.value.map((s) => (s.ch === ch && s.run === r ? { ...s, ...fields } : s));
}
const isCurrent = (ch) => sessions.value.some((s) => s.ch === ch);

// A failed camera stays on screen with its error. Once every camera failed,
// the session limit no longer runs (it would replace the errors with "Live paused").
function failSession(r, ch, error) {
  patch(r, ch, { url: '', state: 'error', error });
  if (allFailed.value) clearLimit();
}

async function startChannel(ch, signal, r) {
  try {
    await labelLive(props.device, ch);
    // Stopped / switched / left while the medusa label was in flight: never
    // send the 0x9101 (its videoStop has already gone out).
    if (signal.aborted) return;
    await sendCommand(server.value, props.device.id, liveStartCommand(ch));
  } catch (err) {
    if (!signal.aborted) failSession(r, ch, commandError(err));
    return;
  }
  // Stopped or switched while the start command was in flight: its videoStop
  // may have reached the device before this 0x9101, so close it again —
  // unless the same camera was started again since.
  if (signal.aborted) {
    if (!isCurrent(ch)) sendStop(ch).catch(() => {});
    return;
  }
  const url = liveHlsUrl(props.device, ch);
  try {
    await waitForHls(url, 45_000, { signal });
  } catch (err) {
    // waitForHls only checks the signal between probes, so an abort during
    // the last probe surfaces as a timeout: check the signal, not the message.
    if (signal.aborted || err?.message === 'aborted') return;
    failSession(r, ch, 'No video within 45 s. Check the camera is connected and the dashcam is online.');
    sendStop(ch).catch(() => {});
    return;
  }
  // Cache-bust so a re-start after stop does not replay a stale manifest.
  // HlsVideo flips the camera to 'playing' on its first frame.
  if (!signal.aborted) patch(r, ch, { url: `${url}?t=${Date.now()}` });
}

// Ends the current streams' local state (timers, waits) without touching
// what the screen shows.
function teardown() {
  clearLimit();
  if (abort) { abort.abort(); abort = null; }
  stopTicker();
}

// `silent` = do not show the stopped state or toast (error/cleanup paths).
async function doStop(silent) {
  teardown();
  const chs = sessions.value.map((s) => s.ch);
  sessions.value = [];
  running.value = false;
  if (!silent) stopped.value = true;
  if (!chs.length || !server.value) return;
  const results = await Promise.allSettled(chs.map((ch) => sendStop(ch)));
  if (!silent && results.some((x) => x.status === 'rejected')) {
    toast.show('Stop command failed — the dashcam may keep streaming briefly.', { variant: 'error' });
  }
}

async function doStart() {
  if (disposed || !server.value) return;
  const prev = sessions.value.map((s) => s.ch);
  const chs = [...targets.value];
  const r = ++run;
  teardown();
  // Show the next camera(s) as waking straight away (not "Tap Start") while
  // the previous ones are stopped.
  stopped.value = false;
  timedOut.value = false;
  running.value = true;
  sessions.value = chs.map((ch) => ({ ch, run: r, url: '', state: 'starting', error: '' }));
  // Close the current streams first: never two connections to one camera.
  if (prev.length && server.value) await Promise.allSettled(prev.map((ch) => sendStop(ch)));
  if (disposed || r !== run) return;
  limitTimer = setTimeout(onSessionLimit, LIVE_SESSION_LIMIT_S * 1000);
  abort = new AbortController();
  const { signal } = abort;
  // Not awaited: the chain only orders the commands; the HLS waits (up to
  // 45 s) must not hold back a Stop or a camera switch.
  (async () => {
    for (let i = 0; i < chs.length; i++) {
      if (signal.aborted) return;
      startChannel(chs[i], signal, r);
      if (i < chs.length - 1) await new Promise((res) => setTimeout(res, SEND_GAP_MS));
    }
  })();
}

function queue(fn) {
  chain = chain.then(fn, fn);
  return chain;
}
const start = () => queue(doStart);
const stop = (silent = false) => queue(() => doStop(silent));

function onPlaying(s) {
  if (s.state === 'starting') {
    patch(s.run, s.ch, { state: 'playing' });
    startTicker();
  }
}

function onPlayerError(s, msg) {
  if (!running.value) return;
  failSession(s.run, s.ch, msg || 'Playback failed.');
  sendStop(s.ch).catch(() => {});
}

// Only the first tile sets the frame shape (all cameras share one box shape).
function onTileAspect(s, a) {
  if (s.ch === sessions.value[0]?.ch) onAspect(a);
}

async function onSessionLimit() {
  limitTimer = null;
  if (!running.value) return;
  timedOut.value = true;
  await stop();
}

function pick(next) {
  if (next === choice.value) return;
  choice.value = next;
  // A camera switch while streaming (or still waking) replaces the stream(s).
  if (running.value) start();
}

// `disposed` keeps a start that is queued behind a stop from running after
// the user has left.
function dispose() {
  disposed = true;
  stop(true);
}
onBeforeRouteLeave(dispose);
onBeforeUnmount(dispose);
</script>

<template>
  <!-- Stacked on narrow screens, side by side from 1024 px: dashcamLayout.css -->
  <div class="dc-layout live-layout" :style="{ '--dc-aspect': boxAspect }">
    <div class="dc-media">
    <div class="bg-black">
      <div class="live-video dc-video relative mx-auto w-full overflow-hidden">
        <div v-if="sessions.length" class="absolute inset-0" :class="grid ? 'grid grid-cols-2 auto-rows-fr gap-0.5' : ''">
          <div v-for="s in sessions" :key="`${s.run}:${s.ch}`" class="relative bg-black overflow-hidden" :class="grid ? '' : 'h-full'">
            <HlsVideo
              v-if="s.url"
              :src="s.url"
              @playing="onPlaying(s)"
              @error="(msg) => onPlayerError(s, msg)"
              @aspect="(a) => onTileAspect(s, a)"
            />

            <div
              v-if="s.state === 'starting'"
              class="absolute inset-0 flex flex-col items-center justify-center text-white/90 bg-black/60"
            >
              <InlineLoader :size="grid ? 'xl' : '2xl'" class="text-white mb-2" />
              <p class="text-xs font-bold">Waking the camera…</p>
              <p v-if="!grid" class="text-xs text-white/70 mt-1">Usually 5–15 s on LTE</p>
            </div>

            <div
              v-else-if="s.state === 'error'"
              class="absolute inset-0 flex flex-col items-center justify-center text-red-200 px-3 text-center"
            >
              <i class="fa-solid fa-video-slash mb-2 text-red-400" :class="grid ? 'text-xl' : 'text-4xl'"></i>
              <p class="leading-snug" :class="grid ? 'text-[11px]' : 'text-sm'">{{ s.error }}</p>
            </div>

            <div
              v-if="grid"
              class="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded"
            >
              {{ channelName(s.ch) }}
            </div>
          </div>
        </div>

        <div
          v-else
          class="absolute inset-0 flex flex-col items-center justify-center text-white/80"
        >
          <template v-if="timedOut">
            <i class="fa-solid fa-circle-pause text-4xl mb-3 text-white/70"></i>
            <p class="text-sm font-bold text-white">Live paused</p>
            <p class="text-xs text-white/60 mt-1 px-6 text-center">Paused after {{ limitMinutes }} min</p>
            <button
              type="button"
              @click="start"
              :disabled="!server"
              class="mt-4 bg-brand hover:bg-brand-dark text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors flex items-center gap-2 active:scale-[0.98] disabled:opacity-50"
            >
              <i class="fa-solid fa-play"></i> Resume
            </button>
          </template>
          <template v-else>
            <i class="fa-solid fa-video text-4xl mb-3 text-white/60"></i>
            <p v-if="stopped" class="text-sm">Stream stopped</p>
            <p v-else class="text-sm">Tap Start to view live video</p>
          </template>
        </div>
      </div>
    </div>

    <div class="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-2">
      <div class="flex gap-1.5 flex-1 min-w-0 overflow-x-auto">
        <button
          v-for="c in channels"
          :key="c.index"
          type="button"
          @click="pick(c.index)"
          class="h-9 px-3 rounded-full text-sm font-bold border transition-colors shrink-0"
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
          class="h-9 px-3 rounded-full text-sm font-bold border transition-colors shrink-0 flex items-center gap-1.5"
          :class="choice === ALL
            ? 'bg-brand text-white border-brand'
            : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-100'"
        >
          <i class="fa-solid fa-table-cells-large text-xs"></i> All ({{ channels.length }})
        </button>
      </div>

      <!-- Live timer + speed sit here, not over the video: the box is the exact
           frame, so overlays would cover the camera's own date/GPS stamp. -->
      <div v-if="anyPlaying" class="shrink-0 flex flex-col items-end leading-tight">
        <span class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-red-600">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
          </span>
          Live {{ elapsedLabel }}
        </span>
        <span v-if="mapPosition" class="text-xs font-semibold text-gray-500 tabular-nums">{{ speedKmh }} km/h</span>
      </div>

      <button
        v-if="!running"
        type="button"
        @click="start"
        :disabled="!server"
        class="h-11 px-5 shrink-0 bg-brand hover:bg-brand-dark text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
      >
        <i class="fa-solid fa-play"></i> {{ timedOut ? 'Resume' : 'Start' }}
      </button>
      <button
        v-else
        type="button"
        @click="stop()"
        class="h-11 px-5 shrink-0 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
      >
        <InlineLoader v-if="busy" class="text-white" />
        <i v-else class="fa-solid fa-stop"></i>
        {{ busy ? 'Cancel' : 'Stop' }}
      </button>
    </div>
    </div>

    <div class="dc-map">
      <!-- absolute: the wrapper's height comes from flex/min-height only, so
           TrackMap's h-full would resolve to 0 without a positioned box. -->
      <div class="absolute inset-0">
        <TrackMap :position="mapPosition" mode="live" :trail="trail" />
      </div>
      <div class="absolute inset-x-0 top-3 flex justify-center pointer-events-none z-[500]">
        <span v-if="!mapPosition" class="text-xs font-semibold text-gray-600 bg-white/90 px-2.5 py-1 rounded-full shadow-sm">No GPS position yet</span>
        <span v-else-if="fixLabel" class="text-xs font-semibold text-gray-600 bg-white/90 px-2.5 py-1 rounded-full shadow-sm tabular-nums">{{ fixLabel }}</span>
      </div>
    </div>
  </div>
</template>

<style src="./dashcamLayout.css"></style>
<style scoped>
/* Media column below the video: the camera bar (64 px). */
.live-layout { --dc-below: 64px; }
/* Stacked: the box (height = width / aspect) is at most half the screen tall
   and leaves room for header + camera bar + nav + a 200 px map; never below
   160 px tall. */
.live-video {
  max-width: min(calc(50dvh * var(--dc-aspect)), max(calc(160px * var(--dc-aspect)), calc((100dvh - 442px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) * var(--dc-aspect))));
}
@media (min-width: 1024px) {
  .live-video { max-width: none; }
}
</style>
