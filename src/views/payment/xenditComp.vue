<template>
  <div class="flex flex-col min-h-full bg-gray-50 relative z-10 pointer-events-auto">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200 p-4 flex items-center safe-top">
      <button 
        @click="router.back()" 
        class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none cursor-pointer"
      >
        <i class="fa-solid fa-arrow-left text-lg"></i>
      </button>
      <div>
        <h1 class="text-lg font-bold text-gray-800 leading-tight">Shipping</h1>
      </div>
    </div>

    <div class="p-4 space-y-4 mt-2 max-w-md mx-auto w-full pb-32">
      
      <div class="grid gap-3" :class="isProduct ? 'grid-cols-2' : 'grid-cols-1'">
        
        <button 
          @click="showOrderModal = true" 
          class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-start hover:shadow-md hover:border-blue-100 transition-all text-left group outline-none"
        >
          <div class="flex items-center gap-2 mb-2">
            <i class="fa-solid fa-cart-shopping text-blue-500"></i>
            <span class="text-xs text-gray-500 font-bold uppercase tracking-wider">Order</span>
          </div>
          <span class="text-sm font-bold text-gray-800 leading-tight">
            {{ totalItems }} Items
          </span>
          <span class="text-[10px] text-gray-400 group-hover:text-blue-600 mt-2 font-semibold transition-colors">
            View Details <i class="fa-solid fa-chevron-right ml-0.5"></i>
          </span>
        </button>
        
        <button 
          v-if="isProduct"
          @click="showShippingModal = true" 
          class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-start hover:shadow-md hover:border-blue-100 transition-all text-left group outline-none"
        >
          <div class="flex items-center gap-2 mb-2">
            <i class="fa-solid fa-truck-fast text-green-500"></i>
            <span class="text-xs text-gray-500 font-bold uppercase tracking-wider">Shipping</span>
          </div>
          <span class="text-sm font-bold text-gray-800 leading-tight truncate w-full">
            {{ cartStore.shippingAdd?.state || 'State' }}, {{ cartStore.shippingAdd?.country || 'Country' }}
          </span>
          <span class="text-[10px] text-gray-400 group-hover:text-blue-600 mt-2 font-semibold transition-colors">
            View Details <i class="fa-solid fa-chevron-right ml-0.5"></i>
          </span>
        </button>
      </div>

      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div class="flex items-center justify-center w-16 h-16 bg-blue-50 text-blue-600 rounded-full mb-6 mx-auto">
          <i class="fa-regular fa-credit-card text-3xl"></i>
        </div>
        <h2 class="text-xl font-bold text-center text-gray-800 mb-2">Payment Details</h2>
        <p class="text-sm text-center text-gray-500 mb-6">Enter your card details securely to complete your purchase.</p>

        <div v-if="cartStore.loading" class="flex flex-col items-center justify-center py-10 text-gray-400">
          <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-blue-500"></i>
          <p class="text-sm font-semibold">Loading secure payment...</p>
        </div>

        <div 
          ref="checkoutContainer" 
          :class="{'hidden': cartStore.loading}" 
          class="min-h-[100px] mb-4"
        ></div>

        <div class="flex justify-between items-center pt-4 border-t border-gray-100 mb-2">
          <span class="text-gray-600 font-bold">Total Cost</span>
          <span class="text-2xl font-black text-gray-900">${{ displayTotal.toFixed(2) }}</span>
        </div>

        <p class="text-[10px] text-gray-400 mt-5 leading-relaxed text-center">
          * All orders are routed and handled by their designated regional headquarters. Depending on your card and issuing bank, you might see charges in their respective currencies:<br/>
          <span class="font-semibold text-gray-500 mt-1 block">AMERICAS: USA (USD) • APAC: Philippines (PHP)</span>
        </p>
      </div>
      
    </div>

    <div class="fixed bottom-[calc(48px+env(safe-area-inset-bottom))] sm:bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.1)] z-40 transform transition-transform">
      <button 
        @click="submitPayment"
        :disabled="!isFormValid || isProcessing || cartStore.loading"
        class="w-full max-w-md mx-auto bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed outline-none"
      >
        <i v-if="isProcessing" class="fa-solid fa-circle-notch fa-spin"></i>
        <i v-else class="fa-solid fa-lock"></i>
        {{ isProcessing ? 'Processing Payment...' : `Pay $${displayTotal.toFixed(2)}` }}
      </button>
    </div>

    <teleport to="body">
      <div v-if="showOrderModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm transition-opacity">
        <div class="bg-white rounded-3xl sm:rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up sm:animate-scale-up max-h-[85vh] flex flex-col">
          <div class="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h3 class="font-bold text-gray-800"><i class="fa-solid fa-cart-shopping text-blue-500 mr-2"></i> Order Summary</h3>
            <button @click="showOrderModal = false" class="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center hover:bg-gray-300 transition-colors">
              <i class="fa-solid fa-xmark text-sm"></i>
            </button>
          </div>
          
          <div class="p-5 overflow-y-auto flex-1">
            <ul class="divide-y divide-gray-100">
              <li v-for="(item, index) in cartItemsList" :key="index" class="py-3 flex justify-between items-center">
                <div class="flex-1 pr-4">
                  <p class="text-sm font-bold text-gray-800">{{ item.name }}</p>
                  <p class="text-xs text-gray-500">Qty: {{ item.quantity }}</p>
                </div>
                <div class="text-sm font-bold text-gray-800">
                  ${{ item.total.toFixed(2) }}
                </div>
              </li>
            </ul>
            
            <div v-if="!cartItemsList.length" class="text-center py-6 text-gray-500 text-sm">
              Your cart is empty.
            </div>
          </div>

          <div class="p-5 border-t border-gray-100 bg-gray-50 space-y-2">
            <div class="flex justify-between items-center text-sm">
              <span class="text-gray-500 font-medium">Subtotal</span>
              <span class="text-gray-800 font-semibold">${{ isProduct ? cartStore.productTotal.toFixed(2) : cartStore.planTotal.toFixed(2) }}</span>
            </div>
            
            <div v-if="isProduct" class="flex justify-between items-center text-sm">
              <span class="text-gray-500 font-medium">Shipping</span>
              <span class="text-gray-800 font-semibold">${{ cartStore.shippingRate.toFixed(2) }}</span>
            </div>

            <div class="flex justify-between items-center pt-2 mt-2 border-t border-gray-200 mb-4">
              <span class="text-gray-600 font-bold">Total</span>
              <span class="text-lg font-black text-gray-900">${{ displayTotal.toFixed(2) }}</span>
            </div>
            
            <button @click="showOrderModal = false" class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3 rounded-xl transition text-sm">
              Close
            </button>
          </div>
        </div>
      </div>
    </teleport>

    <teleport to="body">
      <div v-if="isProduct && showShippingModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm transition-opacity">
        <div class="bg-white rounded-3xl sm:rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up sm:animate-scale-up">
          <div class="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h3 class="font-bold text-gray-800"><i class="fa-solid fa-truck-fast text-green-500 mr-2"></i> Shipping Details</h3>
            <button @click="showShippingModal = false" class="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center hover:bg-gray-300 transition-colors">
              <i class="fa-solid fa-xmark text-sm"></i>
            </button>
          </div>
          
          <div class="p-6">
            <div v-if="cartStore.shippingAdd" class="space-y-3 text-sm text-gray-700">
              <div>
                <p class="text-xs text-gray-400 font-bold uppercase mb-0.5">Name</p>
                <p class="font-semibold text-gray-800">{{ cartStore.shippingAdd.name || 'Not provided' }}</p>
              </div>
              <div>
                <p class="text-xs text-gray-400 font-bold uppercase mb-0.5">Address</p>
                <p>{{ cartStore.shippingAdd.addressLine1 }}</p>
                <p v-if="cartStore.shippingAdd.addressLine2">{{ cartStore.shippingAdd.addressLine2 }}</p>
                <p>{{ cartStore.shippingAdd.city }}, {{ cartStore.shippingAdd.state }} {{ cartStore.shippingAdd.zip }}</p>
                <p>{{ cartStore.shippingAdd.country }}</p>
              </div>
              <div v-if="cartStore.shippingAdd.phone">
                <p class="text-xs text-gray-400 font-bold uppercase mb-0.5">Phone</p>
                <p>{{ cartStore.shippingAdd.phone }}</p>
              </div>
            </div>
            
            <div v-else class="text-center py-6 text-gray-500 text-sm">
              No shipping details provided.
            </div>

            <div class="grid grid-cols-2 gap-3 mt-6">
              <button @click="showShippingModal = false" class="py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-sm transition-colors">
                Close
              </button>
              <button @click="editShipping" class="py-3 bg-gray-800 hover:bg-gray-900 text-white font-bold rounded-xl text-sm transition-colors flex justify-center items-center gap-2">
                <i class="fa-solid fa-pen-to-square"></i> Edit
              </button>
            </div>
          </div>
        </div>
      </div>
    </teleport>

  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCartStore } from '@/stores/cart';
import { XenditComponents } from 'xendit-components-web';

const cartStore = useCartStore();
const route = useRoute(); 
const router = useRouter();
const checkoutContainer = ref(null);
let components = null;

// Modal States
const showOrderModal = ref(false);
const showShippingModal = ref(false);

// UI State
const isFormValid = ref(false);
const isProcessing = ref(false);

// Dynamic Computed Properties for Display Logic
const isProduct = computed(() => cartStore.checkoutType === 'product');

const totalItems = computed(() => {
  return isProduct.value ? cartStore.productCount : cartStore.planCount;
});

const displayTotal = computed(() => {
  if (isProduct.value) {
    return cartStore.productTotal + cartStore.shippingRate;
  }
  return cartStore.planTotal;
});

const cartItemsList = computed(() => {
  if (isProduct.value) {
    return Object.values(cartStore.productCart).map(item => ({
      name: item.product.name || 'GPS Tracker',
      quantity: item.quantity,
      price: item.product.price_usd || 0,
      total: (item.product.price_usd || 0) * item.quantity
    }));
  } else {
    return Object.entries(cartStore.planCart).map(([deviceId, plan]) => ({
      name: `${plan.months} Month Data Plan`,
      quantity: 1,
      price: plan.price_usd || 0,
      total: plan.price_usd || 0
    }));
  }
});

onMounted(() => {
  const sdkKey = route.params.session;
  cartStore.loading = true;

  components = new XenditComponents({
    componentsSdkKey : decodeURIComponent(sdkKey)
  });

  components.addEventListener("init", () => {
    const channels = components.getActiveChannels();
    const cardChannel = channels.find((c) => c.channelCode === "CARDS");

    if (cardChannel) {
      const cardComponent = components.createChannelComponent(cardChannel);
      
      if (checkoutContainer.value) {
        checkoutContainer.value.replaceChildren(cardComponent);
      }
    } else {
      console.error("The CARDS channel is not available for this session!");
    }
    
    cartStore.loading = false;
  });

  // ==========================================
  // XENDIT EVENT LISTENERS 
  // ==========================================

  components.addEventListener("submission-ready", () => {
    isFormValid.value = true;
  });

  components.addEventListener("submission-not-ready", () => {
    isFormValid.value = false;
  });

  components.addEventListener("action-begin", () => {
    isProcessing.value = true;
  });

  components.addEventListener("session-complete", () => {
    isProcessing.value = false;
    router.replace('/payment/success');
  });

  components.addEventListener("session-expired-or-canceled", () => {
    isProcessing.value = false;
    router.replace('/payment/fail');
  });

});

const submitPayment = () => {
  if (components && isFormValid.value) {
    isProcessing.value = true;
    components.submit();
  }
};

const editShipping = () => {
  showShippingModal.value = false;
  router.push('/shipping/' + cartStore.checkoutType);
};
</script>

<style scoped>
/* Animations for modals to match app feel */
.animate-scale-up {
  animation: scaleUp 0.2s ease-out forwards;
}

.animate-slide-up {
  animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes scaleUp {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>