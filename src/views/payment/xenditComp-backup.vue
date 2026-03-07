<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCartStore } from '@/stores/cart';

console.log('[PaymentView] Component setup initialized.');

const route = useRoute();
const router = useRouter();
const cartStore = useCartStore();

// Retrieve the session ID from the route parameter
const sessionId = route.params.session;
console.log('[PaymentView] Session ID from route:', sessionId);

const paymentContainer = ref(null);
const xenditInstance = ref(null);
const isProcessing = ref(false);
const errorMessage = ref('');

const initializeXendit = () => {
  console.log('[PaymentView] initializeXendit() called.');
  try {
    console.log('[PaymentView] Initializing XenditComponents SDK...');
    // 1. Initialize the SDK with the key provided via the route
    xenditInstance.value = new window.XenditComponents({ 
      componentsSdkKey: sessionId 
    });
    console.log('[PaymentView] Xendit SDK initialized successfully.', xenditInstance.value);

    // 2. Create the channel picker component automatically based on session config
    console.log('[PaymentView] Creating channel picker component...');
    const htmlElement = xenditInstance.value.createChannelPickerComponent();
    
    // Mount it to the DOM
    if (paymentContainer.value) {
      console.log('[PaymentView] paymentContainer found in DOM. Injecting Xendit UI...');
      paymentContainer.value.replaceChildren(htmlElement);
    } else {
      console.error('[PaymentView] ERROR: paymentContainer DOM element is null!');
    }

    // 3. Listen to transaction events
    xenditInstance.value.addEventListener('session-complete', () => {
      console.log('[PaymentView] Event: session-complete triggered.');
      isProcessing.value = false;
      router.replace({ path: '/', query: { payment: 'success' } }); 
    });

    xenditInstance.value.addEventListener('session-expired-or-canceled', () => {
      console.warn('[PaymentView] Event: session-expired-or-canceled triggered.');
      isProcessing.value = false;
      errorMessage.value = "This payment session has expired or was canceled.";
    });

  } catch (err) {
    console.error('[PaymentView] Xendit Initialization Error caught:', err);
    errorMessage.value = "Failed to load the secure payment form.";
  } finally {
    cartStore.loading = false;
    console.log('[PaymentView] cartStore.loading set to false.');
  }
};

onMounted(() => {
  console.log('[PaymentView] onMounted lifecycle hook triggered.');
  
  const scriptId = 'xendit-sdk-script';
  let script = document.getElementById(scriptId);

  // If the script tag is already in the <head>
  if (script) {
    console.log('[PaymentView] Script tag already exists in the document.');
    if (window.XenditComponents) {
      console.log('[PaymentView] window.XenditComponents exists. Initializing immediately.');
      initializeXendit();
    } else {
      console.log('[PaymentView] window.XenditComponents missing. Waiting for script load event.');
      script.addEventListener('load', initializeXendit);
    }
    return;
  }

  // If not in the <head>, create and append it
  console.log('[PaymentView] Creating new script tag for Xendit CDN...');
  script = document.createElement('script');
  script.id = scriptId;
  script.src = 'https://assets.xendit.co/components/v0.0.13/index.umd.js';
  script.async = true;

  script.onload = () => {
    console.log('[PaymentView] Script loaded successfully from CDN.');
    initializeXendit();
  };

  script.onerror = (e) => {
    console.error('[PaymentView] Failed to load Xendit script from CDN.', e);
    errorMessage.value = "Failed to load the secure payment form. Please check your network.";
    cartStore.loading = false;
  };

  console.log('[PaymentView] Appending script to document head...');
  document.head.appendChild(script);
  console.log('[PaymentView] Script appended.');
});

const submitPayment = () => {
  console.log('[PaymentView] Submit button clicked.');
  if (!xenditInstance.value) {
    console.warn('[PaymentView] Submit aborted: xenditInstance is null.');
    return;
  }
  isProcessing.value = true;
  errorMessage.value = '';
  console.log('[PaymentView] Calling xenditInstance.submit()...');
  xenditInstance.value.submit(); 
};

onBeforeUnmount(() => {
  console.log('[PaymentView] onBeforeUnmount lifecycle hook triggered.');
  // Clean up the injected iframe when leaving the route
  if (xenditInstance.value && paymentContainer.value?.firstChild) {
    console.log('[PaymentView] Destroying Xendit component...');
    xenditInstance.value.destroyComponent(paymentContainer.value.firstChild);
  }
});
</script>

<template>
  <div class="flex flex-col h-full bg-gray-50 z-20 relative">
    
    <div class="bg-white p-4 shadow-sm flex items-center safe-top">
      <button @click="router.back()" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900 outline-none">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Secure Payment</h1>
    </div>

    <div class="flex-1 p-4 overflow-y-auto">
      <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 max-w-md mx-auto mt-2">
        <h2 class="text-lg font-bold text-gray-800 mb-1">Payment Details</h2>
        <p class="text-sm text-gray-500 mb-5">Enter your payment details to complete the purchase.</p>
        
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
          :disabled="isProcessing || errorMessage !== '' || !xenditInstance"
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