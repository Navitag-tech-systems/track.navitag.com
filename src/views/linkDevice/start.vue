<script setup>
import { ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import QrScanner from '@/components/QrScanner.vue';
import InlineLoader from '@/components/InlineLoader.vue';

const props = defineProps({
  showBack: { type: Boolean, default: true },
  showShopLink: { type: Boolean, default: false },
  scanCopy: {
    type: String,
    default:
      'To activate and link your new GPS tracker to your account, please locate and scan the QR code found on the device.',
  },
  manualCopy: {
    type: String,
    default: 'Please manually type the 15-digit IMEI found on your tracker to link it.',
  },
});

const router = useRouter();
const errorMsg = ref('');
const isScanning = ref(false);
const manualCode = ref('');
const showCameraOption = ref(true);
const qrScanner = useTemplateRef('qrScanner');

const startScan = async () => {
  errorMsg.value = '';
  isScanning.value = true;
  try {
    await qrScanner.value.scan();
  } finally {
    isScanning.value = false;
  }
};

const onScanned = (code) => {
  processDeviceCode(code);
};

const onCancelled = () => {
  showCameraOption.value = false;
};

const onError = (err) => {
  console.error('Scanner error:', err);
  showCameraOption.value = false;
  errorMsg.value = 'Camera access denied or scanner failed. Please enter the code manually.';
};

const submitManualCode = () => {
  errorMsg.value = '';
  if (!manualCode.value || manualCode.value.trim() === '') {
    errorMsg.value = 'Please enter a valid device code.';
    return;
  }
  processDeviceCode(manualCode.value);
};

// No format guard here on purpose. The old /^\d{15}$/ check assumed every unit
// carries a 15-digit IMEI, which locked out hardware whose identifier is a
// different shape — the Yuwei V5-C dashcam registers as the 12-char BCD id
// 001318110808, and that is also the exact string device_inventory holds for it.
// The real validation belongs to the API, which resolves the code against
// device_inventory and answers 400 "Device not found" for anything that is not a
// row (junk, empty, over-long, quoting attempts — the lookup is parameterized,
// so it matches literally). Trim only: leading/trailing whitespace is a paste
// artifact, never part of the code.
const processDeviceCode = (code) => {
  const cleanCode = String(code ?? '').trim();
  if (cleanCode === '') {
    errorMsg.value = 'Please enter a device code.';
    return;
  }
  router.push(`/linkdevice/link/${encodeURIComponent(cleanCode)}`);
};

const openShop = async () => {
  const url = 'https://www.navitag.com/shop';
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
  } else {
    window.open(url, '_blank');
  }
};
</script>

<template>
  <div class="flex flex-col flex-1 bg-surface">
    <QrScanner ref="qrScanner" @scanned="onScanned" @cancelled="onCancelled" @error="onError" />

    <div v-show="!isScanning" class="bg-white p-4 shadow-sm flex items-center">
      <button
        v-if="showBack"
        @click="router.back()"
        class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900"
      >
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Link Device</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div class="w-40 h-40 bg-brand-light rounded-full flex items-center justify-center mb-8 shadow-inner">
        <i class="fa-solid fa-qrcode text-6xl text-brand"></i>
      </div>
      <h2 class="text-2xl font-bold text-gray-800 mb-4">
        {{ showCameraOption ? 'Scan QR Code' : 'Enter Device Code' }}
      </h2>

      <p class="text-gray-600 mb-6 max-w-sm text-sm leading-relaxed">
        {{ showCameraOption ? scanCopy : manualCopy }}
      </p>

      <p v-if="errorMsg" class="text-sm mb-4 p-3 rounded w-full max-w-sm text-red-600 bg-red-50 border border-red-200">
        {{ errorMsg }}
      </p>
      <div v-else :style="{ minHeight: '50px' }"></div>
    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] m-3 rounded-xl">
      <template v-if="showCameraOption">
        <button
          @click="startScan"
          :disabled="isScanning"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98] disabled:opacity-50"
        >
          <InlineLoader v-if="isScanning" size="xl" class="mr-3" />
          <i v-else class="fa-solid fa-camera mr-3 text-xl"></i>
          {{ isScanning ? 'Scanner active…' : 'Start Camera' }}
        </button>
        <button
          @click="showCameraOption = false; errorMsg = ''"
          class="w-full mt-4 text-sm text-accent hover:underline cursor-pointer"
        >
          Enter code manually instead
        </button>
      </template>

      <template v-else>
        <div class="w-full text-left">
          <input
            v-model="manualCode"
            type="text"
            placeholder="e.g. 123456789012345"
            class="w-full border p-4 text-lg rounded-xl focus:ring-2 focus:ring-brand outline-none mb-3 tracking-widest text-center"
            @keyup.enter="submitManualCode"
          />
          <button
            @click="submitManualCode"
            class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 px-4 rounded-xl transition cursor-pointer text-lg shadow-md active:scale-[0.98]"
          >
            Submit Code
          </button>
          <button
            @click="showCameraOption = true; errorMsg = ''"
            class="w-full mt-4 text-sm text-accent hover:underline cursor-pointer flex justify-center"
          >
            Back to Scanner
          </button>
        </div>
      </template>

      <div v-if="showShopLink" class="mt-4 pt-4 border-t border-gray-100 text-center">
        <p class="text-xs text-gray-500 font-medium">
          Need a new Navitag Device?
          <button
            @click="openShop"
            class="text-accent hover:underline font-bold ml-1 cursor-pointer"
          >
            Shop Devices
          </button>
        </p>
      </div>
    </div>
  </div>
</template>
