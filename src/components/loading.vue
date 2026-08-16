<script setup>
/**
 * Boot progress surface. Two variants, one source of truth (stores/boot.js).
 *
 *   cold — full-screen, blocking. The first run of a session, when there is
 *          nothing on screen yet to protect. Logo + determinate bar + the live
 *          step label.
 *   warm — a 3px line under the safe-area inset, NON-blocking. A reconnect or
 *          refresh, where the app already has data on screen and covering it
 *          with a splash would be a downgrade.
 *
 * The `msg` prop is gone. It existed but App.vue never passed it, so every wait
 * in the app — cold boot, device refetch, geofence save — rendered the same
 * dead string ("Navitag Track"). The label comes from the boot store now and
 * says what is actually happening.
 *
 * No CSS transition on the bar width: the store already eases the value on
 * rAF, and layering a transition on top of a per-frame update reads as
 * rubber-banding. The one place a jump happens (the snap to 100% on complete)
 * is a single frame and imperceptible.
 */
import { computed } from 'vue';
import { useBootStore } from '@/stores/boot.js';

const props = defineProps({
  variant: {
    type: String,
    default: 'cold',
    validator: (v) => v === 'cold' || v === 'warm',
  },
});

const boot = useBootStore();

const pct = computed(() => `${Math.max(0, Math.min(100, boot.progress))}%`);
const rounded = computed(() => Math.round(boot.progress));
</script>

<template>
  <!-- WARM: a hairline under the status bar. Never blocks, never covers. -->
  <div
    v-if="props.variant === 'warm'"
    class="fixed left-0 right-0 top-[env(safe-area-inset-top)] z-50 h-[3px] pointer-events-none"
    role="progressbar"
    :aria-valuenow="rounded"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="boot.label"
  >
    <div class="h-full bg-brand rounded-r-full" :style="{ width: pct }"></div>
  </div>

  <!-- COLD: the full-screen splash. -->
  <div
    v-else
    class="fixed inset-0 z-50 bg-surface flex flex-col items-center justify-center px-10 pt-safe-top pb-safe-bottom"
  >
    <img
      src="/icons/icon-192.png"
      alt=""
      draggable="false"
      class="w-20 h-20 rounded-[22%] mb-9 select-none shadow-sm"
    />

    <div class="w-full max-w-[248px]">
      <div
        class="h-1.5 w-full rounded-full bg-black/[0.06] overflow-hidden"
        role="progressbar"
        :aria-valuenow="rounded"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="boot.label"
      >
        <div class="h-full bg-brand rounded-full" :style="{ width: pct }"></div>
      </div>

      <!-- min-height reserves the second line so the bar doesn't jump when a
           step goes slow and swaps in its longer message. -->
      <p
        class="mt-4 text-center text-sm text-gray-500 leading-snug min-h-[2.5rem]"
        aria-live="polite"
      >
        {{ boot.label }}
      </p>
    </div>
  </div>
</template>
