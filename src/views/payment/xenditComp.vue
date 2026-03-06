<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { XenditComponents } from 'xendit-components-web';
import { useCartStore } from '@/stores/cart';


const route = useRoute();
const router = useRouter();
const cartStore = useCartStore()

// Retrieve the session ID from the route parameter
const sessionId = route.params.session;

const paymentContainer = ref(null);
const xenditInstance = ref(null);
const isProcessing = ref(false);
const errorMessage = ref('');

onMounted(() => {
  try {
    // 1. Initialize the SDK with the key provided via the route
    xenditInstance.value = new XenditComponents({ 
      componentsSdkKey: sessionId 
    });

    // 2. Fetch active channels and mount the UI (CARDS channel)
    const channel = xenditInstance.value.getActiveChannels().find(c => c.channelCode === 'CARDS');
    
    if (channel) {
      const htmlElement = xenditInstance.value.createChannelPickerComponent(channel);
      paymentContainer.value.replaceChildren(htmlElement);
    } else {
      errorMessage.value = "Card payment channel is not available for this session.";
    }

    // 3. Listen to transaction events
    xenditInstance.value.addEventListener('session-complete', () => {
      isProcessing.value = false;
      // Redirect to a success page or back to home (update as needed)
      router.replace({ path: '/', query: { payment: 'success' } }); 
    });

    xenditInstance.value.addEventListener('session-expired-or-canceled', () => {
      isProcessing.value = false;
      errorMessage.value = "This payment session has expired or was canceled.";
    });

  } catch (err) {
    console.error('Xendit Initialization Error:', err);
    errorMessage.value = "Failed to load the secure payment form.";
  } finally{
    cartStore.loading = false;
  }
});

const submitPayment = () => {
  if (!xenditInstance.value) return;
  isProcessing.value = true;
  errorMessage.value = '';
  xenditInstance.value.submit(); // Triggers the internal SDK validation and submission
};

onBeforeUnmount(() => {
  // Clean up the injected iframe when leaving the route
  if (xenditInstance.value && paymentContainer.value?.firstChild) {
    xenditInstance.value.destroyComponent(paymentContainer.value.firstChild);
  }
});
</script>

<template>
  <div class="flex flex-col h-full bg-gray-50">
    
    <div class="bg-white p-4 shadow-sm flex items-center safe-top">
      <button @click="router.back()" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900 outline-none">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Secure Payment</h1>
    </div>

    <div class="flex-1 p-4 overflow-y-auto">
      <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 max-w-md mx-auto mt-2">
        <h2 class="text-lg font-bold text-gray-800 mb-1">Payment Details</h2>
        <p class="text-sm text-gray-500 mb-5">Enter your card details to complete the purchase.</p>
        
        <div v-if="errorMessage" class="mb-5 text-sm p-3 rounded-xl text-red-600 bg-red-50 border border-red-200 flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation text-lg"></i>
          {{ errorMessage }}
        </div>

        <div ref="paymentContainer" class="min-h-[200px] mb-6">
          <div v-if="!errorMessage && !xenditInstance" class="flex flex-col items-center justify-center py-10 text-gray-400">
            <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-blue-500"></i>
            <p class="text-sm font-semibold">Loading secure connection...</p>
          </div>
        </div>

        <button 
          @click="submitPayment"
          :disabled="isProcessing || errorMessage !== ''"
          class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] outline-none"
        >
          <i v-if="isProcessing" class="fa-solid fa-circle-notch fa-spin"></i>
          {{ isProcessing ? 'Processing Payment...' : 'Pay Now' }}
        </button>

        <div class="mt-4 flex items-center justify-center text-xs text-gray-400 gap-1.5">
          <i class="fa-solid fa-lock"></i> Payments are processed securely by Xendit
        </div>
      </div>
    </div>

  </div>
</template>