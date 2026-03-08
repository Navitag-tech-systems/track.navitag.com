<template>
  <div class="flex flex-col min-h-screen bg-gray-50 flex-1">
    
    <div class="bg-white p-4 shadow-sm flex items-center safe-top">
      <h1 class="text-xl font-bold text-gray-800 mx-auto">Payment Status</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      
      <div class="w-32 h-32 bg-green-100 rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto animate-scale-up">
        <i class="fa-solid fa-check text-6xl text-green-600"></i>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-800 mb-2">Payment Successful!</h2>
      
      <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 w-full max-w-sm text-center mb-6 animate-slide-up">
        <div class="mb-3">
          <i class="fa-regular fa-envelope text-3xl text-blue-500 mb-2"></i>
        </div>
        <p class="text-sm text-gray-600 leading-relaxed mb-3">
          Thank you for your purchase! Your order has been securely processed.
        </p>
        <p class="text-sm font-semibold text-gray-800 leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-100">
          You will be notified by email regarding the status and tracking of your purchase shortly.
        </p>
      </div>

    </div>
    
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<style scoped>
.animate-scale-up {
  animation: scaleUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.animate-slide-up {
  animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: 0.1s;
  opacity: 0;
}

@keyframes scaleUp {
  from { transform: scale(0.5); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>