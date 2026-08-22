<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { LifecycleService } from '@/utils/lifecycle';
import InlineLoader from '@/components/InlineLoader.vue';

const router = useRouter();

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
  router.push("/");
}
</script>

<template>
  <!-- min-h-full, not min-h-screen: this view renders inside <main>, which
       reserves 48px + safe-area for the fixed bottom nav. A full-viewport
       minimum ignored that reservation, so the MAP button sat under the nav. -->
  <div class="flex flex-col min-h-full bg-surface flex-1">
    <div class="bg-white p-4 shadow-sm flex items-center">
      <h1 class="text-xl font-bold text-gray-800 mx-auto">Setup Complete</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      
      <div class="w-32 h-32 bg-brand-light rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto">
        <i class="fa-solid fa-check text-6xl text-brand"></i>
      </div>

      <h2 class="text-2xl font-bold text-gray-800 mb-2">Device Activated!</h2>
      <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 w-full max-w-sm text-left mb-6">
        <h3 class="font-bold text-gray-800 mb-2"><i class="fa-solid fa-satellite mr-2 text-brand"></i> Next Steps</h3>
        <ul class="text-sm text-gray-600 space-y-2 list-disc pl-4 marker:text-gray-300">
          <li>Finish installing/setting up your device</li>
          <li>Make sure the device is <strong>outside</strong> with a clear view of the sky.</li>
          <li>Wait 5-10 mins for it to acquire its first location fix.</li>
        </ul>
      </div>

    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)]">
      <button 
        @click="goToMap" 
        :disabled="isRefreshing"
        class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <template v-if="isRefreshing">
          <InlineLoader label="Syncing…" size="lg" />
        </template>
        <template v-else>
          MAP
        </template>
      </button>
    </div>
  </div>
</template>