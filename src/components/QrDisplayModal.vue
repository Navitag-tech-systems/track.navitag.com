<script setup>
import { ref, watch } from 'vue';
import QRCode from 'qrcode';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  value: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const dataUrl = ref('');
const errorMsg = ref('');

const close = () => emit('update:modelValue', false);

const generate = async () => {
  errorMsg.value = '';
  dataUrl.value = '';
  if (!props.value) {
    errorMsg.value = 'Nothing to encode.';
    return;
  }
  try {
    dataUrl.value = await QRCode.toDataURL(props.value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 500,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    console.error('QR generation error:', err);
    errorMsg.value = 'Failed to generate QR code.';
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) generate();
  },
);
</script>

<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 px-6 py-10 animate-fade-in pointer-events-auto"
    @click.self="close"
  >
    <div
      v-if="dataUrl"
      class="bg-white rounded-2xl shadow-xl p-8 w-full max-w-[500px]"
    >
      <img :src="dataUrl" alt="QR code" class="w-full h-auto" />
    </div>
    <div v-else-if="errorMsg" class="text-red-300 text-sm py-12">{{ errorMsg }}</div>
    <div v-else class="text-white text-sm py-12">
      <i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Generating...
    </div>

    <button
      @click="close"
      class="mt-10 w-10 h-10 flex items-center justify-center bg-white/90 text-gray-800 rounded-full hover:bg-white transition-colors shadow-md"
      aria-label="Close"
    >
      <i class="fa-solid fa-xmark text-sm"></i>
    </button>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.15s ease-out forwards;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
