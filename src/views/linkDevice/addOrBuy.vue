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

    isScanning.value = false;

    // 3. Process the result
    if (result && result.ScanResult) {
      processDeviceCode(result.ScanResult);
    } else {
      // User closed the scanner without scanning
      showCameraOption.value = false;
    }
  } catch (err) {
    isScanning.value = false;
    console.error("Scanner error:", err);
    
    // Fallback to manual input view
    showCameraOption.value = false;
    errorMsg.value = "Camera access denied or scanner failed. Please enter the code manually.";
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
  <div class="flex flex-col h-100 bg-gray-50 min-h-screen">
    
    <div class="bg-white p-4 shadow-sm flex items-center safe-top">
      <button @click="router.back()" class="text-gray-600 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 mr-2 transition-colors outline-none cursor-pointer">
        <i class="fa-solid fa-arrow-left text-lg"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Link Device</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      
      <div class="w-32 h-32 bg-blue-50 rounded-full flex items-center justify-center mb-6 shadow-inner border border-blue-100">
        <i class="fa-solid fa-qrcode text-5xl text-blue-600"></i>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-800 mb-3">
        {{ showCameraOption ? 'Scan QR Code' : 'Enter Device Code' }}
      </h2>

      <p class="text-gray-500 mb-6 max-w-xs text-sm leading-relaxed">
        <span v-if="showCameraOption">
          Locate the QR code on your new GPS tracker and scan it to link it to your account.
        </span>
        <span v-else>
          Type the 15-digit IMEI found on the back of your tracker to link it.
        </span>
      </p>

      <div class="h-14 w-full max-w-sm">
        <div v-if="errorMsg" class="text-sm p-3 rounded-xl text-red-600 bg-red-50 border border-red-200 animate-fade-in flex items-center justify-center gap-2">
          <i class="fa-solid fa-triangle-exclamation"></i>
          {{ errorMsg }}
        </div>
      </div>
    </div>

    <div class="p-6 bg-white shadow-[0_-10px_20px_rgba(0,0,0,0.03)] rounded-t-3xl pb-safe-bottom">
      
      <div class="max-w-md mx-auto">
        <template v-if="showCameraOption">
          <button 
            @click="startScan" 
            :disabled="isScanning"
            class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition-colors cursor-pointer shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed outline-none"
          >
            <i v-if="isScanning" class="fa-solid fa-circle-notch fa-spin mr-3 text-lg"></i>
            <i v-else class="fa-solid fa-camera mr-3 text-lg"></i> 
            {{ isScanning ? 'Scanner Active...' : 'Start Camera' }}
          </button>
          
          <button @click="showCameraOption = false; errorMsg = ''" class="w-full mt-4 text-sm font-semibold text-gray-500 hover:text-blue-600 transition-colors cursor-pointer outline-none">
            Enter code manually instead
          </button>
        </template>

        <template v-else>
          <div class="w-full text-left relative">
            <i class="fa-solid fa-hashtag absolute left-4 top-[22px] text-gray-400"></i>
            <input 
              v-model="manualCode" 
              type="text" 
              placeholder="e.g. 123456789012345" 
              class="w-full border border-gray-200 bg-gray-50 p-4 pl-10 text-lg rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none mb-4 tracking-wider font-mono transition-all" 
              @keyup.enter="submitManualCode"
            />
            
            <button 
              @click="submitManualCode" 
              class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm active:scale-[0.98] outline-none"
            >
              Submit Code
              <i class="fa-solid fa-arrow-right"></i>
            </button>
            
            <button @click="showCameraOption = true; errorMsg = ''" class="w-full mt-4 text-sm font-semibold text-gray-500 hover:text-blue-600 transition-colors cursor-pointer outline-none">
              Back to Scanner
            </button>
          </div>
        </template>

        <div class="mt-8 pt-6 border-t border-gray-100 text-center">
          <p class="text-xs text-gray-500 font-medium">
            Need a new GPS tracker? 
            <a href="https://yourwebsite.com/shop" target="_blank" class="text-blue-600 hover:underline font-bold ml-1">
              Shop Devices
            </a>
          </p>
        </div>
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