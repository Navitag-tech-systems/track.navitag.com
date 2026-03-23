<script setup>
import { computed, ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LifecycleService } from '@/utils/lifecycle.js';

const route = useRoute();
const router = useRouter();

// Determine if the user activated the device or skipped
const isActivated = computed(() => route.query.activated === 'true');

// Track loading state so we can disable the button while syncing
const isRefreshing = ref(true); // Start true since we sync immediately on mount

// Trigger the reload automatically when the screen loads
onMounted(async () => {
  try {
    console.log('🔄 Component mounted: Auto-syncing new device data...');
    await LifecycleService.reloadAndReconnect();
  } catch (error) {
    console.error("❌ Failed to reload data on mount:", error);
  } finally {
    // Re-enable the button once finished
    isRefreshing.value = false;
  }
});

// Simple navigation function for the button
function goToMap() {
  if (isRefreshing.value) return; 
  //router.push("/"); routing should be handled by the lifecycle
}
</script>

<template>
  <div class="flex flex-col min-h-screen bg-gray-50 flex-1">
    <div class="bg-white p-4 shadow-sm flex items-center">
      <h1 class="text-xl font-bold text-gray-800 mx-auto">Setup Complete</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      
      <template v-if="isActivated">
        <div class="w-32 h-32 bg-blue-100 rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto">
          <i class="fa-solid fa-check text-6xl text-blue-600"></i>
        </div>
        
        <h2 class="text-2xl font-bold text-gray-800 mb-2">Device Activated!</h2>
        <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 w-full max-w-sm text-left mb-6">
          <h3 class="font-bold text-gray-800 mb-2"><i class="fa-solid fa-satellite mr-2 text-blue-500"></i> Next Steps</h3>
          <ul class="text-sm text-gray-600 space-y-2 list-disc pl-4 marker:text-gray-300">
            <li>Finish installing/setting up your device</li>
            <li>Make sure the device is <strong>outside</strong> with a clear view of the sky.</li>
            <li>Wait 5-10 mins for it to acquire its first location fix.</li>
          </ul>
        </div>
      </template>

      <template v-else>
        <div class="w-32 h-32 bg-gray-200 rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto">
          <i class="fa-solid fa-link text-5xl text-gray-600"></i>
        </div>
        
        <h2 class="text-2xl font-bold text-gray-800 mb-2">Device Linked</h2>
        <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 w-full max-w-sm text-left mb-6">
          <p class="text-sm text-gray-600 leading-relaxed">
            Your tracker is now linked to your account, but the connection is <span class="font-bold text-gray-800">not active</span>. 
          </p>
          <p class="text-sm text-gray-600 leading-relaxed mt-2">
            It will not transmit location data until you activate it. You can start the activation later from the device page.
          </p>
        </div>
      </template>

    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)]">
      <button 
        @click="goToMap" 
        :disabled="isRefreshing"
        class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <template v-if="isRefreshing">
          <i class="fa-solid fa-spinner fa-spin mr-2"></i> SYNCING...
        </template>
        <template v-else>
          MAP
        </template>
      </button>
    </div>
  </div>
</template>