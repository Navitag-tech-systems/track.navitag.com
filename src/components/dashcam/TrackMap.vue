<script setup>
// Standalone Leaflet map for the dashcam viewer: the vehicle marker driven by
// the video clock, plus either the whole recorded track (playback, click to
// seek) or a short trail behind the marker (live). Deliberately separate from
// the app's global leafletMap so the viewer cannot disturb the main map's
// markers, selection or view.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import L from 'leaflet';
import { liqKey } from '@/utils/variables';
import { nearestTime } from '@/utils/dashcamDemo';

const props = defineProps({
  points: { type: Array, default: () => [] },     // [[t, lat, lng, speed, course], ...]
  position: { type: Object, default: null },       // { t, lat, lng, course }
  mode: { type: String, default: 'playback' },     // 'playback' | 'live'
  trail: { type: Array, default: () => [] },       // live: [[lat, lng], ...]
});
const emit = defineEmits(['seek']);

const el = ref(null);
const following = ref(true);
let map = null;
let full = null;
let progress = null;
let trailLine = null;
let startDot = null;
let endDot = null;
let marker = null;
let arrowEl = null;
let ro = null;
let progressIdx = -1;

const BRAND = '#0076f5';

function vehicleIcon() {
  return L.divIcon({
    className: 'dashcam-vehicle',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="dv-ring"><div class="dv-arrow"><svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="#fff" stroke="${BRAND}" stroke-width="1.6" stroke-linejoin="round"/></svg></div></div>`,
  });
}

function drawTrack() {
  if (!map) return;
  [full, progress, startDot, endDot].forEach((l) => l && l.remove());
  full = progress = startDot = endDot = null;
  progressIdx = -1;
  const pts = props.points || [];
  if (props.mode !== 'playback' || pts.length < 2) return;
  const ll = pts.map((p) => [p[1], p[2]]);
  full = L.polyline(ll, { color: '#94a3b8', weight: 6, opacity: 0.9 }).addTo(map);
  full.on('click', (e) => {
    const t = nearestTime(pts, e.latlng.lat, e.latlng.lng);
    if (t != null) emit('seek', t);
  });
  progress = L.polyline([], { color: BRAND, weight: 6, interactive: false }).addTo(map);
  startDot = L.circleMarker(ll[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).addTo(map);
  endDot = L.circleMarker(ll[ll.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).addTo(map);
  map.fitBounds(full.getBounds(), { padding: [30, 30], maxZoom: 17 });
  following.value = false;
}

function updatePosition() {
  if (!map) return;
  const p = props.position;
  if (!p) return;
  const ll = [p.lat, p.lng];
  if (!marker) {
    marker = L.marker(ll, { icon: vehicleIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
    arrowEl = marker.getElement()?.querySelector('.dv-arrow') || null;
    if (props.mode === 'live') map.setView(ll, 16);
  } else {
    marker.setLatLng(ll);
  }
  if (!arrowEl) arrowEl = marker.getElement()?.querySelector('.dv-arrow') || null;
  if (arrowEl) arrowEl.style.transform = `rotate(${Math.round(p.course || 0)}deg)`;

  if (progress) {
    const pts = props.points;
    const idx = Math.min(Math.floor(p.t || 0), pts.length - 1);
    if (idx !== progressIdx) {
      progressIdx = idx;
      progress.setLatLngs(pts.slice(0, idx + 1).map((q) => [q[1], q[2]]).concat([ll]));
    } else {
      const lls = progress.getLatLngs();
      if (lls.length) {
        lls[lls.length - 1] = L.latLng(ll);
        progress.setLatLngs(lls);
      }
    }
  }

  if (following.value) {
    const inner = map.getBounds().pad(-0.25);
    if (!inner.contains(ll)) map.panTo(ll, { animate: true, duration: 0.4 });
  }
}

function updateTrail() {
  if (!map) return;
  if (props.mode !== 'live') {
    trailLine?.remove();
    trailLine = null;
    return;
  }
  if (!trailLine) trailLine = L.polyline([], { color: BRAND, weight: 5, opacity: 0.8, interactive: false }).addTo(map);
  trailLine.setLatLngs(props.trail || []);
}

function recenter() {
  following.value = true;
  if (props.mode === 'playback' && full) {
    map.fitBounds(full.getBounds(), { padding: [30, 30], maxZoom: 17 });
  } else if (props.position) {
    map.setView([props.position.lat, props.position.lng], Math.max(map.getZoom(), 16));
  }
}

onMounted(() => {
  // rotateControl: leaflet-rotate (loaded by the app's main map) patches every
  // L.map and adds a compass by default.
  map = L.map(el.value, {
    zoomControl: false, attributionControl: false, rotateControl: false, center: [14.5995, 120.9842], zoom: 13,
  });
  L.tileLayer(`https://{s}-tiles.locationiq.com/v3/streets/r/{z}/{x}/{y}.png?key=${liqKey}`, {
    subdomains: 'abc', maxZoom: 19,
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.on('dragstart', () => { following.value = false; });
  ro = new ResizeObserver(() => map && map.invalidateSize());
  ro.observe(el.value);
  drawTrack();
  updateTrail();
  updatePosition();
});

onBeforeUnmount(() => {
  ro?.disconnect();
  map?.remove();
  map = null;
  marker = null;
  arrowEl = null;
  trailLine = null;
});

watch(() => [props.points, props.mode], () => { drawTrack(); updateTrail(); });
watch(() => props.position, updatePosition);
watch(() => props.trail, updateTrail);
</script>

<template>
  <div class="relative w-full h-full">
    <div ref="el" class="absolute inset-0 z-0"></div>
    <button
      type="button"
      @click="recenter"
      class="absolute top-3 right-3 z-[500] w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center text-gray-600 hover:text-brand"
      :class="following ? 'text-brand' : ''"
      :aria-label="mode === 'playback' ? 'Show whole trip' : 'Follow vehicle'"
    >
      <i class="fa-solid" :class="mode === 'playback' ? 'fa-expand' : 'fa-location-crosshairs'"></i>
    </button>
  </div>
</template>

<style>
.dashcam-vehicle { background: transparent; border: 0; }
.dashcam-vehicle .dv-ring {
  width: 34px; height: 34px; border-radius: 9999px;
  background: #0076f5; box-shadow: 0 0 0 4px rgba(0, 118, 245, 0.25), 0 2px 6px rgba(0, 0, 0, 0.3);
  display: flex; align-items: center; justify-content: center;
}
.dashcam-vehicle .dv-arrow { width: 22px; height: 22px; transition: transform 0.2s linear; }
</style>
