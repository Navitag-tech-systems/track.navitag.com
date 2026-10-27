<script setup>
import { ref, computed } from 'vue';
import { request } from '@/utils/http.js';
import { baseUrl } from '@/utils/variables';
import { useUserStore } from '@/stores/user.js';

/**
 * Photograph (or pick) a fuel receipt and have the backend read it
 * (POST /energy/receipt-ocr, Claude Haiku vision). Emits `extracted` with the
 * server's response; the parent decides which form fields to fill. Nothing is
 * saved by this component.
 *
 * Camera access is the plain file input with `capture="environment"`: it works
 * in the browser, in the Capacitor WebView on iOS (opens the camera) and on
 * Android (camera or gallery chooser) without a native plugin.
 */
const props = defineProps({
  imei: { type: String, required: true },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['extracted']);

const userStore = useUserStore();
const fileInput = ref(null);     // capture="environment": the camera
const galleryInput = ref(null);  // no capture: photo library / files
const busy = ref(false);
const errorMsg = ref('');
const previewUrl = ref('');
const warnings = ref([]);
const notes = ref('');
const lastFields = ref(null);

// Long edge the photo is scaled to before upload. Claude reads text fine at
// this size, the API caps images at 5 MB, and a phone photo is 3-12 MB raw.
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

const WARNING_TEXT = {
  not_a_fuel_receipt: 'That does not look like a fuel receipt.',
  totals_mismatch: 'Liters × price does not match the total. Check the numbers.',
  liters_out_of_range: 'The liters on the receipt could not be used (0–500 L).',
  amount_out_of_range: 'The amount on the receipt could not be used.',
  receipt_older_than_30_days: 'The receipt is older than 30 days; an entry can only be back-dated 30 days.',
  receipt_date_in_future: 'The receipt date is in the future. Check it.',
  receipt_date_unreadable: 'The date on the receipt could not be read; set it below.',
};
const warningLines = computed(() => warnings.value.map((w) => WARNING_TEXT[w] || w));

const ERROR_TEXT = {
  ocr_unavailable: 'Receipt scanning is not enabled on the server.',
  ocr_refused: 'The receipt could not be read.',
  ocr_upstream: 'The receipt reader is busy. Try again in a moment.',
  ocr_auth: 'Receipt scanning is misconfigured on the server.',
  ocr_truncated: 'The receipt could not be read. Try a closer, straighter photo.',
  ocr_bad_json: 'The receipt could not be read. Try a closer, straighter photo.',
  ocr_bad_request: 'The receipt could not be read.',
};

function pick() {
  if (busy.value || props.disabled) return;
  fileInput.value?.click();
}
function pickFromGallery() {
  if (busy.value || props.disabled) return;
  galleryInput.value?.click();
}

async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  busy.value = true;
  errorMsg.value = '';
  warnings.value = [];
  notes.value = '';
  try {
    const dataUrl = await downscale(file);
    previewUrl.value = dataUrl;
    const res = await request.send({
      url: `${baseUrl}/energy/receipt-ocr`,
      method: 'POST',
      data: {
        imei: props.imei,
        image: dataUrl,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      token: userStore.idToken,
      timeout: 90000,
    });
    warnings.value = Array.isArray(res?.warnings) ? res.warnings : [];
    notes.value = typeof res?.notes === 'string' ? res.notes : '';
    lastFields.value = res?.fields || null;
    emit('extracted', res);
  } catch (err) {
    console.error('Receipt OCR failed:', err);
    const code = err?.body?.error || err?.data?.error || err?.message || '';
    errorMsg.value = ERROR_TEXT[code] || (typeof code === 'string' && code ? code : 'Could not read the receipt.');
  } finally {
    busy.value = false;
  }
}

/** The photo as a JPEG data URL, no longer than MAX_EDGE on its long side, EXIF orientation applied. */
async function downscale(file) {
  let source;
  let width;
  let height;
  if (typeof createImageBitmap === 'function') {
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      width = source.width;
      height = source.height;
    } catch {
      source = null;
    }
  }
  if (!source) {
    source = await loadImage(file);
    width = source.naturalWidth;
    height = source.naturalHeight;
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG transparency becomes white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image.')); };
    img.src = url;
  });
}
</script>

<template>
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-lg font-bold text-gray-800">Scan receipt</h2>
        <p class="text-xs text-gray-500 leading-snug">
          Photograph the fuel receipt to fill in the liters, amount, station and time. Check the values before saving.
        </p>
      </div>
      <button
        type="button"
        @click="pick"
        :disabled="busy || disabled"
        class="shrink-0 px-4 py-2.5 rounded-xl bg-brand text-white text-sm font-bold flex items-center gap-2 active:scale-95 transition-all disabled:opacity-60"
      >
        <i :class="busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-camera'"></i>
        <span>{{ busy ? 'Reading…' : 'Scan' }}</span>
      </button>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden"
      @change="onFile"
    />
    <input
      ref="galleryInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onFile"
    />

    <button
      type="button"
      @click="pickFromGallery"
      :disabled="busy || disabled"
      class="text-xs font-medium text-brand underline underline-offset-2 disabled:opacity-60"
    >
      or choose a photo of the receipt
    </button>

    <div v-if="previewUrl" class="flex items-start gap-3">
      <img :src="previewUrl" alt="Receipt" class="w-16 h-16 object-cover rounded-lg border border-gray-200" />
      <div class="min-w-0 text-xs space-y-1">
        <p v-if="busy" class="text-gray-500">Reading the receipt…</p>
        <template v-else-if="!errorMsg">
          <p v-if="lastFields && !warnings.includes('not_a_fuel_receipt')" class="text-green-700 font-medium">
            Receipt read. Values filled in below.
          </p>
          <p v-for="(line, i) in warningLines" :key="i" class="text-amber-700">{{ line }}</p>
          <p v-if="notes" class="text-gray-500">{{ notes }}</p>
        </template>
      </div>
    </div>

    <p v-if="errorMsg" class="text-xs text-red-600 flex items-center gap-2">
      <i class="fa-solid fa-circle-exclamation"></i>{{ errorMsg }}
    </p>
  </div>
</template>
