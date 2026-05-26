<script setup>
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { useShareStore } from '@/stores/share.js';
import { useDevicesStore } from '@/stores/devices.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  imei: { type: [String, Number], default: null },
  label: { type: String, default: '' },
  title: { type: String, default: 'Share Live Location' },
  description: {
    type: String,
    default: "Anyone with this link can view the device's real-time location until it expires.",
  },
  defaultHours: { type: Number, default: 12 },
  maxHours: { type: Number, default: 24 },
});

const emit = defineEmits(['update:modelValue']);

const shareStore = useShareStore();
const deviceStore = useDevicesStore();
const router = useRouter();

// Share Settings lives at /device/share/:id keyed by the Traccar device id,
// while this modal is keyed by imei — resolve the id from the device list.
const deviceId = computed(() => {
  if (props.imei == null) return null;
  const match = Object.values(deviceStore.devices).find(
    (d) => String(d.uniqueId) === String(props.imei)
  );
  return match?.id ?? null;
});

const openShareSettings = () => {
  if (deviceId.value == null) return;
  close();
  router.push(`/device/share/${deviceId.value}`);
};

const hours = ref(props.defaultHours);
const shareUrl = ref('');
const loading = ref(false);
const errorMsg = ref('');
const copied = ref(false);

const buildShareText = (url) => `Real time Location tracking by NAVITAG. ${url}`;

const close = () => {
  emit('update:modelValue', false);
};

const resetState = () => {
  hours.value = props.defaultHours;
  shareUrl.value = '';
  errorMsg.value = '';
  copied.value = false;
  loading.value = false;
};

const clampHours = () => {
  let h = Number(hours.value);
  if (isNaN(h) || h < 1) h = 1;
  if (h > props.maxHours) h = props.maxHours;
  hours.value = Math.round(h);
};

const openNativeShareSheet = async () => {
  if (!shareUrl.value) return;
  const text = buildShareText(shareUrl.value);
  try {
    await Share.share({
      title: 'Navitag Live Tracking',
      text,
      url: shareUrl.value,
      dialogTitle: 'Share tracking link',
    });
  } catch (err) {
    if (err?.message && !/cancel/i.test(err.message)) {
      console.error('Native share error:', err);
    }
  }
};

const generate = async () => {
  if (!props.imei) {
    errorMsg.value = 'Missing device identifier.';
    return;
  }
  clampHours();

  loading.value = true;
  errorMsg.value = '';
  shareUrl.value = '';
  copied.value = false;

  try {
    const result = await shareStore.createPublicShare(props.imei, {
      label: props.label || undefined,
      ttlSeconds: hours.value * 3600,
    });
    shareUrl.value = result.share_url;

    if (Capacitor.isNativePlatform()) {
      await openNativeShareSheet();
    }
  } catch (err) {
    console.error('Share link error:', err);
    errorMsg.value = 'Could not create share link. Please try again.';
  } finally {
    loading.value = false;
  }
};

const handleCopyOrShare = async () => {
  if (!shareUrl.value) return;

  if (Capacitor.isNativePlatform()) {
    await openNativeShareSheet();
    return;
  }

  try {
    await navigator.clipboard.writeText(buildShareText(shareUrl.value));
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch (err) {
    console.error('Clipboard error:', err);
    errorMsg.value = 'Copy failed. Please copy manually.';
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetState();
  }
);
</script>

<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 animate-fade-in pointer-events-auto"
    style="padding-top: 20vh;"
    @click.self="close"
  >
    <div class="w-full max-w-sm bg-white rounded-2xl shadow-xl p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-gray-800">{{ title }}</h3>
        <button
          @click="close"
          class="w-6 h-6 flex items-center justify-center bg-gray-100 text-gray-500 rounded-full hover:bg-gray-200 transition-colors"
          aria-label="Close"
        >
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>

      <p class="text-[11px] text-gray-500 mb-3">{{ description }}</p>

      <div v-if="!shareUrl" class="space-y-3">
        <label class="flex items-center gap-2">
          <span class="text-xs font-semibold text-gray-600 shrink-0">Valid For:</span>
          <input
            v-model.number="hours"
            @blur="clampHours"
            type="number"
            min="1"
            :max="maxHours"
            step="1"
            :disabled="loading"
            class="no-spin w-20 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          />
          <span class="text-[11px] text-gray-400">hours (max {{ maxHours }})</span>
        </label>

        <button
          @click="generate"
          :disabled="loading"
          class="w-full py-2 bg-brand text-white rounded-lg text-sm font-bold hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i v-if="loading" class="fa-solid fa-spinner fa-spin mr-1"></i>
          {{ loading ? 'Generating...' : 'Generate Link' }}
        </button>

        <button
          v-if="deviceId != null"
          @click="openShareSettings"
          class="w-full py-2 bg-accent text-white rounded-lg text-sm font-bold hover:bg-accent-dark transition-colors flex items-center justify-center gap-1.5"
        >
          <i class="fa-solid fa-user-group text-xs"></i>
          Open Share Settings
        </button>
      </div>

      <div v-else class="relative">
        <input
          type="text"
          :value="shareUrl"
          disabled
          class="w-full pl-3 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 truncate focus:outline-none"
        />
        <button
          @click="handleCopyOrShare"
          class="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-brand hover:bg-brand-light rounded-md transition-colors"
          :aria-label="Capacitor.isNativePlatform() ? 'Share link' : 'Copy link'"
        >
          <i v-if="copied" class="fa-solid fa-check text-green-600 text-sm"></i>
          <i v-else class="fa-solid fa-copy text-sm"></i>
        </button>
      </div>

      <p v-if="shareUrl" class="text-[10px] text-gray-400 mt-2">
        Valid for {{ hours }} hour{{ hours === 1 ? '' : 's' }}.
      </p>
      <p v-if="copied" class="text-[10px] text-green-600 mt-1">Copied to clipboard</p>
      <p v-if="errorMsg" class="text-[10px] text-red-500 mt-2">{{ errorMsg }}</p>
    </div>
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
.no-spin::-webkit-outer-spin-button,
.no-spin::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.no-spin {
  -moz-appearance: textfield;
  appearance: textfield;
}
</style>
