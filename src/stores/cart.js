import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { request } from '@/utils/http';
import { baseUrl } from '@/utils/variables';
import { useUserStore } from '@/stores/user.js';

export const useCartStore = defineStore('cart', () => {
  const router = useRouter()
  // --- State ---
  const loading = ref(false);
  
  // Stores plans mapped by device ID
  // Example: { "device_123": { months: 3, price_usd: 50, ... } }
  const planCart = ref({});
  
  // Stores products mapped by product ID, keeping the product object and quantity
  // Example: { "prod_abc": { product: {...}, quantity: 2 } }
  const productCart = ref({});

  // --- Computeds (Totals & Counts) ---

  const planTotal = computed(() => {
    return Object.values(planCart.value).reduce((sum, plan) => sum + (plan.price_usd || 0), 0);
  });

  const planCount = computed(() => {
    return Object.keys(planCart.value).length;
  });

  const productTotal = computed(() => {
    return Object.values(productCart.value).reduce((sum, item) => {
      return sum + ((item.product.price_usd || 0) * item.quantity);
    }, 0);
  });

  const productCount = computed(() => {
    return Object.values(productCart.value).reduce((sum, item) => sum + item.quantity, 0);
  });

  const grandTotal = computed(() => {
    return planTotal.value + productTotal.value;
  });

  // --- Actions: Data Plans ---

  const togglePlan = (deviceId, plan) => {
    if (planCart.value[deviceId]?.months === plan.months) {
      // If the exact same plan is clicked again, remove it
      delete planCart.value[deviceId];
    } else {
      // Otherwise, set/override the plan for this device
      planCart.value[deviceId] = plan;
    }
  };

  const removePlan = (deviceId) => {
    delete planCart.value[deviceId];
  };

  const clearPlans = () => {
    planCart.value = {};
  };

  // --- Actions: Products ---

  const addProduct = (product) => {
    const id = String(product.id);
    if (productCart.value[id]) {
      productCart.value[id].quantity++;
    } else {
      productCart.value[id] = { product, quantity: 1 };
    }
  };

  const removeProduct = (product) => {
    const id = String(product.id);
    if (productCart.value[id]) {
      if (productCart.value[id].quantity > 1) {
        productCart.value[id].quantity--;
      } else {
        delete productCart.value[id];
      }
    }
  };

  const getProductQuantity = (productId) => {
    const id = String(productId);
    return productCart.value[id]?.quantity || 0;
  };

  const clearProducts = () => {
    productCart.value = {};
  };

  const clearAll = () => {
    clearPlans();
    clearProducts();
  };

  const checkout = (type) => {
    loading.value = true
    router.push("/shipping/"+ type)
  }

  const generatePayment = async (payload) => {
    loading.value = true
    const userStore = useUserStore()
    console.log('start payment session component', payload)
    const xenditSession = await request.send({
      url: `${baseUrl}/transaction/create`,
      method: 'POST',
      token: userStore.idToken,
      data: payload
    })
    if(xenditSession.success === true){
      router.push(`/payment/${xenditSession.data.components_sdk_key}`)
    } else {
      console.log('xendit error', xenditSession)
    }
  }

  return {
    // State
    planCart,
    productCart,
    
    // Computeds
    planTotal,
    planCount,
    productTotal,
    productCount,
    grandTotal,
    loading,
    
    // Plan Actions
    togglePlan,
    removePlan,
    clearPlans,
    
    // Product Actions
    addProduct,
    removeProduct,
    getProductQuantity,
    clearProducts,
    
    // Global Actions
    generatePayment,
    clearAll,
    checkout
  };
});