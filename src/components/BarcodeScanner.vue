<script setup>
import { ref, onMounted } from 'vue';
import { BarcodeScanner, BarcodeFormat } from '@capacitor/barcode-scanner';
import { Capacitor } from '@capacitor/core';

const scanResult = ref('');
const errorMsg = ref('');
const isSupported = ref(false);

// Check if the device natively supports barcode scanning (ML Kit / Apple Vision)
onMounted(async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await BarcodeScanner.isSupported();
      isSupported.value = result.supported;
    } catch (e) {
      console.warn("Barcode scanning support check failed:", e);
    }
  } else {
    // Web fallback support depends on the environment
    isSupported.value = true; 
  }
});

const startScan = async () => {
  errorMsg.value = '';
  scanResult.value = '';

  try {
    // 1. Request and check camera permissions
    let status = await BarcodeScanner.checkPermissions();
    if (status.camera !== 'granted') {
      status = await BarcodeScanner.requestPermissions();
      if (status.camera !== 'granted') {
        errorMsg.value = 'Camera permission is required to scan QR codes.';
        return;
      }
    }

    // 2. Open the Native Scanner UI
    // You can restrict formats by passing options: { formats: [BarcodeFormat.QrCode] }
    const { barcodes } = await BarcodeScanner.scan();
    
    // 3. Handle the result
    if (barcodes && barcodes.length > 0) {
      scanResult.value = barcodes[0].rawValue || barcodes[0].displayValue;
    }
  } catch (err) {
    console.error("Scanner error", err);
    errorMsg.value = err.message || "Failed to scan barcode or user cancelled.";
  }
};
</script>

<template>
  <div class="p-4 border rounded-lg bg-white shadow-sm">
    <h3 class="font-bold mb-2">QR/Barcode Scanner</h3>
    
    <div v-if="!isSupported && Capacitor.isNativePlatform()" class="text-[10px] text-red-500 mb-2 italic">
      * Native barcode scanning is not supported on this specific device.
    </div>
    
    <button 
      @click="startScan" 
      :disabled="Capacitor.isNativePlatform() && !isSupported"
      class="bg-green-600 text-white px-4 py-2 text-sm rounded flex items-center justify-center w-full cursor-pointer hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <i class="fa-solid fa-qrcode mr-2"></i> Scan Code
    </button>

    <p v-if="scanResult" class="mt-2 text-sm bg-gray-100 p-2 break-all border-l-4 border-green-500">
      Result: <strong>{{ scanResult }}</strong>
    </p>

    <p v-if="errorMsg" class="mt-2 text-xs text-red-500">
      {{ errorMsg }}
    </p>
  </div>
</template>