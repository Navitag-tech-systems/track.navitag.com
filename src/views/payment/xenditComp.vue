<template>
  <div>
    <h1>Checkout</h1>
    
    <div ref="checkoutContainer"></div>

    <button @click="submitPayment">Complete Payment</button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useCartStore } from '@/stores/cart';
// Using your preferred import method
import { XenditComponents } from 'xendit-components-web';

const cartStore = useCartStore();
const route = useRoute(); 
const checkoutContainer = ref(null);
let components = null;

onMounted(() => {
  const sdkKey = route.params.session;
  console.log(sdkKey);

  components = new XenditComponents({
    componentsSdkKey : decodeURIComponent(sdkKey)
  });

  // 👇 NEW: Wait for Xendit to finish loading the session data from the server
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
    
    // You can also turn off your own loading state here once the form renders!
    cartStore.loading = false;
  });

  // ==========================================
  // OTHER LISTENERS (Safe to attach immediately)
  // ==========================================

  components.addEventListener("submission-ready", () => {
    // Form is valid
  });

  components.addEventListener("submission-not-ready", () => {
    // Form is invalid
  });

  components.addEventListener("action-begin", () => {
    // 3D Secure / OTP started
  });

  components.addEventListener("session-complete", () => {
    alert("Payment Success");
  });

  components.addEventListener("session-expired-or-canceled", () => {
    alert("Payment cancelled or expired");
  });

});

const submitPayment = () => {
  if (components) {
    components.submit();
  }
};
</script>