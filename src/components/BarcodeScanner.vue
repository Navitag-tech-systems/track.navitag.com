<script setup>
import { ref, onMounted } from 'vue';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';
import "barcode-detector/polyfill"; // <--- Add the polyfill

const isDesktop = ref(false);
const scanResult = ref('');

onMounted(() => {
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileOS = /android|iphone|ipad|ipod/.test(userAgent);
  
  // Disable if it's a web platform AND not a mobile OS
  if (Capacitor.getPlatform() === 'web' && !isMobileOS) {
    isDesktop.value = true;
  }
});

const startScan = async () => {
  if (isDesktop.value) return;

  try {
    // Check/Request permission (Works on both native and mobile web)
    const status = await BarcodeScanner.checkPermissions();
    if (status.camera !== 'granted') {
      await BarcodeScanner.requestPermissions();
    }

    // Use the .scan() method for a simple overlay or read from image
    // Note: on Web, this triggers the browser's camera permission prompt
    const { barcodes } = await BarcodeScanner.scan();
    
    if (barcodes.length > 0) {
      scanResult.value = barcodes[0].displayValue;
    }
  } catch (e) {
    alert("Scanner error: " + e.message);
  }
};
</script>

<template>
  <div class="p-4 border rounded-lg bg-white shadow-sm">
    <h3 class="font-bold mb-2">QR/Barcode Scanner</h3>
    
    <div v-if="isDesktop" class="bg-gray-100 p-3 rounded text-center text-gray-400 text-sm">
      <i class="fa-solid fa-camera-slash mb-1 block"></i>
      Scanner unavailable on computer
    </div>

    <button 
      v-else
      @click="startScan" 
      class="bg-green-600 text-white px-4 py-2 rounded flex items-center justify-center w-full"
    >
      <i class="fa-solid fa-qrcode mr-2"></i> Scan Code
    </button>

    <p v-if="scanResult" class="mt-2 text-sm bg-gray-100 p-2 break-all border-l-4 border-green-500">
      Result: <strong>{{ scanResult }}</strong>
    </p>
  </div>
</template>