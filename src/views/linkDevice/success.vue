<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

// Determine if the user activated the device or skipped
const isActivated = computed(() => route.query.activated === 'true');
</script>

<template>
  <div class="flex flex-col min-h-screen bg-gray-50 pt-safe-top">
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
            <li>Turn your tracker <strong>ON</strong>.</li>
            <li>Take the device <strong>outside</strong> with a clear view of the sky.</li>
            <li>Wait a few minutes for it to acquire its first GPS fix.</li>
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
            Your tracker is now linked to your account, but the SIM connection is <span class="font-bold text-gray-800">not active</span>. 
          </p>
          <p class="text-sm text-gray-600 leading-relaxed mt-2">
            It will not transmit location data until you activate it. You can start the activation later from the device settings on your dashboard.
          </p>
        </div>
      </template>

    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] pb-safe-bottom">
      <button 
        @click="router.push('/')" 
        class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98]"
      >
        Go to Dashboard
      </button>
    </div>
  </div>
</template>