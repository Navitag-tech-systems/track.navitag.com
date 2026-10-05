<script setup>
// /dashcam/:deviceId/view?mode=live|playback&ch=N[&clip=<id>]
//
// Video and GPS together. The video element is the clock in playback (map
// marker = route sample at video.currentTime; clicking the track seeks the
// video). In live the vehicle drives its loop on the wall clock while the
// channel's feed plays — see utils/dashcamDemo.js.
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import TrackMap from '@/components/dashcam/TrackMap.vue';
import {
  loadManifest, loadRoute, mediaUrl, positionAt, liveRouteTime, trailBefore,
  fmtDuration, fmtClock, groupClipsByDay,
} from '@/utils/dashcamDemo';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();

const deviceId = route.params.deviceId;
const device = computed(() => deviceStore.devices[deviceId]);

const manifest = ref(null);
const loading = ref(true);
const error = ref('');

const mode = computed(() => (route.query.mode === 'playback' ? 'playback' : 'live'));
const ch = computed(() => Number(route.query.ch) || manifest.value?.channels[0]?.index || 1);
const channel = computed(() => manifest.value?.channels.find((c) => c.index === ch.value) || null);

const clips = computed(() => (manifest.value?.clips || []).filter((c) => c.videos?.[String(ch.value)]));
const clipGroups = computed(() => groupClipsByDay(clips.value));
const clip = computed(() => {
  if (mode.value !== 'playback') return null;
  return clips.value.find((c) => c.id === route.query.clip) || clips.value[0] || null;
});

const source = computed(() => {
  const m = manifest.value;
  if (!m) return null;
  if (mode.value === 'live') return m.live ? { videos: m.live.videos, route: m.live.route } : null;
  return clip.value ? { videos: clip.value.videos, route: clip.value.route } : null;
});
const videoSrc = computed(() => {
  const s = source.value;
  const p = s?.videos?.[String(ch.value)];
  return p ? mediaUrl(manifest.value.uniqueId || device.value?.uniqueId, p) : '';
});

const routeData = ref(null);
const points = computed(() => routeData.value?.points || []);
const position = ref(null);
const trail = ref([]);
const clock = ref(new Date());
const progressT = ref(0);

const videoEl = ref(null);
const connecting = ref(false);
const muted = ref(true);
const paused = ref(true);

// --- loading -----------------------------------------------------------------

async function init() {
  loading.value = true;
  error.value = '';
  // The device list may still be arriving on a cold open of this URL.
  for (let i = 0; i < 40 && !device.value; i++) await new Promise((r) => setTimeout(r, 250));
  if (!device.value) {
    loading.value = false;
    error.value = 'Device not found.';
    return;
  }
  manifest.value = await loadManifest(device.value.uniqueId);
  loading.value = false;
  if (!manifest.value) error.value = 'No video is available for this device.';
}

let routeToken = 0;
watch(source, async (s) => {
  routeData.value = null;
  position.value = null;
  trail.value = [];
  if (!s?.route) return;
  const token = ++routeToken;
  try {
    const r = await loadRoute(manifest.value.uniqueId || device.value.uniqueId, s.route);
    if (token === routeToken) routeData.value = r;
  } catch {
    if (token === routeToken) error.value = 'Could not load the GPS track.';
  }
}, { immediate: true });

// --- video -------------------------------------------------------------------

let resumeAt = null;
let resumePlaying = true;
let connectTimer = null;

watch(videoSrc, async (src, old) => {
  await nextTick();
  const v = videoEl.value;
  if (!v || !src) return;
  // Channel switch inside the same playback clip keeps the position.
  const sameClip = mode.value === 'playback' && old && clip.value && old.includes(`/clips/${clip.value.id}/`);
  resumeAt = sameClip ? v.currentTime : null;
  resumePlaying = sameClip ? !v.paused : true;
  clearTimeout(connectTimer);
  connecting.value = mode.value === 'live';
  v.src = src;
  v.load();
}, { flush: 'post' });

function onLoadedMeta() {
  const v = videoEl.value;
  if (!v) return;
  if (mode.value === 'live') {
    // Join the "broadcast" mid-stream, not from the top of the file.
    if (v.duration > 0) v.currentTime = (Date.now() / 1000) % v.duration;
  } else if (resumeAt != null) {
    v.currentTime = Math.min(resumeAt, v.duration || resumeAt);
  }
  if (mode.value === 'live' || resumePlaying) v.play().catch(() => { paused.value = true; });
}

function onPlaying() {
  paused.value = false;
  if (connecting.value) connectTimer = setTimeout(() => { connecting.value = false; }, 600);
}

function onPause() { paused.value = true; }

function togglePlay() {
  const v = videoEl.value;
  if (!v) return;
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}

function toggleMute() {
  muted.value = !muted.value;
  if (videoEl.value) videoEl.value.muted = muted.value;
}

function fullscreen() {
  const v = videoEl.value;
  if (!v) return;
  if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
  else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
}

function seek(t) {
  const v = videoEl.value;
  if (!v || mode.value !== 'playback') return;
  v.currentTime = Math.max(0, Math.min(t, v.duration || t));
  if (v.paused) v.play().catch(() => {});
}

function onScrub(e) {
  seek(Number(e.target.value));
}

// --- clock loop --------------------------------------------------------------

let raf = 0;
let lastTrail = 0;

function tick(now) {
  raf = requestAnimationFrame(tick);
  const pts = points.value;
  if (!pts.length) return;
  if (mode.value === 'live') {
    const t = liveRouteTime(routeData.value);
    position.value = positionAt(pts, t);
    clock.value = new Date();
    if (now - lastTrail > 1000) {
      lastTrail = now;
      trail.value = trailBefore(pts, t, 150, true);
    }
  } else {
    const v = videoEl.value;
    const t = v ? v.currentTime : 0;
    if (position.value && Math.abs((position.value.t ?? -1) - t) < 0.02) return;
    progressT.value = t;
    position.value = positionAt(pts, t);
    if (clip.value) clock.value = new Date(new Date(clip.value.start).getTime() + t * 1000);
  }
}

onMounted(() => {
  init();
  raf = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  clearTimeout(connectTimer);
  const v = videoEl.value;
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
  }
});

// --- navigation ----------------------------------------------------------------

function go(q) {
  router.replace({ query: { ...route.query, ...q } });
}
function pickChannel(c) { go({ ch: c.index }); }
function pickClip(c) { go({ clip: c.id }); }
function pickMode(m) {
  if (m === mode.value) return;
  go({ mode: m, clip: undefined });
}

const speed = computed(() => Math.max(0, Math.round(position.value?.speed || 0)));
const clipDuration = computed(() => clip.value?.duration || routeData.value?.duration || 0);
const distanceSoFar = computed(() => {
  if (mode.value !== 'playback' || !routeData.value || !clipDuration.value) return null;
  return (routeData.value.distanceKm * Math.min(1, progressT.value / clipDuration.value));
});
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface relative z-10 pointer-events-auto">
    <!-- header -->
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200 safe-top">
      <div class="px-4 py-3 flex items-center gap-2">
        <button
          @click="router.push({ name: 'dashcam', params: { deviceId }, query: { mode } })"
          class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors outline-none"
          aria-label="Back to channels"
        >
          <i class="fa-solid fa-arrow-left text-lg"></i>
        </button>
        <div class="min-w-0 flex-1">
          <h1 class="text-base font-bold text-gray-800 truncate">{{ device?.name || 'Dashcam' }}</h1>
          <p class="text-[11px] text-gray-400 truncate">
            <template v-if="channel">CH{{ channel.index }} · {{ channel.name }}</template>
          </p>
        </div>
        <div class="flex bg-gray-100 rounded-lg p-0.5 text-xs font-bold">
          <button
            type="button"
            :disabled="!manifest?.live"
            @click="pickMode('live')"
            class="px-3 py-1.5 rounded-md flex items-center gap-1.5 disabled:opacity-40"
            :class="mode === 'live' ? 'bg-white shadow-sm text-red-600' : 'text-gray-500'"
          >
            <span class="w-1.5 h-1.5 rounded-full" :class="mode === 'live' ? 'bg-red-600 animate-pulse' : 'bg-gray-400'"></span>
            Live
          </button>
          <button
            type="button"
            :disabled="!manifest?.clips?.length"
            @click="pickMode('playback')"
            class="px-3 py-1.5 rounded-md disabled:opacity-40"
            :class="mode === 'playback' ? 'bg-white shadow-sm text-brand' : 'text-gray-500'"
          >
            Playback
          </button>
        </div>
      </div>

      <div v-if="manifest" class="flex gap-2 px-4 pb-3 overflow-x-auto">
        <button
          v-for="c in manifest.channels"
          :key="c.index"
          type="button"
          @click="pickChannel(c)"
          class="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors"
          :class="c.index === ch ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200 hover:border-brand'"
        >
          CH{{ c.index }} · {{ c.name }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="p-10 text-center text-gray-500">Loading…</div>
    <div v-else-if="error && !manifest" class="p-10 text-center text-gray-500">{{ error }}</div>

    <div v-else class="flex-1 w-full max-w-6xl mx-auto p-3 lg:p-4 grid gap-3 lg:grid-cols-2 lg:items-start">
      <!-- video column -->
      <div class="space-y-3">
        <div class="relative aspect-video bg-black rounded-xl overflow-hidden shadow-sm">
          <video
            ref="videoEl"
            class="absolute inset-0 w-full h-full object-contain"
            playsinline
            preload="auto"
            :muted="muted"
            :loop="mode === 'live'"
            :controls="false"
            @loadedmetadata="onLoadedMeta"
            @playing="onPlaying"
            @pause="onPause"
            @click="mode === 'playback' ? togglePlay() : null"
          ></video>

          <div v-if="!videoSrc" class="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            No recording on this channel.
          </div>

          <div v-if="connecting" class="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white gap-3">
            <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i>
            <span class="text-sm">Connecting to CH{{ ch }}…</span>
          </div>

          <!-- overlays -->
          <div class="absolute top-2 left-2 flex items-center gap-2 pointer-events-none">
            <span
              v-if="mode === 'live'"
              class="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold tracking-wide flex items-center gap-1"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> LIVE
            </span>
            <span class="px-1.5 py-0.5 rounded bg-black/60 text-white text-[11px] font-mono">{{ fmtClock(clock) }}</span>
          </div>
          <div class="absolute top-2 right-2 pointer-events-none">
            <span class="px-1.5 py-0.5 rounded bg-black/60 text-white text-[11px] font-bold">{{ speed }} km/h</span>
          </div>

          <div
            v-if="mode === 'playback' && paused && videoSrc && !connecting"
            class="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <span class="w-14 h-14 rounded-full bg-black/55 flex items-center justify-center text-white">
              <i class="fa-solid fa-play text-xl ml-1"></i>
            </span>
          </div>
        </div>

        <!-- transport -->
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2 flex items-center gap-3">
          <button
            v-if="mode === 'playback'"
            type="button"
            @click="togglePlay"
            class="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center shrink-0"
            :aria-label="paused ? 'Play' : 'Pause'"
          >
            <i class="fa-solid" :class="paused ? 'fa-play ml-0.5' : 'fa-pause'"></i>
          </button>
          <template v-if="mode === 'playback'">
            <span class="text-[11px] font-mono text-gray-500 w-10 text-right">{{ fmtDuration(progressT) }}</span>
            <input
              type="range"
              min="0"
              :max="clipDuration || 0"
              step="0.1"
              :value="progressT"
              @input="onScrub"
              class="flex-1 accent-brand"
              aria-label="Seek"
            />
            <span class="text-[11px] font-mono text-gray-500 w-10">{{ fmtDuration(clipDuration) }}</span>
          </template>
          <div v-else class="flex-1 text-xs text-gray-500">
            Real-time stream · sub-stream
          </div>
          <button type="button" @click="toggleMute" class="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 shrink-0" :aria-label="muted ? 'Unmute' : 'Mute'">
            <i class="fa-solid" :class="muted ? 'fa-volume-xmark' : 'fa-volume-high'"></i>
          </button>
          <button type="button" @click="fullscreen" class="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100 shrink-0" aria-label="Full screen">
            <i class="fa-solid fa-expand"></i>
          </button>
        </div>

        <!-- recordings -->
        <div v-if="mode === 'playback'" class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 space-y-3">
          <div class="text-xs font-bold text-gray-500 uppercase tracking-wide">Recordings</div>
          <div v-if="!clips.length" class="text-sm text-gray-400">No recordings on this channel.</div>
          <div v-for="g in clipGroups" :key="g.key">
            <div class="text-[11px] font-bold text-gray-400 mb-1.5">{{ g.label }}</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="c in g.clips"
                :key="c.id"
                type="button"
                @click="pickClip(c)"
                class="px-3 py-2 rounded-lg border text-left transition-colors"
                :class="clip?.id === c.id ? 'border-brand bg-brand-light' : 'border-gray-200 hover:border-brand'"
              >
                <div class="text-sm font-bold text-gray-800">{{ fmtClock(new Date(c.start)).slice(0, 5) }}</div>
                <div class="text-[11px] text-gray-500">{{ fmtDuration(c.duration) }} · {{ c.distanceKm.toFixed(1) }} km</div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- map column -->
      <div class="space-y-3 lg:sticky lg:top-32">
        <div class="relative h-[42vh] min-h-[260px] lg:h-[calc(100vh-11rem)] rounded-xl overflow-hidden shadow-sm border border-gray-200 bg-gray-100">
          <TrackMap :points="points" :position="position" :mode="mode" :trail="trail" @seek="seek" />
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="bg-white rounded-xl border border-gray-200 py-2">
            <div class="text-[10px] text-gray-400 uppercase font-bold">Speed</div>
            <div class="text-sm font-bold text-gray-800">{{ speed }} km/h</div>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 py-2">
            <div class="text-[10px] text-gray-400 uppercase font-bold">{{ mode === 'live' ? 'Time' : 'Recorded' }}</div>
            <div class="text-sm font-bold text-gray-800 font-mono">{{ fmtClock(clock) }}</div>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 py-2">
            <div class="text-[10px] text-gray-400 uppercase font-bold">{{ mode === 'live' ? 'Position' : 'Distance' }}</div>
            <div class="text-sm font-bold text-gray-800">
              <template v-if="mode === 'live'">{{ position ? `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}` : '—' }}</template>
              <template v-else>{{ distanceSoFar == null ? '—' : `${distanceSoFar.toFixed(2)} km` }}</template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
