<script setup>
// One extra camera in Playback's "All" grid. It has no controls of its own:
// it follows the main player's playhead (`t`) and play state.
//
// Source choice is the same as the main player (utils/dashcamPlayback
// candidatesAt): the hub copy, else the medusa cache, else the camera itself
// (0x9201 streamed through the medusa re-mux, one stream per camera). The
// camera is only woken while the main player is playing (`allowRemote`), and
// its stream is stopped on pause, on leaving the hour's video, and on unmount.
// Hub/cache video is kept within SYNC_TOLERANCE_S of the playhead by seeking;
// a camera stream cannot seek, so it simply runs alongside.
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import InlineLoader from '@/components/InlineLoader.vue';
import HlsVideo from './HlsVideo.vue';
import { sendCommand, liveHlsUrl, waitForHls } from '@/utils/dashcam';
import {
  candidatesAt, labelPlayback, playbackCommand, stopPlaybackCommand, echoKey, playbackEchoes, fmtHM,
} from '@/utils/dashcamPlayback';

const props = defineProps({
  device: { type: Object, required: true },
  server: { type: String, default: '' },
  ch: { type: Number, required: true },
  name: { type: String, default: '' },
  t: { type: Number, required: true },
  playing: { type: Boolean, default: false },
  allowRemote: { type: Boolean, default: false },
  online: { type: Boolean, default: false },
  clips: { type: Array, default: () => [] },
  cache: { type: Object, default: () => ({}) },
  hubCheck: { type: Function, required: true },
});

const SYNC_TOLERANCE_S = 1.5;

const playerRef = ref(null);
const videoSrc = ref('');
const source = ref(null);          // { kind, url, base, end, native }
// idle | loading | playing | paused | novideo | asleep | tap | error
const status = ref('idle');
let remote = false;                 // this camera is streaming to medusa
let abort = null;
let token = 0;
let disposed = false;

const video = () => playerRef.value?.video || null;
const cands = () => candidatesAt({ t: props.t, ch: props.ch, clips: props.clips, cache: props.cache, uniqueId: props.device.uniqueId });

// Identity of the best source at the playhead. Re-resolving on every playhead
// tick would thrash; this only changes when the playhead crosses into other
// video. A camera stream's base is the playhead itself, so it is keyed by clip.
const want = computed(() => {
  const c = cands()[0];
  if (!c) return 'none';
  return c.kind === 'remote' ? `remote|${c.clip.start.getTime()}` : `${c.kind}|${c.url}`;
});

const covers = (s, t) => s && t >= s.base && t < s.end;

async function stopRemote() {
  abort?.abort();
  abort = null;
  if (!remote) return;
  remote = false;
  try { await sendCommand(props.server, props.device.id, stopPlaybackCommand(props.ch)); } catch { /* best effort */ }
}

function syncVideo() {
  const v = video();
  const s = source.value;
  if (!v || !s || s.kind === 'remote' || !covers(s, props.t)) return;
  const want = (props.t - s.base) / 1000;
  if (Math.abs(v.currentTime - want) > SYNC_TOLERANCE_S) {
    try { v.currentTime = Math.max(0, want); } catch { /* not seekable yet */ }
  }
  if (props.playing && v.paused) v.play().catch(() => {});
  if (!props.playing && !v.paused) v.pause();
}

async function resolve() {
  const my = ++token;
  const list = cands();
  for (const c of list) {
    if (c.kind === 'hub') {
      const ok = await props.hubCheck(c.url);
      if (my !== token || disposed) return;
      if (!ok) continue;
    }
    if (c.kind === 'remote') {
      await stopRemote();
      if (my !== token || disposed) return;
      source.value = null;
      videoSrc.value = '';
      if (!props.online) { status.value = 'asleep'; return; }
      if (!props.allowRemote) { status.value = 'tap'; return; }
      return startRemote(c, my);
    }
    await stopRemote();
    if (my !== token || disposed) return;
    status.value = 'loading';
    source.value = { ...c, native: c.kind === 'hub' };
    videoSrc.value = c.url;
    return;
  }
  await stopRemote();
  if (my !== token || disposed) return;
  source.value = null;
  videoSrc.value = '';
  status.value = 'novideo';
}

async function startRemote(c, my) {
  status.value = 'loading';
  remote = true;
  try {
    await labelPlayback(props.device, props.ch, c.base).catch(() => {});
    if (my !== token || disposed) { remote = false; return; }
    playbackEchoes.add(echoKey(props.ch, c.base, c.end));
    await sendCommand(props.server, props.device.id, playbackCommand(props.device, props.ch, c.base, c.end));
  } catch {
    remote = false;
    if (my === token && !disposed) status.value = 'error';
    return;
  }
  // Superseded while the 0x9201 was in flight: a stop may already have gone
  // out before it, so close this camera's stream again.
  if (my !== token || disposed) {
    sendCommand(props.server, props.device.id, stopPlaybackCommand(props.ch)).catch(() => {});
    remote = false;
    return;
  }
  const url = liveHlsUrl(props.device, props.ch);
  abort = new AbortController();
  try {
    await waitForHls(url, 45_000, { signal: abort.signal });
  } catch {
    if (my !== token || disposed) return;
    status.value = 'error';
    await stopRemote();
    return;
  }
  if (my !== token || disposed) { await stopRemote(); return; }
  source.value = { kind: 'remote', url, base: c.base, end: c.end, native: false };
  videoSrc.value = `${url}?t=${Date.now()}`;
}

// Playhead moved into other video (or none).
watch(want, () => {
  const s = source.value;
  // A running camera stream keeps going while the playhead is inside it, even
  // if the cache index now also covers that instant.
  if (s?.kind === 'remote' && covers(s, props.t)) return;
  resolve();
});

// Playhead moved within the current video: stay in sync (seek on drift).
watch(() => props.t, syncVideo);

watch(() => props.playing, (on) => {
  if (on) {
    if (['tap', 'error'].includes(status.value) || !source.value) resolve();
    else syncVideo();
    return;
  }
  video()?.pause();
  // A paused camera stream still uses the vehicle SIM: stop it, as the main
  // player does. What was watched is cached for the next play.
  if (source.value?.kind === 'remote' || remote) {
    token++;
    stopRemote();
    source.value = null;
    videoSrc.value = '';
    status.value = 'tap';
  }
});

watch(() => props.online, (on) => { if (on && status.value === 'asleep') status.value = 'tap'; });

function onLoadedMeta() { syncVideo(); }
function onPlaying() { status.value = 'playing'; }
function onPause() { if (status.value === 'playing') status.value = 'paused'; }
function onError() { status.value = 'error'; }

resolve();

onBeforeUnmount(() => {
  disposed = true;
  token++;
  stopRemote();
});

defineExpose({ status, source });
</script>

<template>
  <div class="relative w-full h-full bg-black overflow-hidden">
    <HlsVideo
      v-if="videoSrc"
      ref="playerRef"
      :src="videoSrc"
      :native="!!source?.native"
      :muted="true"
      :controls="false"
      class="absolute inset-0"
      @loadedmetadata="onLoadedMeta"
      @playing="onPlaying"
      @pause="onPause"
      @error="onError"
    />

    <div v-if="status === 'loading'" class="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
      <InlineLoader size="xl" class="text-white" />
    </div>
    <div v-else-if="status === 'novideo' || status === 'idle'" class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-300 px-2 text-center">
      <i class="fa-solid fa-video-slash text-gray-500"></i>
      <p class="text-[11px] font-semibold">No video at {{ fmtHM(t) }}</p>
    </div>
    <div v-else-if="status === 'tap'" class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-200 px-2 text-center">
      <i class="fa-solid fa-play text-white/70"></i>
      <p class="text-[11px] font-semibold">Plays with the main camera</p>
    </div>
    <div v-else-if="status === 'asleep'" class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-300 px-2 text-center">
      <i class="fa-solid fa-moon text-amber-300"></i>
      <p class="text-[11px] font-semibold">The camera is off</p>
    </div>
    <div v-else-if="status === 'error'" class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-300 px-2 text-center">
      <i class="fa-solid fa-triangle-exclamation text-amber-400"></i>
      <p class="text-[11px] font-semibold">Video did not start</p>
    </div>

    <span class="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">{{ name }}</span>
  </div>
</template>
