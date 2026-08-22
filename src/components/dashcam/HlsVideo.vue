<script setup>
// <video> that plays an HLS manifest. Safari / iOS WKWebView play .m3u8
// natively; Android WebView + desktop Chrome need hls.js, which is imported
// lazily so it only ships to users who open a dashcam (separate chunk, see
// vite.config.js manualChunks).
import { ref, watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  src: { type: String, default: '' },
  // true = plain mp4 (or anything the browser plays natively), skip hls.js.
  native: { type: Boolean, default: false },
  muted: { type: Boolean, default: true },
});
const emit = defineEmits(['playing', 'error', 'ended']);

const videoEl = ref(null);
let hls = null;

function destroy() {
  if (hls) {
    try { hls.destroy(); } catch { /* ignore */ }
    hls = null;
  }
  const v = videoEl.value;
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
  }
}

async function attach(src) {
  destroy();
  const v = videoEl.value;
  if (!v || !src) return;

  const isHls = !props.native && /\.m3u8(\?|$)/i.test(src);
  if (!isHls || v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = src;
    v.play().catch(() => { /* autoplay may need a gesture; the controls are visible */ });
    return;
  }

  let Hls;
  try {
    ({ default: Hls } = await import('hls.js'));
  } catch (err) {
    emit('error', 'Video player failed to load.');
    return;
  }
  if (!Hls.isSupported()) {
    emit('error', 'This browser cannot play live video.');
    return;
  }
  hls = new Hls({
    lowLatencyMode: true,
    liveSyncDurationCount: 2,
    // Send the Traccar session cookie with manifest/segment requests.
    xhrSetup: (xhr) => { xhr.withCredentials = true; },
  });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data?.fatal) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      hls.startLoad();
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
    } else {
      emit('error', 'Playback failed.');
    }
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    v.play().catch(() => { /* gesture needed */ });
  });
  hls.loadSource(src);
  hls.attachMedia(v);
}

watch(() => props.src, (s) => { attach(s); });

// The ref is only set after mount, so the initial attach has to wait for it.
watch(videoEl, (v) => { if (v && props.src) attach(props.src); });

onBeforeUnmount(destroy);
</script>

<template>
  <video
    ref="videoEl"
    class="w-full h-full bg-black"
    playsinline
    controls
    :muted="muted"
    @playing="emit('playing')"
    @ended="emit('ended')"
    @error="emit('error', 'Playback failed.')"
  ></video>
</template>
