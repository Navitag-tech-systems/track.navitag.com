<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { BarcodeScanner } from '@capacitor/barcode-scanner';
import { Capacitor } from '@capacitor/core';

const router = useRouter();
const isSupported = ref(false);
const errorMsg = ref('');
const isScanning = ref(false);
const manualCode = ref(''); // Added state for the text input

onMounted(async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await BarcodeScanner.isSupported();
      isSupported.value = result.supported;
    } catch (e) {
      console.warn("Barcode scanning support check failed:", e);
      isSupported.value = false;
    }
  } else {
    // If running in a web browser, native scanning isn't supported.
    // We will default to false to show the text input fallback.
    isSupported.value = false; 
  }
});

const startScan = async () => {
  errorMsg.value = '';
  
  try {
    if (Capacitor.isNativePlatform()) {
      let status = await BarcodeScanner.checkPermissions();
      if (status.camera !== 'granted') {
        status = await BarcodeScanner.requestPermissions();
        if (status.camera !== 'granted') {
          errorMsg.value = 'Camera permission is required to scan the QR code.';
          // If the user permanently denies camera access, fallback to text input
          isSupported.value = false; 
          return;
        }
      }
    }

    isScanning.value = true;
    const { barcodes } = await BarcodeScanner.scan();
    isScanning.value = false;

    if (barcodes && barcodes.length > 0) {
      const scannedCode = barcodes[0].rawValue || barcodes[0].displayValue;
      processDeviceCode(scannedCode);
    }
  } catch (err) {
    isScanning.value = false;
    console.error("Scanner error", err);
    errorMsg.value = err.message || "Failed to scan barcode or user cancelled.";
  }
};

const submitManualCode = () => {
  errorMsg.value = '';
  if (!manualCode.value || manualCode.value.trim() === '') {
    errorMsg.value = 'Please enter a valid device code.';
    return;
  }
  processDeviceCode(manualCode.value.trim());
};

// Centralized function to handle the scanned or typed code
const processDeviceCode = (code) => {
  console.log('Successfully acquired IMEI/Code:', code);
  
  // Push to the new route, passing the code as the :imei parameter
  router.push(`/linkdevice/link/${code}`);
};
</script>

<template>
  <div class="flex flex-col min-h-screen bg-gray-50 pt-safe-top">
    <div class="bg-white p-4 shadow-sm flex items-center">
      <button @click="router.back()" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Link Device</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div class="w-40 h-40 bg-blue-100 rounded-full flex items-center justify-center mb-8 shadow-inner">
        <i class="fa-solid fa-qrcode text-6xl text-blue-600"></i>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-800 mb-4">
        {{ isSupported ? 'Scan QR Code' : 'Enter Device Code' }}
      </h2>
      <p class="text-gray-600 mb-6 max-w-sm text-sm leading-relaxed">
        <span v-if="isSupported">
          To activate and link your new GPS tracker to your account, please locate and scan the QR code found on the device.
        </span>
        <span v-else>
          Camera scanning is not available. Please manually type the IMEI or Device Code found on your tracker to link it.
        </span>
      </p>

      <p v-if="errorMsg" class="text-sm mb-4 p-3 rounded w-full max-w-sm" :class="errorMsg.includes('success') ? 'text-green-700 bg-green-50 border border-green-200' : 'text-red-600 bg-red-50 border border-red-200'">
        {{ errorMsg }}
      </p>
    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] pb-safe-bottom">
      
      <template v-if="isSupported">
        <button 
          @click="startScan" 
          class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98]"
        >
          <i class="fa-solid fa-camera mr-3 text-xl"></i> Start Camera
        </button>
        <button @click="isSupported = false" class="w-full mt-4 text-sm text-blue-600 hover:underline cursor-pointer">
          Enter code manually instead
        </button>
      </template>

      <template v-else>
        <div class="w-full text-left">
          <input 
            v-model="manualCode" 
            type="text" 
            placeholder="e.g. 123456789012345" 
            class="w-full border p-4 text-lg rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-3 tracking-widest text-center" 
          />
          <button 
            @click="submitManualCode" 
            class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-4 px-4 rounded-xl transition cursor-pointer text-lg shadow-md active:scale-[0.98]"
          >
            Submit Code
          </button>
        </div>
      </template>

    </div>
  </div>
</template>