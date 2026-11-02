<script setup>
// Hour timeline under the video: the strip scrolls under a FIXED centre
// playhead (drag / swipe / wheel to scrub). Speed from GPS on top, one band
// for "video exists here" below it — deliberately one colour whatever the
// video's source — plus alarm marks and minute ticks.
//
// Emits `scrub` while the strip moves under a finger and `seek` once it
// settles, so the parent can preview the map/time live and only load video
// at the end of a drag.
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

const MIN_MS = 60_000;

const props = defineProps({
  from: { type: Number, required: true },
  to: { type: Number, required: true },
  t: { type: Number, required: true },
  ranges: { type: Array, default: () => [] },      // [{ start, end }]
  speeds: { type: Array, default: () => [] },      // [{ t, kmh }]
  alarms: { type: Array, default: () => [] },      // [ms]
  checking: { type: Boolean, default: false },     // clip list for this hour is being fetched
});
const emit = defineEmits(['scrub', 'seek']);

const ZOOMS = [6, 12, 24, 48];                    // px per minute
const zoom = ref(2);
const pxPerMin = computed(() => ZOOMS[zoom.value]);

const box = ref(null);
const width = ref(360);
const pad = computed(() => Math.round(width.value / 2));
const minutes = computed(() => Math.max(1, (props.to - props.from) / MIN_MS));
const innerW = computed(() => Math.round(pad.value * 2 + minutes.value * pxPerMin.value));
const x = (t) => pad.value + ((t - props.from) / MIN_MS) * pxPerMin.value;

const H_SPEED = 34;
const BAND_Y = 42;
const BAND_H = 18;
const TICK_Y = BAND_Y + BAND_H + 4;

const speedPath = computed(() => {
  const s = props.speeds;
  if (s.length < 2) return '';
  const max = Math.max(40, ...s.map((p) => p.kmh));
  let d = '';
  let prev = null;
  for (const p of s) {
    const px = x(p.t).toFixed(1);
    const py = (H_SPEED - (p.kmh / max) * (H_SPEED - 4)).toFixed(1);
    // Break the line across GPS gaps longer than 2 min.
    d += (prev == null || p.t - prev > 2 * MIN_MS ? 'M' : 'L') + px + ' ' + py + ' ';
    prev = p.t;
  }
  return d;
});

const bands = computed(() => props.ranges.map((r) => ({ x: x(r.start), w: Math.max(2, x(r.end) - x(r.start)) })));
const marks = computed(() => props.alarms.map((t) => x(t)));

const ticks = computed(() => {
  const out = [];
  const step = pxPerMin.value >= 24 ? 1 : pxPerMin.value >= 12 ? 5 : 10;
  const labelEvery = pxPerMin.value >= 24 ? 5 : pxPerMin.value >= 12 ? 10 : 15;
  for (let m = 0; m <= minutes.value; m += step) {
    const t = props.from + m * MIN_MS;
    const d = new Date(t);
    const major = m % labelEvery === 0;
    out.push({
      x: x(t),
      major,
      label: major ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '',
    });
  }
  return out;
});

// --- scroll <-> time -------------------------------------------------------------
//
// A scroll is the USER's only while a pointer is down or a touch / wheel / key
// input happened moments ago (momentum included). Every other scroll event is
// this component repositioning itself (new hour, new zoom, the video clock) and
// must never be read back as a seek — a one-shot "programmatic" flag cannot do
// that: two repositions in one tick, or one that does not move, leave it wrong
// and the next stray event seeks to a meaningless time.

const MOMENTUM_MS = 900;
let pointerDown = false;
let userUntil = 0;
let settleTimer = null;
const dragging = ref(false);

function userInput(ms = MOMENTUM_MS) {
  userUntil = Date.now() + ms;
}
// Mouse: drag scrolls the strip (a mouse cannot pan an overflow box natively).
// Mouse or finger: a press that barely moves is a click/tap — jump there.
let press = null;   // { x, y, scroll, mouse, moved, at }

function timeAtClientX(clientX) {
  const el = box.value;
  const rect = el.getBoundingClientRect();
  return timeFor(el.scrollLeft + (clientX - rect.left) - pad.value);
}

function onPointerDown(e) {
  pointerDown = true;
  userInput();
  press = { x: e.clientX, y: e.clientY, scroll: box.value.scrollLeft, mouse: e.pointerType === 'mouse', moved: false, at: Date.now() };
  if (press.mouse) box.value.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e) {
  if (!press) return;
  const dx = e.clientX - press.x;
  if (Math.abs(dx) > 4 || Math.abs(e.clientY - press.y) > 4) press.moved = true;
  if (press.mouse && press.moved) {
    userInput();
    box.value.scrollLeft = press.scroll - dx;
  }
}

function onPointerUp(e) {
  pointerDown = false;
  userInput();
  const p = press;
  press = null;
  if (!p || e.type === 'pointercancel') return;
  if (p.mouse) box.value.releasePointerCapture?.(e.pointerId);
  if (p.mouse && p.moved) {
    // A mouse drag ends with no further scroll event: settle it here.
    resetDrag();
    emit('seek', timeFor(box.value.scrollLeft));
    return;
  }
  if (!p.moved && Date.now() - p.at < 600) {
    const t = timeAtClientX(e.clientX);
    resetDrag();
    emit('seek', t);
  }
}

// A plain vertical wheel scrolls the strip sideways.
function onWheel(e) {
  userInput(400);
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    box.value.scrollLeft += e.deltaY;
  }
}

function onKey(e) {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') userInput(400);
}

// Whole-hour overview slider: jump anywhere in the hour in one move.
const overview = computed(() => props.ranges.map((r) => ({
  left: ((r.start - props.from) / (props.to - props.from)) * 100,
  width: Math.max(0.4, ((r.end - r.start) / (props.to - props.from)) * 100),
})));
const headPct = computed(() => ((props.t - props.from) / (props.to - props.from)) * 100);

function onOverviewInput(e) {
  emit('scrub', Number(e.target.value));
}
function onOverviewChange(e) {
  resetDrag();
  emit('seek', Number(e.target.value));
}

function scrollFor(t) {
  return ((t - props.from) / MIN_MS) * pxPerMin.value;
}

function timeFor(scrollLeft) {
  const t = props.from + (scrollLeft / pxPerMin.value) * MIN_MS;
  return Math.max(props.from, Math.min(props.to - 1000, t));
}

function placeAt(t) {
  const el = box.value;
  if (!el) return;
  const target = Math.round(scrollFor(t));
  if (Math.abs(el.scrollLeft - target) < 1) return;
  el.scrollLeft = target;
}

function onScroll() {
  const el = box.value;
  if (!el) return;
  if (!pointerDown && Date.now() > userUntil) return;   // our own reposition
  if (!pointerDown) userInput();                         // momentum keeps it the user's
  dragging.value = true;
  const t = timeFor(el.scrollLeft);
  emit('scrub', t);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    if (pointerDown) return;            // still held: the pointerup scroll settles it
    dragging.value = false;
    emit('seek', timeFor(el.scrollLeft));
  }, 220);
}

// A new hour or zoom cancels any half-finished drag.
function resetDrag() {
  clearTimeout(settleTimer);
  dragging.value = false;
  userUntil = 0;
}

watch(() => props.t, (t) => { if (!dragging.value) placeAt(t); });
watch(() => [props.from, props.to], () => { resetDrag(); nextTick(() => placeAt(props.t)); });

function setZoom(dz) {
  const z = Math.max(0, Math.min(ZOOMS.length - 1, zoom.value + dz));
  if (z === zoom.value) return;
  resetDrag();
  zoom.value = z;
  nextTick(() => placeAt(props.t));
}

let ro = null;
onMounted(() => {
  ro = new ResizeObserver(() => {
    width.value = box.value?.clientWidth || 360;
    nextTick(() => placeAt(props.t));
  });
  ro.observe(box.value);
  width.value = box.value.clientWidth || 360;
  nextTick(() => placeAt(props.t));
});
onBeforeUnmount(() => {
  ro?.disconnect();
  clearTimeout(settleTimer);
});
</script>

<template>
  <div class="select-none">
    <div class="relative">
    <div
      ref="box"
      class="overflow-x-auto overflow-y-hidden no-scrollbar"
      style="touch-action: pan-x; overscroll-behavior-x: contain"
      @scroll.passive="onScroll"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
      @keydown="onKey"
      role="slider"
      :aria-valuemin="from"
      :aria-valuemax="to"
      :aria-valuenow="Math.round(t)"
      aria-label="Playback time"
      tabindex="0"
    >
      <svg :width="innerW" height="84" class="block">
        <defs>
          <pattern id="pt-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#eceae4" />
            <rect width="4" height="8" fill="#dcd8cf" />
          </pattern>
        </defs>
        <rect :x="pad" :y="BAND_Y" :width="innerW - pad * 2" :height="BAND_H" rx="4" :fill="checking ? 'url(#pt-hatch)' : '#eceae4'" />
        <rect v-for="(b, i) in bands" :key="'b' + i" :x="b.x" :y="BAND_Y" :width="b.w" :height="BAND_H" rx="3" fill="#0076f5" />
        <path v-if="speedPath" :d="speedPath" fill="none" stroke="#8b939e" stroke-width="2" stroke-linejoin="round" />
        <rect v-for="(m, i) in marks" :key="'m' + i" :x="m - 1.5" :y="BAND_Y - 6" width="3" :height="BAND_H + 12" rx="1.5" fill="#c2410c" />
        <g v-for="(tk, i) in ticks" :key="'t' + i">
          <line :x1="tk.x" :x2="tk.x" :y1="TICK_Y" :y2="TICK_Y + (tk.major ? 7 : 4)" stroke="#9aa3ae" stroke-width="1" />
          <text v-if="tk.label" :x="tk.x" :y="TICK_Y + 18" text-anchor="middle" font-size="10" fill="#5f6672">{{ tk.label }}</text>
        </g>
      </svg>
    </div>
    <div class="pointer-events-none absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-gray-900"></div>
    <div v-if="checking" class="pointer-events-none absolute left-0 right-0 flex justify-center" :style="{ top: BAND_Y + 1 + 'px' }">
      <span class="text-[10px] font-bold text-gray-600 bg-white/80 px-1.5 rounded">Looking for video…</span>
    </div>
    <div class="absolute right-1 top-0 flex flex-col gap-1">
      <button type="button" @click="setZoom(1)" :disabled="zoom === ZOOMS.length - 1" class="w-7 h-7 rounded-md bg-white/90 border border-gray-200 text-gray-600 text-sm font-bold disabled:opacity-40" aria-label="Zoom in">+</button>
      <button type="button" @click="setZoom(-1)" :disabled="zoom === 0" class="w-7 h-7 rounded-md bg-white/90 border border-gray-200 text-gray-600 text-sm font-bold disabled:opacity-40" aria-label="Zoom out">−</button>
    </div>
    </div>

    <!-- Whole hour at a glance; drag the thumb to jump anywhere in it. -->
    <div class="relative h-7 mx-4 mt-1">
      <div class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-[#eceae4] overflow-hidden">
        <span v-for="(o, i) in overview" :key="'o' + i" class="absolute top-0 bottom-0 bg-brand/70" :style="{ left: o.left + '%', width: o.width + '%' }"></span>
      </div>
      <span class="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-[3px] border-gray-900 shadow" :style="{ left: headPct + '%' }"></span>
      <input
        type="range"
        class="overview absolute inset-0 w-full h-full cursor-pointer"
        :min="from"
        :max="to - 1000"
        step="1000"
        :value="Math.round(t)"
        aria-label="Jump within the hour"
        @input="onOverviewInput"
        @change="onOverviewChange"
      >
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar { scrollbar-width: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }
/* The range input only catches the gesture; the bar and thumb above are drawn. */
.overview { appearance: none; -webkit-appearance: none; background: transparent; opacity: 0; margin: 0; }
</style>
