<script setup>
// <video> that plays an HLS manifest. Safari / iOS WKWebView play .m3u8
// natively; Android WebView + desktop Chrome need hls.js, which is imported
// lazily so it only ships to users who open a dashcam (separate chunk, see
// vite.config.js manualChunks).
import { ref, watch, onBeforeUnmount } from 'vue';
import { LIVE_HLS_BASE } from '@/utils/dashcam';

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

// iOS (every browser there is WebKit) and desktop Safari.
function appleWebKit() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;   // iPadOS desktop UA
  return /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua);
}

async function attach(src) {
  destroy();
  const v = videoEl.value;
  if (!v || !src) return;

  const isHls = !props.native && /\.m3u8(\?|$)/i.test(src);
  // Only Traccar playback (/api/stream) needs the session cookie. The medusa
  // live re-mux answers `Access-Control-Allow-Origin: *`, and browsers reject
  // a credentialed response with a wildcard origin, so live must go without.
  const withCookie = !src.startsWith(LIVE_HLS_BASE);
  // Native HLS only on Apple WebKit. Chrome now also answers canPlayType for
  // HLS, but its built-in player dies on the live re-mux after a few minutes
  // (DEMUXER_ERROR_COULD_NOT_PARSE, Chrome 156, 2026-10-29); hls.js does not.
  if (!isHls || (v.canPlayType('application/vnd.apple.mpegurl') && appleWebKit())) {
    // Cross-origin segments need the Traccar cookie; use-credentials makes
    // Safari's native HLS send it (matches hls.js xhr.withCredentials below).
    if (withCookie) v.crossOrigin = 'use-credentials';
    // The native player (iOS Safari) otherwise fails silently — surface the real
    // MediaError code so a field failure is diagnosable (2=network, 3=decode,
    // 4=src-not-supported/format). Retry ONCE without CORS credentials in case
    // use-credentials is the blocker (segments are same-site; the cookie still flows).
    let triedPlain = false;
    v.addEventListener('error', () => {
      const e = v.error;
      if (!triedPlain && e && (e.code === 2 || e.code === 4)) {
        triedPlain = true;
        v.removeAttribute('crossorigin');
        v.src = src;
        v.load();
        v.play().catch(() => {});
        return;
      }
      emit('error', `Playback failed (native code ${e ? e.code : '?'}${e && e.message ? ': ' + String(e.message).slice(0, 40) : ''}).`);
    });
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
    // Traccar serves PLAIN live HLS (no LL-HLS parts / blocking reload). With
    // lowLatencyMode:true hls.js issues _HLS_msn blocking-reload requests and
    // expects partial segments the server never sends, which fatals the LIVE
    // stream (bounded SD playback was unaffected). Standard live playback works.
    lowLatencyMode: false,
    liveSyncDurationCount: 3,
    maxBufferLength: 20,
    nudgeMaxRetry: 30,
    // Send the Traccar session cookie with manifest/segment requests.
    xhrSetup: (xhr) => { xhr.withCredentials = withCookie; },
  });
  let recoveries = 0;
  // A LIVE session runs for minutes; transient fatals (a dropped segment fetch,
  // a momentary unbufferable frame) are normal and hls.js recovers from them.
  // Reset the counter whenever a fragment buffers successfully, so only a run of
  // CONSECUTIVE unrecovered fatals (a genuinely dead stream) gives up. The old
  // lifetime cap of 3 killed healthy streams after a few blips spread over time.
  hls.on(Hls.Events.FRAG_BUFFERED, () => { recoveries = 0; });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data?.fatal) return;
    if (recoveries < 6 && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      recoveries++; hls.startLoad(); return;
    }
    if (recoveries < 6 && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      recoveries++; hls.recoverMediaError(); return;
    }
    // Every fatal path now names the hls.js detail on-screen.
    emit('error', `Playback failed (${data?.details || data?.type || 'unknown'}).`);
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
  ></video>
</template>
