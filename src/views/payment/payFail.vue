<template>
  <div class="flex flex-col min-h-screen bg-gray-50 flex-1">
    
    <div class="bg-white p-4 shadow-sm flex items-center safe-top">
      <button @click="router.push('/')" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900 outline-none">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Payment Status</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      
      <div class="w-32 h-32 bg-red-100 rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto animate-shake">
        <i class="fa-solid fa-triangle-exclamation text-6xl text-red-600"></i>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Payment Failed</h2>
      
      <div class="bg-white p-5 rounded-xl shadow-sm border border-red-100 w-full max-w-sm text-center mb-6">
        <p class="text-sm text-gray-600 leading-relaxed">
          {{ errorMessage }}
        </p>
      </div>

    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] pb-safe-bottom space-y-3">
      <button 
        @click="router.back()"
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98] outline-none"
      >
        <i class="fa-solid fa-rotate-right mr-2"></i> Try Again
      </button>

      <button 
        @click="router.push('/')" 
        class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-sm active:scale-[0.98] outline-none"
      >
        Cancel
      </button>
    </div>
    
  </div>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

// Retrieve custom error message from the URL query params if provided, otherwise show default
const errorMessage = route.query.message || 'There was an issue processing your payment. Your card has not been charged.';
</script>

<style scoped>
.animate-shake {
  animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
}

@keyframes shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
  40%, 60% { transform: translate3d(4px, 0, 0); }
}
</style>