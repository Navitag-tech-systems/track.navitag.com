<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useCartStore } from '@/stores/cart.js';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const cartStore = useCartStore();

// "product" or "plan"
const checkoutType = computed(() => route.params.type);
const isProduct = computed(() => checkoutType.value === 'product');
const isPlan = computed(() => checkoutType.value === 'plan');

// --- Form State ---
const givenName = ref('');
const lastName = ref('');
const phone = ref(userStore.phone || '');

const addressLine1 = ref('');
const addressLine2 = ref('');
const city = ref('');
const state = ref('');
const country = ref('United States'); // Default

// Map ISO codes to the full string representations in your array
const isoToCountryMap = {
  'US': 'United States', 'CA': 'Canada', 'GB': 'United Kingdom', 'AU': 'Australia',
  'PH': 'Philippines', 'SG': 'Singapore', 'NZ': 'New Zealand', 'IE': 'Ireland',
  'ZA': 'South Africa', 'MX': 'Mexico', 'BR': 'Brazil', 'DE': 'Germany',
  'FR': 'France', 'IT': 'Italy', 'ES': 'Spain', 'JP': 'Japan', 'KR': 'South Korea',
  'IN': 'India', 'VN': 'Vietnam', 'MY': 'Malaysia', 'TH': 'Thailand', 'ID': 'Indonesia'
};

// --- Conditionals ---
const needsName = computed(() => {
  if (isProduct.value) return true;
  if (isPlan.value) {
    const name = userStore.name || '';
    if (!name.trim() || name.toLowerCase().startsWith('user')) {
      return true;
    }
    return false;
  }
  return true;
});

// --- Totals & Rates ---
const shippingRate = ref(5.00);

const subtotal = computed(() => {
  return isProduct.value ? cartStore.productTotal : cartStore.planTotal;
});

const grandTotal = computed(() => {
  return isProduct.value ? subtotal.value + shippingRate.value : subtotal.value;
});

// --- Searchable Dropdown Logic ---
const showCountryDropdown = ref(false);
const countrySearch = ref('');

const countries = Object.values(isoToCountryMap).sort();

const filteredCountries = computed(() => {
  if (!countrySearch.value.trim()) return countries;
  return countries.filter(c => 
    c.toLowerCase().includes(countrySearch.value.toLowerCase())
  );
});

const selectCountry = (c) => {
  country.value = c;
  showCountryDropdown.value = false;
  countrySearch.value = '';
};

// --- Payment Handler ---
const processPayment = () => {
  // Validate Product Checkout
  if (isProduct.value) {
    if (!givenName.value || !lastName.value || !addressLine1.value || !city.value || !state.value || !phone.value || !country.value) {
      alert("Please fill in all required shipping and contact fields.");
      return;
    }
  } 
  // Validate Plan Checkout
  else if (isPlan.value) {
    if (needsName.value && (!givenName.value || !lastName.value)) {
      alert("Please provide your first and last name.");
      return;
    }
  }

  // Construct Payload
  const payload = {
    type: checkoutType.value,
    total: grandTotal.value,
    currency: "USD",
    country: userStore.countryCode,
    customer: {
      firstName: needsName.value ? givenName.value : userStore.name.split(' ')[0],
      lastName: needsName.value ? lastName.value : userStore.name.split(' ').slice(1).join(' '),
      phone: phone.value,
      email: userStore.user.email ?? null
    },
    shipping: isProduct.value ? {
      addressLine1: addressLine1.value,
      addressLine2: addressLine2.value,
      city: city.value,
      state: state.value,
      country: country.value
    } : null,
    items: isProduct.value ? cartStore.productCart : cartStore.planCart
  };

  // Call store action
  cartStore.generatePayment(payload);
};

// --- Lifecycle ---
onMounted(() => {
  // 1. Kick user out if the respective cart is empty
  if (isProduct.value && cartStore.productCount === 0) {
    router.replace('/app-shop');
    return;
  } else if (isPlan.value && cartStore.planCount === 0) {
    router.replace('/data-plans');
    return;
  }

  // 2. Pre-fill names if they exist and are valid
  if (userStore.name && !userStore.name.toLowerCase().startsWith('user')) {
    const parts = userStore.name.split(' ');
    givenName.value = parts[0] || '';
    lastName.value = parts.slice(1).join(' ') || '';
  }

  // 3. Pre-fill country based on IP-derived country code if this is a product checkout
  if (isProduct.value && userStore.countryCode) {
    const matchedCountry = isoToCountryMap[userStore.countryCode.toUpperCase()];
    if (matchedCountry) {
      country.value = matchedCountry;
    }
  }
  cartStore.loading = false
});
</script>

<template>
  <div class="flex flex-col min-h-full bg-gray-50 relative z-10 pointer-events-auto">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200">
      <div class="p-4 flex items-center">
        <button 
          @click="router.back()" 
          class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none cursor-pointer"
        >
          <i class="fa-solid fa-arrow-left text-lg"></i>
        </button>
        <div>
          <h1 class="text-xl font-bold text-gray-800 leading-tight">Checkout</h1>
          <p class="text-xs text-gray-500 font-medium capitalize">{{ checkoutType }} Order</p>
        </div>
      </div>
    </div>

    <div class="p-4 space-y-6 pb-32">

      <div v-if="needsName || isProduct" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-gray-50 px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700 flex items-center gap-2">
          <i class="fa-solid fa-user text-blue-500"></i> Contact Information
        </div>
        <div class="p-4 space-y-4">
          <div v-if="needsName" class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-600 mb-1">Given Name</label>
              <input v-model="givenName" type="text" placeholder="First" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-600 mb-1">Last Name</label>
              <input v-model="lastName" type="text" placeholder="Last" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
            </div>
          </div>
          
          <div v-if="isProduct">
            <label class="block text-xs font-bold text-gray-600 mb-1">Phone Number</label>
            <input v-model="phone" type="tel" placeholder="+1 (555) 000-0000" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
          </div>
        </div>
      </div>

      <div v-else class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-3">
        <div class="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shrink-0">
          <i class="fa-solid fa-user-check"></i>
        </div>
        <div>
          <p class="text-sm font-bold text-gray-800">Billed to {{ userStore.name }}</p>
          <p class="text-xs text-gray-500">Using account profile details</p>
        </div>
      </div>

      <div v-if="isProduct" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-gray-50 px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700 flex items-center gap-2">
          <i class="fa-solid fa-truck-fast text-blue-500"></i> Shipping Address
        </div>
        <div class="p-4 space-y-4">
          
          <div class="relative">
            <label class="block text-xs font-bold text-gray-600 mb-1">Country</label>
            <button 
              @click="showCountryDropdown = !showCountryDropdown"
              type="button"
              class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm text-left flex justify-between items-center outline-none focus:ring-2 focus:ring-blue-500"
            >
              <span :class="country ? 'text-gray-800' : 'text-gray-400'">{{ country || 'Select a country...' }}</span>
              <i class="fa-solid fa-chevron-down text-gray-400 transition-transform" :class="{'rotate-180': showCountryDropdown}"></i>
            </button>

            <div v-if="showCountryDropdown" class="absolute z-30 w-full mt-1 bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden">
              <div class="p-2 border-b border-gray-100 bg-gray-50 relative">
                <i class="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input 
                  v-model="countrySearch" 
                  type="text" 
                  placeholder="Search countries..." 
                  class="w-full pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-blue-500"
                />
              </div>
              <ul class="max-h-48 overflow-y-auto overscroll-contain">
                <li v-if="filteredCountries.length === 0" class="px-4 py-3 text-sm text-gray-500 text-center italic">No countries found</li>
                <li 
                  v-for="c in filteredCountries" 
                  :key="c"
                  @click="selectCountry(c)"
                  class="px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0 transition-colors"
                >
                  {{ c }}
                </li>
              </ul>
            </div>
            
            <div v-if="showCountryDropdown" @click="showCountryDropdown = false" class="fixed inset-0 z-20"></div>
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">Address Line 1</label>
            <input v-model="addressLine1" type="text" placeholder="Street address, P.O. box" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">Address Line 2 <span class="font-normal text-gray-400">(Optional)</span></label>
            <input v-model="addressLine2" type="text" placeholder="Apt, suite, unit, building, floor, etc." class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-600 mb-1">City</label>
              <input v-model="city" type="text" placeholder="City" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-600 mb-1">State / Province</label>
              <input v-model="state" type="text" placeholder="State" class="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <h3 class="font-bold text-gray-800 mb-3">Order Summary</h3>
        <div class="space-y-2 text-sm text-gray-600">
          <div class="flex justify-between">
            <span>Subtotal ({{ isProduct ? cartStore.productCount : cartStore.planCount }} items)</span>
            <span class="font-medium text-gray-800">${{ subtotal.toFixed(2) }}</span>
          </div>
          <div v-if="isProduct" class="flex justify-between">
            <span>Shipping</span>
            <span class="font-medium text-gray-800">${{ shippingRate.toFixed(2) }}</span>
          </div>
          <div class="border-t border-gray-100 pt-2 mt-2 flex justify-between items-center">
            <span class="font-bold text-gray-800">Total</span>
            <span class="text-xl font-black text-blue-600">${{ grandTotal.toFixed(2) }}</span>
          </div>
        </div>
      </div>

    </div>

    <div class="fixed bottom-[calc(48px+env(safe-area-inset-bottom))] left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.1)] z-40 transform transition-transform">
      <button 
        @click="processPayment"
        :disabled="cartStore.loading"
        class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] outline-none disabled:opacity-75"
      >
        <i v-if="cartStore.loading" class="fa-solid fa-circle-notch fa-spin"></i>
        <template v-else>
          Payment
          <i class="fa-solid fa-lock text-gray-400"></i>
        </template>
      </button>
    </div>

  </div>
</template>

<style scoped>
.overscroll-contain {
  overscroll-behavior: contain;
}
</style>