<script setup>
/**
 * Error overlay. Shown while userStore.error is true.
 *
 * "Restart the app" was the only advice here. The Reconnect button runs a cold
 * start when the app never finished loading (typically a failed /user/sync,
 * where there is no Traccar session to resume) and a warm reconnect otherwise.
 * On failure the session code sets userStore.error again, so this overlay
 * stays up with the button re-enabled.
 */
import { ref } from 'vue';
import { reconnectFromOverlay } from '@/utils/lifecycle/reconnect';

const props = defineProps({
  msg: {
    type: String,
    default: 'Something went wrong.'
  }
})

const working = ref(false);

async function reconnect() {
  if (working.value) return;
  working.value = true;
  try {
    // 'offline' flips userStore.internet to false, which puts <NoNet /> (and
    // its own button) on top of this overlay.
    await reconnectFromOverlay();
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-surface flex flex-col items-center justify-center pt-safe-top pb-safe-bottom px-6">
    <i class="fa-solid fa-circle-xmark text-4xl text-red-500"></i>

    <h1 class="text-xl font-bold text-gray-800 my-4">Error</h1>

    <p class="text-sm text-gray-500 max-w-xs leading-relaxed text-center">
      {{ props.msg }}
    </p>

    <div class="mt-8 w-full max-w-xs">
      <button
        type="button"
        class="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-60"
        :disabled="working"
        @click="reconnect"
      >
        <i v-if="working" class="fa-solid fa-spinner fa-spin mr-2"></i>
        <i v-else class="fa-solid fa-rotate-right mr-2"></i>
        {{ working ? 'Reconnecting…' : 'Reconnect' }}
      </button>
    </div>
  </div>
</template>
