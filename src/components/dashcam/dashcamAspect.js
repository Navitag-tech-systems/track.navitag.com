// Video frame aspect (width / height) per device AND mode, remembered for the
// session so a restart opens at the right shape. Live and recorded video differ
// on the same unit: the V5N streams live at 704x576 (11:9) but records 1280x720
// (16:9). These are the defaults until a stream reports its real size.
import { ref } from 'vue';

export const DEFAULT_VIDEO_ASPECT = { live: 11 / 9, playback: 16 / 9 };
const cache = new Map();

export function useVideoAspect(deviceId, mode) {
  const key = `${deviceId}:${mode}`;
  const aspect = ref(cache.get(key) ?? DEFAULT_VIDEO_ASPECT[mode] ?? 16 / 9);
  function onAspect(a) {
    if (!(a > 0.5 && a < 3)) return;
    cache.set(key, a);
    aspect.value = a;
  }
  return { aspect, onAspect };
}
