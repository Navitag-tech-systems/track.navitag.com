import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useToastStore = defineStore('toast', () => {
  const message = ref('');
  const variant = ref('info'); // 'info' | 'success' | 'error'
  let timer = null;

  function show(msg, { variant: v = 'info', durationMs = 4000 } = {}) {
    if (!msg) return;
    if (timer) clearTimeout(timer);
    message.value = msg;
    variant.value = v;
    if (durationMs > 0) {
      timer = setTimeout(hide, durationMs);
    }
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    message.value = '';
  }

  return { message, variant, show, hide };
});
