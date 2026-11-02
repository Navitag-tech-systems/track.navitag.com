<script setup>
// Download 1-10 minutes of ONE camera, ending at the playhead.
//
// The clip is always cut on the server (no hour-long file ever reaches the
// phone), from the hub-sync copy when one file holds the whole range, else
// from the medusa rolling cache. Parts the cache lacks are fetched from the
// camera first: each is streamed (0x9201) to the medusa receiver, which
// records it into the cache; only those parts, never anything already cached.
// The camera streams in real time, so that step takes as long as the missing
// video. None of this is named in the UI.
//
// Two taps by design: Download prepares + fetches, Save hands the file to the
// share sheet / Downloads (navigator.share needs a fresh gesture).
import { ref, computed, onBeforeUnmount } from 'vue';
import {
  DOWNLOAD_MINUTES, sliceBefore, planDownload, coveredMs, fmtHMS,
  fetchRecIndex, labelPlayback, playbackCommand, stopPlaybackCommand, playbackEchoes, echoKey,
} from '@/utils/dashcamPlayback';
import { terminalSim, sendCommand, liveHlsUrl, clipUrl } from '@/utils/dashcam';
import { fetchVideo, saveFiles, isNative, openInSystemBrowser } from '@/utils/saveVideo';

const props = defineProps({
  device: { type: Object, required: true },
  server: { type: String, required: true },
  online: { type: Boolean, default: false },
  channels: { type: Array, required: true },       // [{ index, name }]
  ch: { type: Number, required: true },            // the camera being watched
  t: { type: Number, required: true },             // playhead
  clips: { type: Array, default: () => [] },
  cache: { type: Object, default: () => ({}) },
  hubCheck: { type: Function, required: true },    // (lookupUrl) => Promise<boolean>
});
const emit = defineEmits(['close']);

const minutes = ref(3);
const camera = ref(props.ch);
const slice = computed(() => sliceBefore(props.t, minutes.value));

// idle | preparing | downloading | ready | saved | error
const phase = ref('idle');
const errorMsg = ref('');
const prep = ref({ done: 0, total: 0 });           // ms of missing video fetched
const bytes = ref({ loaded: 0, total: 0 });
const file = ref(null);
const busy = computed(() => phase.value === 'preparing' || phase.value === 'downloading');

let cancelled = false;
let streaming = null;   // camera currently streaming for us
let fetchAbort = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ONE bar for the whole job. Getting missing video from the camera runs in
// real time and dominates, so when there is any it gets most of the bar and
// the file transfer the rest; otherwise the transfer is the whole bar.
const PREP_SHARE = 0.85;
const overallPct = computed(() => {
  const hasPrep = prep.value.total > 0;
  const share = hasPrep ? PREP_SHARE : 0;
  const p = hasPrep ? Math.min(1, prep.value.done / prep.value.total) : 0;
  const b = bytes.value.total ? Math.min(1, bytes.value.loaded / bytes.value.total) : 0;
  const v = phase.value === 'downloading' ? share + (1 - share) * b : share * p;
  return Math.max(2, Math.round(v * 100));
});

function fail(msg) {
  phase.value = 'error';
  errorMsg.value = msg;
}

async function stopStreaming() {
  if (streaming == null) return;
  const c = streaming;
  streaming = null;
  try { await sendCommand(props.server, props.device.id, stopPlaybackCommand(c)); } catch { /* best effort */ }
}

// The receiver writes the cache in 6 s segments and only flushes the last,
// partial one when the stream closes, so a piece counts as fetched once all
// but that tail is in; stopping the stream then writes the tail.
const TAIL_MS = 7500;

// Stream one missing piece into the cache and wait until it is there.
async function fetchPiece(cam, piece, doneBefore) {
  await labelPlayback(props.device, cam, piece.start).catch(() => {});
  // Its one-entry 0x1205 echo must not pass for a clip list the player is waiting on.
  playbackEchoes.add(echoKey(cam, piece.start, piece.end));
  await sendCommand(props.server, props.device.id, playbackCommand(props.device, cam, piece.start, piece.end));
  streaming = cam;
  const need = piece.end - piece.start;
  const deadline = Date.now() + need + 90_000;
  const live = liveHlsUrl(props.device, cam);
  let lastGain = Date.now();
  let lastCovered = 0;
  for (;;) {
    if (cancelled) return false;
    await sleep(3000);
    // Counts as a viewer: the receiver closes streams nobody fetches.
    fetch(`${live}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' }).catch(() => {});
    let idx = null;
    try { idx = await fetchRecIndex(props.device); } catch { /* try again */ }
    const got = idx ? coveredMs(idx[cam], piece.start, piece.end) : lastCovered;
    if (got > lastCovered + 500) { lastCovered = got; lastGain = Date.now(); }
    prep.value = { ...prep.value, done: doneBefore + Math.min(got, need) };
    if (got >= need - TAIL_MS) break;
    // The camera stopped sending (end of its file, or it went to sleep).
    if (Date.now() - lastGain > 45_000 || Date.now() > deadline) {
      if (got > 0) break;
      await stopStreaming();
      throw new Error('The camera did not send this part of the video.');
    }
  }
  // `got` excludes the tail segment the receiver has not written yet. The
  // camera is still sending that tail: wait it out before stopping, or the
  // stop cuts it off (measured: a 60 s piece came back 56 s).
  const tail = Math.max(0, need - lastCovered);
  if (tail > 0 && !cancelled) await sleep(Math.min(tail, TAIL_MS) + 1500);
  await stopStreaming();
  // The close flushes the tail segment; give the receiver time to write it and
  // end the session before the next request opens a new one.
  await sleep(2500);
  prep.value = { ...prep.value, done: doneBefore + need };
  return true;
}

async function download() {
  cancelled = false;
  errorMsg.value = '';
  file.value = null;
  phase.value = 'preparing';
  prep.value = { done: 0, total: 0 };
  const cam = camera.value;
  const { from, to } = slice.value;
  const sim = terminalSim(props.device);
  try {
    let cache = props.cache;
    try { cache = await fetchRecIndex(props.device); } catch { /* use what we have */ }

    // The hub copy needs a HEAD. planDownload trims the range to where video
    // exists before looking for one file that holds it all, so check every
    // file of this camera that overlaps the range, not only one spanning it.
    const hubOk = new Map();
    const overlapping = props.clips.filter((c) => c.ch === cam && c.start.getTime() < to && c.end.getTime() > from);
    await Promise.all(overlapping.map(async (c) => {
      const u = clipUrl(props.device.uniqueId, c);
      hubOk.set(u, await props.hubCheck(u));
    }));
    let plan = planDownload({
      ch: cam, from, to, clips: props.clips, cache, uniqueId: props.device.uniqueId, sim,
      hubOk: (u) => hubOk.get(u) === true,
    });
    if (plan.kind === 'none') return fail('There is no video from this camera in this time range.');

    if (plan.kind === 'cache' && plan.pieces.length) {
      if (!props.online) return fail('The camera is off. Try again when the vehicle is on.');
      prep.value = { done: 0, total: plan.pieces.reduce((s, p) => s + (p.end - p.start), 0) };
      let done = 0;
      for (const piece of plan.pieces) {
        const ok = await fetchPiece(cam, piece, done);
        if (!ok) return;
        done += piece.end - piece.start;
      }
      if (cancelled) return;
    }

    if (isNative()) {
      // The WebView cannot hold an object-URL download; the system browser saves it.
      await openInSystemBrowser(plan.url);
      emit('close');
      return;
    }
    phase.value = 'downloading';
    bytes.value = { loaded: 0, total: 0 };
    fetchAbort = new AbortController();
    const name = `${props.device.name || 'dashcam'}_${props.channels.find((c) => c.index === cam)?.name || 'ch' + cam}_${fmtHMS(plan.from).replace(/:/g, '')}.mp4`.replace(/\s+/g, '_');
    file.value = await fetchVideo(plan.url, {
      signal: fetchAbort.signal,
      fallbackName: name,
      onProgress: (p) => { bytes.value = p; },
    });
    phase.value = 'ready';
  } catch (err) {
    if (cancelled || err?.name === 'AbortError') { phase.value = 'idle'; return; }
    fail(err?.status === 403 ? 'You do not have permission to use this camera.' : (err?.message || 'Download failed.'));
  } finally {
    await stopStreaming();
  }
}

async function save() {
  const r = await saveFiles([file.value]);
  if (r !== 'cancelled') phase.value = 'saved';
}

function cancel() {
  cancelled = true;
  fetchAbort?.abort();
  fetchAbort = null;
  stopStreaming();
}

function close() {
  cancel();
  emit('close');
}

onBeforeUnmount(cancel);
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center bg-black/50" @click.self="!busy && close()">
    <section role="dialog" aria-label="Download video" class="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl px-4 pt-2.5 flex flex-col gap-3.5" style="padding-bottom: max(1.25rem, env(safe-area-inset-bottom))">
      <span class="self-center w-10 h-1 rounded-full bg-gray-300 sm:hidden"></span>
      <div class="flex items-start justify-between">
        <div>
          <h2 class="text-lg font-bold text-gray-800">Download video</h2>
          <p class="text-xs text-gray-500 mt-0.5 tabular-nums">{{ fmtHMS(slice.from) }} – {{ fmtHMS(slice.to) }}</p>
        </div>
        <button type="button" @click="close" class="w-11 h-11 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Length">
        <button
          v-for="m in DOWNLOAD_MINUTES"
          :key="m"
          type="button"
          role="radio"
          :aria-checked="minutes === m"
          :disabled="busy"
          @click="minutes = m; phase = 'idle'"
          class="h-10 rounded-[10px] text-[13px] font-bold border disabled:opacity-50"
          :class="minutes === m ? 'bg-brand border-brand text-white' : 'bg-white border-gray-200 text-gray-700'"
        >{{ m }} min</button>
      </div>

      <fieldset class="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-100" :disabled="busy">
        <legend class="sr-only">Camera</legend>
        <label v-for="c in channels" :key="c.index" class="flex items-center gap-3 px-3 py-3 cursor-pointer">
          <input type="radio" name="dl-camera" class="w-[22px] h-[22px] accent-brand" :value="c.index" v-model="camera" @change="phase = 'idle'">
          <span class="flex-1 text-sm font-bold text-gray-800">{{ c.name }}</span>
          <span v-if="c.index === ch" class="text-[11px] text-gray-500">Watching</span>
        </label>
      </fieldset>

      <div v-if="busy" class="flex flex-col gap-2">
        <div class="flex justify-between text-xs text-gray-600">
          <span>Downloading video…</span>
          <span class="tabular-nums">{{ overallPct }}%</span>
        </div>
        <div class="h-1.5 rounded-full bg-gray-200 overflow-hidden" role="progressbar" :aria-valuenow="overallPct" aria-valuemin="0" aria-valuemax="100">
          <div class="h-1.5 bg-brand transition-[width]" :style="{ width: overallPct + '%' }"></div>
        </div>
        <button type="button" @click="cancel" class="h-11 rounded-xl border border-gray-200 text-sm font-bold text-gray-700">Cancel</button>
      </div>

      <p v-if="phase === 'error'" class="text-xs text-red-600">{{ errorMsg }}</p>

      <button
        v-if="phase === 'ready'"
        type="button"
        @click="save"
        class="h-[52px] rounded-2xl bg-brand hover:bg-brand-dark text-white text-[15px] font-bold flex items-center justify-center gap-2"
      >
        <i class="fa-solid fa-floppy-disk"></i>
        Save video
      </button>
      <p v-else-if="phase === 'saved'" class="text-center text-sm font-bold text-green-700">Saved.</p>
      <button
        v-else-if="!busy"
        type="button"
        @click="download"
        class="h-[52px] rounded-2xl bg-brand hover:bg-brand-dark text-white text-[15px] font-bold flex items-center justify-center gap-2"
      >
        <i class="fa-solid fa-download"></i>
        Download {{ minutes }} min
      </button>
    </section>
  </div>
</template>
