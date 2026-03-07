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
  console.log(sdkKey)

  components = new XenditComponents({
    componentsSdkKey : decodeURIComponent(sdkKey)
  });

  // 👇 THIS IS THE MAGIC LINE: Call createCardComponent instead of createChannelPickerComponent
  const cardComponent = components.createCardComponent();

  // Insert the card component directly into the container
  if (checkoutContainer.value) {
    checkoutContainer.value.replaceChildren(cardComponent);
  }

  // Listeners remain unchanged
  components.addEventListener("session-complete", () => {
    alert("Payment Success");
  });

  components.addEventListener("session-expired-or-canceled", () => {
    alert("Payment cancelled or expired");
  });

  cartStore.loading = false
});

const submitPayment = () => {
  if (components) {
    components.submit();
  }
};
</script>