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

  // ==========================================
  // XENDIT EVENT LISTENERS
  // ==========================================

  // 1. Fired when the form is fully valid and ready to be submitted
  // (e.g., all 16 card digits, expiry, and CVV are entered correctly)
  components.addEventListener("submission-ready", () => {
    // TODO: Enable your "Complete Payment" button here
  });

  // 2. Fired when the form becomes invalid or is incomplete
  components.addEventListener("submission-not-ready", () => {
    // TODO: Disable your "Complete Payment" button here
  });

  // 3. Fired when an extra authentication step starts (like 3D Secure / OTP)
  components.addEventListener("action-begin", () => {
    // TODO: Optionally show a loading spinner overlay
  });

  // 4. Fired when the payment is 100% successful
  components.addEventListener("session-complete", () => {
    // TODO: Clear cart, show success message, or redirect to a thank you page
  });

  // 5. Fired if the user cancels, the bank declines it, or the session time runs out
  components.addEventListener("session-expired-or-canceled", () => {
    // TODO: Show an error message and let the user try again
  });

  cartStore.loading = false;
});

const submitPayment = () => {
  if (components) {
    components.submit();
  }
};
</script>