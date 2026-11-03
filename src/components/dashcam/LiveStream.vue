<script setup>
// Live view for one dashcam, ONE camera at a time. Each camera is its own
// device stream (0x9101 -> its own JT1078 connection to the medusa re-mux,
// keyed by SIM + channel); JT1078 has no "switch channel" on an open stream,
// so a camera switch closes the current stream (videoStop) BEFORE asking for
// the next one: never two connections at once. The component always sends
// videoStop on stop / unmount / route leave, and stops itself
// LIVE_SESSION_LIMIT_S after Start.
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

const channels = computed(() => videoChannels(props.device));
const { aspect, onAspect } = useVideoAspect(props.device.id, 'live');
const choice = ref(channels.value[0]?.index ?? 1);

// The one stream the device was told to start:
// { ch, url, state: 'starting' | 'playing' | 'error', error } or null.
// stop() targets session.ch, not the chip the user may have tapped since.
const session = ref(null);
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

const elapsed = ref(0);
let ticker = null;

const server = computed(() => userStore.server_url);
const playing = computed(() => session.value?.state === 'playing');
const busy = computed(() => running.value && session.value?.state === 'starting');

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

// A failed session stays on screen with its error; it no longer counts
// toward the session limit (which would replace the error with "Live paused").
function failSession(base, error) {
  clearLimit();
  session.value = { ...base, url: '', state: 'error', error };
}

async function startChannel(ch, signal) {
  const mine = { ch, url: '', state: 'starting', error: '' };
  session.value = mine;
  try {
    await labelLive(props.device, ch);
    // Stopped / switched / left while the medusa label was in flight: never
    // send the 0x9101 (its videoStop has already gone out).
    if (signal.aborted) return;
    await sendCommand(server.value, props.device.id, liveStartCommand(ch));
  } catch (err) {
    if (!signal.aborted) failSession(mine, commandError(err));
    return;
  }
  // Stopped or switched while the start command was in flight: its videoStop
  // may have reached the device before this 0x9101, so close it again —
  // unless the same camera was started again since.
  if (signal.aborted) {
    if (session.value?.ch !== ch) sendStop(ch).catch(() => {});
    return;
  }
  const url = liveHlsUrl(props.device, ch);
  try {
    await waitForHls(url, 45_000, { signal });
  } catch (err) {
    // waitForHls only checks the signal between probes, so an abort during
    // the last probe surfaces as a timeout: check the signal, not the message.
    if (signal.aborted || err?.message === 'aborted') return;
    failSession(mine, 'No video within 45 s. Check the camera is connected and the dashcam is online.');
    sendStop(ch).catch(() => {});
    return;
  }
  // Cache-bust so a re-start after stop does not replay a stale manifest.
  // HlsVideo flips the session to 'playing' on its first frame.
  if (!signal.aborted) session.value = { ...mine, url: `${url}?t=${Date.now()}` };
}

// Ends the current stream's local state (timers, waits) without touching
// what the screen shows.
function teardown() {
  clearLimit();
  if (abort) { abort.abort(); abort = null; }
  stopTicker();
}

// `silent` = do not show the stopped state or toast (error/cleanup paths).
async function doStop(silent) {
  teardown();
  const s = session.value;
  session.value = null;
  running.value = false;
  if (!silent) stopped.value = true;
  if (!s || !server.value) return;
  try {
    await sendStop(s.ch);
  } catch {
    if (!silent) toast.show('Stop command failed — the dashcam may keep streaming briefly.', { variant: 'error' });
  }
}

async function doStart() {
  if (disposed || !server.value) return;
  const prev = session.value;
  const ch = choice.value;
  teardown();
  // Show the next camera as waking straight away (not "Tap Start") while the
  // previous one is stopped.
  stopped.value = false;
  timedOut.value = false;
  running.value = true;
  session.value = { ch, url: '', state: 'starting', error: '' };
  // Close the current stream first: one camera connection at a time.
  if (prev && server.value) await sendStop(prev.ch).catch(() => {});
  if (disposed) return;
  limitTimer = setTimeout(onSessionLimit, LIVE_SESSION_LIMIT_S * 1000);
  abort = new AbortController();
  // Not awaited: the chain only orders the commands; the HLS wait (up to
  // 45 s) must not hold back a Stop or a camera switch.
  startChannel(ch, abort.signal);
}

function queue(fn) {
  chain = chain.then(fn, fn);
  return chain;
}
const start = () => queue(doStart);
const stop = (silent = false) => queue(() => doStop(silent));

function onPlaying() {
  if (session.value?.state === 'starting') {
    session.value = { ...session.value, state: 'playing' };
    startTicker();
  }
}

function onPlayerError(msg) {
  const s = session.value;
  if (!running.value || !s) return;
  failSession(s, msg || 'Playback failed.');
  sendStop(s.ch).catch(() => {});
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
  // A camera switch while streaming (or still waking) replaces the stream.
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
  <div class="dc-layout live-layout" :style="{ '--dc-aspect': aspect }">
    <div class="dc-media">
    <div class="bg-black">
      <div class="live-video dc-video relative mx-auto w-full overflow-hidden">
        <template v-if="session">
          <HlsVideo
            v-if="session.url"
            :key="session.ch"
            :src="session.url"
            @playing="onPlaying"
            @error="onPlayerError"
            @aspect="onAspect"
          />

          <div
            v-if="session.state === 'starting'"
            class="absolute inset-0 flex flex-col items-center justify-center text-white/90 bg-black/60"
          >
            <InlineLoader size="2xl" class="text-white mb-2" />
            <p class="text-xs font-bold">Waking the camera…</p>
            <p class="text-xs text-white/70 mt-1">Usually 5–15 s on LTE</p>
          </div>

          <div
            v-else-if="session.state === 'error'"
            class="absolute inset-0 flex flex-col items-center justify-center text-red-200 px-3 text-center"
          >
            <i class="fa-solid fa-video-slash mb-2 text-red-400 text-4xl"></i>
            <p class="leading-snug text-sm">{{ session.error }}</p>
          </div>
        </template>

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
      </div>

      <!-- Live timer + speed sit here, not over the video: the box is the exact
           frame, so overlays would cover the camera's own date/GPS stamp. -->
      <div v-if="playing" class="shrink-0 flex flex-col items-end leading-tight">
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
