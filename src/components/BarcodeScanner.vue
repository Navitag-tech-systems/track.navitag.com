<script setup>
import { ref, onUnmounted, nextTick } from 'vue';
import { Html5Qrcode } from 'html5-qrcode';

const scanResult = ref('');
const isScanning = ref(false);
const scannerInstance = ref(null);

const startScan = async () => {
  scanResult.value = '';
  isScanning.value = true;

  // Wait for the DOM to update so the "reader" div exists
  await nextTick();

  try {
    const html5QrCode = new Html5Qrcode("reader");
    scannerInstance.value = html5QrCode;

    // Configuration for the scanner
    const config = { 
      fps: 10, 
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0 
    };

    // Start the camera (prefer back camera)
    await html5QrCode.start(
      { facingMode: "environment" }, 
      config,
      (decodedText) => {
        // Success callback
        scanResult.value = decodedText;
        stopScan();
      },
      (errorMessage) => {
        // Error callback (fires frequently while scanning, usually ignored)
      }
    );
  } catch (err) {
    console.error("Failed to start scanner", err);
    alert("Camera error: " + err);
    stopScan();
  }
};

const stopScan = async () => {
  if (scannerInstance.value) {
    try {
      if (scannerInstance.value.isScanning) {
        await scannerInstance.value.stop();
      }
      scannerInstance.value.clear();
    } catch (err) {
      console.warn("Error stopping scanner", err);
    }
    scannerInstance.value = null;
  }
  isScanning.value = false;
};

// Cleanup if user navigates away
onUnmounted(() => {
  stopScan();
});
</script>

<template>
  <div v-if="!isScanning" class="p-4 border rounded-lg bg-white shadow-sm">
    <h3 class="font-bold mb-2">QR/Barcode Scanner</h3>
    
    <button 
      @click="startScan" 
      class="bg-green-600 text-white px-4 py-2 rounded flex items-center justify-center w-full cursor-pointer hover:bg-green-700 transition"
    >
      <i class="fa-solid fa-qrcode mr-2"></i> Scan Code
    </button>

    <p v-if="scanResult" class="mt-2 text-sm bg-gray-100 p-2 break-all border-l-4 border-green-500">
      Result: <strong>{{ scanResult }}</strong>
    </p>
  </div>

  <Teleport to="body">
    <div v-if="isScanning" class="fixed inset-0 z-[100] bg-black">
      
      <div id="reader" class="w-full h-full object-cover"></div>

      <div class="absolute inset-0 flex flex-col items-center justify-between p-10 pointer-events-none">
        
        <div class="mt-20 w-64 h-64 border-2 border-white/70 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"></div>
        
        <div class="pointer-events-auto">
          <button 
            @click="stopScan"
            class="bg-red-600 text-white px-8 py-3 rounded-full font-bold shadow-lg hover:bg-red-700 active:scale-95 transition"
          >
            Cancel Scan
          </button>
        </div>
      </div>

    </div>
  </Teleport>
</template>

<style scoped>
/* Ensure the html5-qrcode video element fills the screen properly */
:deep(#reader video) {
  object-fit: cover;
  width: 100% !important;
  height: 100% !important;
  border-radius: 0 !important;
}
</style>