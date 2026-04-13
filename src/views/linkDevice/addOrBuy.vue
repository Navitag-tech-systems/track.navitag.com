<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { CapacitorBarcodeScanner } from '@capacitor/barcode-scanner';
import { Capacitor } from '@capacitor/core';

const router = useRouter();
const errorMsg = ref('');
const isScanning = ref(false);
const manualCode = ref('');

// The official plugin supports both Web and Native natively, 
// so we can default to showing the scanner button.
const showCameraOption = ref(true);

const startScan = async () => {
  errorMsg.value = '';
  isScanning.value = true;
  
  try {
    // --- Web Pre-Check for Camera Permissions ---
    // The capacitor web implementation sometimes throws uncatchable errors 
    // if permissions are denied. We pre-check here to catch the NotAllowedError safely.
    if (Capacitor.getPlatform() === 'web') {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        // Stop stream immediately so the scanner plugin can acquire it
        stream.getTracks().forEach(track => track.stop());
      } else {
        throw new Error("Camera API not supported in this browser.");
      }
    }

    // 2. Open the scanner
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: 17, // 17 corresponds to 'ALL' barcode formats
      cameraDirection: 1 // 1 corresponds to 'BACK' camera
    });

    // 3. Process the result
    if (result && result.ScanResult) {
      processDeviceCode(result.ScanResult);
    } else {
      // User closed the scanner without scanning
      showCameraOption.value = false;
    }
  } catch (err) {
    console.error("Scanner error:", err);

    // Fallback to manual input view
    showCameraOption.value = false;
    errorMsg.value = "Camera access denied or scanner failed. Please enter the code manually.";
  } finally {
    isScanning.value = false;
  }
};

const submitManualCode = () => {
  errorMsg.value = '';
  if (!manualCode.value || manualCode.value.trim() === '') {
    errorMsg.value = 'Please enter a valid device code.';
    return;
  }
  processDeviceCode(manualCode.value);
};

// Centralized processing function with IMEI Validation
const processDeviceCode = (code) => {
  const cleanCode = code.trim();
  const imeiRegex = /^\d{15}$/; // Validate standard 15-digit IMEI

  if (!imeiRegex.test(cleanCode)) {
    errorMsg.value = 'Invalid code. Please enter a 15-digit numeric IMEI.';
    return;
  }

  console.log('Successfully acquired IMEI/Code:', cleanCode);
  router.push(`/linkdevice/link/${cleanCode}`);
};
</script>

<template>
  <div class="flex flex-col flex-1 bg-surface">
    <div v-show="!isScanning" class="bg-white p-4 shadow-sm flex items-center">
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
        <span v-if="showCameraOption">
          Locate the QR code on your new device and scan it to link it to your account.
        </span>
        <span v-else>
          Type the 15-digit IMEI found on the back of your device to link it.
        </span>
      </p>

      <p v-if="errorMsg" class="text-sm mb-4 p-3 rounded w-full max-w-sm text-red-600 bg-red-50 border border-red-200">
        {{ errorMsg }}
      </p>
      <div v-else :style="{minHeight: '50px'}"></div>
    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] m-3 rounded-xl">
      <template v-if="showCameraOption">
        <button
          @click="startScan"
          :disabled="isScanning"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98] disabled:opacity-50"
        >
          <i v-if="isScanning" class="fa-solid fa-circle-notch fa-spin mr-3 text-xl"></i>
          <i v-else class="fa-solid fa-camera mr-3 text-xl"></i>
          {{ isScanning ? 'Scanner Active...' : 'Start Camera' }}
        </button>
        <button @click="showCameraOption = false; errorMsg = ''" class="w-full mt-4 text-sm text-accent hover:underline cursor-pointer">
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
          <button @click="showCameraOption = true; errorMsg = ''" class="w-full mt-4 text-sm text-accent hover:underline cursor-pointer flex justify-center">
            Back to Scanner
          </button>
        </div>
      </template>

      <div class="mt-4 pt-4 border-t border-gray-100 text-center">
        <p class="text-xs text-gray-500 font-medium">
          Need a new Navitag Device?
          <a href="https://www.navitag.com/shop" target="_blank" class="text-accent hover:underline font-bold ml-1">
            Shop Devices
          </a>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.2s ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>