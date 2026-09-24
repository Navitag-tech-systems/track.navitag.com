<script setup>
/**
 * OFFLINE overlay. Shown while userStore.internet is false.
 *
 * The Reconnect button exists because `internet` is event-driven and an event
 * missed while backgrounded used to strand the user here with the phone
 * online; the only way out was a restart. reconnectFromOverlay re-reads the
 * status itself, so a tap either recovers or reports "Still offline".
 */
import { ref } from 'vue';
import { reconnectFromOverlay } from '@/utils/lifecycle/reconnect';

const props = defineProps({
  msg: {
    type: String,
    default: 'App Requires Active Internet Connection'
  }
})

const working = ref(false);
const stillOffline = ref(false);

async function reconnect() {
  if (working.value) return;
  working.value = true;
  stillOffline.value = false;
  try {
    const result = await reconnectFromOverlay();
    // 'ok' / 'no_devices' / 'busy' all lift `internet`, which unmounts this
    // overlay. 'failed' lifts it too and raises <Error /> in its place.
    if (result === 'offline') stillOffline.value = true;
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-surface flex flex-col items-center justify-center pt-safe-top pb-safe-bottom">
    <i  class="fa-solid fa-ban text-4xl text-yellow-500"></i>

    <h1 class="text-xl font-bold text-gray-800 my-4">
      OFFLINE
    </h1>

    <p class="text-sm text-gray-500 max-w-xs leading-relaxed">
      {{ props.msg }}
    </p>

    <div class="mt-8 w-full max-w-xs px-6">
      <slot name="action">
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
        <p v-if="stillOffline" class="text-xs text-gray-400 text-center mt-3">
          Still offline. Check your connection and try again.
        </p>
      </slot>
    </div>

  </div>
</template>
