<script setup>
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

// Retrieve custom error message from the URL query params if provided
const errorMessage = route.query.message || 'There was an unexpected problem linking your device. Please verify the device code and try again.';
</script>

<template>
  <div class="flex flex-col min-h-screen bg-gray-50 pt-safe-top">
    <div class="bg-white p-4 shadow-sm flex items-center">
      <button @click="router.push('/')" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Linking Failed</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div class="w-40 h-40 bg-red-100 rounded-full flex items-center justify-center mb-8 shadow-inner">
        <i class="fa-solid fa-triangle-exclamation text-6xl text-red-600"></i>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Device Not Linked</h2>
      <p class="text-gray-600 mb-8 max-w-sm text-sm leading-relaxed">
        {{ errorMessage }}
      </p>
    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] pb-safe-bottom">
      <button 
        @click="router.push('/')"
        class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-4 px-4 rounded-xl transition cursor-pointer text-lg shadow-md active:scale-[0.98]"
      >
        Back to Home
      </button>

      <button 
        @click="router.push('/linkdevice/start')"
        class="w-full mt-4 text-sm text-blue-600 hover:underline cursor-pointer"
      >
        Try scanning again
      </button>
    </div>
  </div>
</template>