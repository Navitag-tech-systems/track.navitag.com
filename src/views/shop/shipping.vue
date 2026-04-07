<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useCartStore } from '@/stores/cart.js';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const cartStore = useCartStore();

// "product" or "plan"
cartStore.checkoutType = route.params.type
//const checkoutType = computed(() => route.params.type);
const isProduct = computed(() => cartStore.checkoutType === 'product');
const isPlan = computed(() => cartStore.checkoutType === 'plan');

// Comprehensive country dial codes mapped with ISO codes
const countryCodes = [
  { isos: ['US', 'CA', 'PR'], code: '+1', label: 'US/CA/PR (+1)' },
  { isos: ['RU', 'KZ'], code: '+7', label: 'RU/KZ (+7)' },
  { isos: ['EG'], code: '+20', label: 'EG (+20)' },
  { isos: ['ZA'], code: '+27', label: 'ZA (+27)' },
  { isos: ['GR'], code: '+30', label: 'GR (+30)' },
  { isos: ['NL'], code: '+31', label: 'NL (+31)' },
  { isos: ['BE'], code: '+32', label: 'BE (+32)' },
  { isos: ['FR'], code: '+33', label: 'FR (+33)' },
  { isos: ['ES'], code: '+34', label: 'ES (+34)' },
  { isos: ['HU'], code: '+36', label: 'HU (+36)' },
  { isos: ['IT'], code: '+39', label: 'IT (+39)' },
  { isos: ['RO'], code: '+40', label: 'RO (+40)' },
  { isos: ['CH'], code: '+41', label: 'CH (+41)' },
  { isos: ['AT'], code: '+43', label: 'AT (+43)' },
  { isos: ['GB'], code: '+44', label: 'UK (+44)' },
  { isos: ['DK'], code: '+45', label: 'DK (+45)' },
  { isos: ['SE'], code: '+46', label: 'SE (+46)' },
  { isos: ['NO'], code: '+47', label: 'NO (+47)' },
  { isos: ['PL'], code: '+48', label: 'PL (+48)' },
  { isos: ['DE'], code: '+49', label: 'DE (+49)' },
  { isos: ['PE'], code: '+51', label: 'PE (+51)' },
  { isos: ['MX'], code: '+52', label: 'MX (+52)' },
  { isos: ['AR'], code: '+54', label: 'AR (+54)' },
  { isos: ['BR'], code: '+55', label: 'BR (+55)' },
  { isos: ['CL'], code: '+56', label: 'CL (+56)' },
  { isos: ['CO'], code: '+57', label: 'CO (+57)' },
  { isos: ['MY'], code: '+60', label: 'MY (+60)' },
  { isos: ['AU'], code: '+61', label: 'AU (+61)' },
  { isos: ['ID'], code: '+62', label: 'ID (+62)' },
  { isos: ['PH'], code: '+63', label: 'PH (+63)' },
  { isos: ['NZ'], code: '+64', label: 'NZ (+64)' },
  { isos: ['SG'], code: '+65', label: 'SG (+65)' },
  { isos: ['TH'], code: '+66', label: 'TH (+66)' },
  { isos: ['JP'], code: '+81', label: 'JP (+81)' },
  { isos: ['KR'], code: '+82', label: 'KR (+82)' },
  { isos: ['VN'], code: '+84', label: 'VN (+84)' },
  { isos: ['CN'], code: '+86', label: 'CN (+86)' },
  { isos: ['TR'], code: '+90', label: 'TR (+90)' },
  { isos: ['IN'], code: '+91', label: 'IN (+91)' },
  { isos: ['PK'], code: '+92', label: 'PK (+92)' },
].sort((a, b) => parseInt(a.code.replace('+', '')) - parseInt(b.code.replace('+', '')));

// --- Form State ---
const givenName = ref('');
const lastName = ref('');

// Phone State
const phoneCountryCode = ref('+1');
const phoneNumber = ref('');

const addressLine1 = ref('');
const addressLine2 = ref('');
const city = ref('');
const state = ref('');
const zipCode = ref(''); // Added Zip Code
const country = ref('United States'); // Default

// --- Validation Modal State ---
const showValidationModal = ref(false);
const validationMessage = ref('');

// Map ISO codes to the full string representations in your array
const isoToCountryMap = {
  'US': 'United States', 'CA': 'Canada', 'GB': 'United Kingdom', 'AU': 'Australia',
  'PH': 'Philippines', 'SG': 'Singapore', 'NZ': 'New Zealand', 'IE': 'Ireland',
  'ZA': 'South Africa', 'MX': 'Mexico', 'BR': 'Brazil', 'DE': 'Germany',
  'FR': 'France', 'IT': 'Italy', 'ES': 'Spain', 'JP': 'Japan', 'KR': 'South Korea',
  'IN': 'India', 'VN': 'Vietnam', 'MY': 'Malaysia', 'TH': 'Thailand', 'ID': 'Indonesia'
};

// --- Watchers for Phone & Country pre-filling ---
watch(
  () => [userStore.phone, userStore.countryCode],
  ([newPhone, newIso]) => {
    
    // 1. If user HAS a phone number, extract the dial code from it
    if (newPhone) {
      const match = countryCodes.find(c => newPhone.startsWith(c.code));
      if (match) {
        phoneCountryCode.value = match.code;
        // Strip out the dial code (and hyphen if it exists) to show only the number
        if (newPhone.charAt(match.code.length) === '-') {
          phoneNumber.value = newPhone.slice(match.code.length + 1);
        } else {
          phoneNumber.value = newPhone.slice(match.code.length);
        }
      } else {
        phoneNumber.value = newPhone;
      }
    } 
    // 2. If user phone is BLANK, pre-fill dial code based on IP (userStore.countryCode)
    else if (newIso) {
      const defaultCountryDial = countryCodes.find(c => c.isos.includes(newIso));
      if (defaultCountryDial) {
        phoneCountryCode.value = defaultCountryDial.code;
      }
    }

    // 3. Pre-fill Shipping Address Country based on IP (if product checkout)
    if (isProduct.value && newIso) {
      const matchedCountryName = isoToCountryMap[newIso.toUpperCase()];
      if (matchedCountryName) {
        country.value = matchedCountryName;
      }
    }
  },
  { immediate: true }
);

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
const subtotal = computed(() => {
  return isProduct.value ? cartStore.productTotal : cartStore.planTotal;
});

const grandTotal = computed(() => {
  return isProduct.value ? subtotal.value + cartStore.shippingRate : subtotal.value;
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
    if (!givenName.value || !lastName.value || !addressLine1.value || !city.value || !state.value || !zipCode.value || !phoneNumber.value || !country.value) {
      validationMessage.value = "Please fill in all required shipping and contact fields.";
      showValidationModal.value = true;
      return;
    }
  } 
  // Validate Plan Checkout
  else if (isPlan.value) {
    if (needsName.value && (!givenName.value || !lastName.value)) {
      validationMessage.value = "Please provide your first and last name.";
      showValidationModal.value = true;
      return;
    }
  }

  const combinedPhone = `${phoneCountryCode.value}${phoneNumber.value.trim()}`.replace(/-/g, '');

  const shippingObj = isProduct.value ? {
      name: userStore.name,
      phone: combinedPhone,
      addressLine1: addressLine1.value,
      addressLine2: addressLine2.value,
      city: city.value,
      state: state.value,
      zip: zipCode.value,
      country: country.value
    } : null

  // Construct Payload
  const payload = {
    type: cartStore.checkoutType,
    total: grandTotal.value,
    currency: "PHP",
    country: "PH",
    customer: {
      firstName: needsName.value ? givenName.value : userStore.name.split(' ')[0],
      lastName: needsName.value ? lastName.value : userStore.name.split(' ').slice(1).join(' '),
      phone: combinedPhone,
      email: userStore.user.email ?? null
    },
    shipping: shippingObj,
    items: isProduct.value ? cartStore.productCart : cartStore.planCart,
    fees: isProduct.value ? {shipping: cartStore.shippingRate} : null
  };

  // Call store action
  cartStore.shippingAdd = shippingObj
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

  cartStore.loading = false;
});
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface relative z-10 pointer-events-auto">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200">
      <div class="p-4 flex items-center">
        <button 
          @click="router.back()" 
          class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none cursor-pointer"
        >
          <i class="fa-solid fa-arrow-left text-lg"></i>
        </button>
        <div>
          <h1 class="text-xl font-bold text-gray-800 leading-tight">Shop</h1>
        </div>
      </div>
    </div>

    <div class="p-4 space-y-6 pb-32">

      <div v-if="needsName || isProduct" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-surface px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700 flex items-center gap-2">
          <i class="fa-solid fa-user text-brand"></i> Contact Information
        </div>
        <div class="p-4 space-y-4">
          <div v-if="needsName" class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-600 mb-1">Given Name</label>
              <input v-model="givenName" type="text" placeholder="First" class="w-full bg-surface border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-brand outline-none transition-all" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-600 mb-1">Last Name</label>
              <input v-model="lastName" type="text" placeholder="Last" class="w-full bg-surface border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-brand outline-none transition-all" />
            </div>
          </div>
          
          <div v-if="isProduct">
            <label class="block text-xs font-bold text-gray-600 mb-1">Phone Number</label>
            <div class="flex space-x-2">
              <div class="relative bg-surface border border-gray-200 p-3 rounded-xl text-sm focus-within:bg-white focus-within:ring-2 focus-within:ring-brand flex items-center justify-center w-[85px] overflow-hidden transition-all">
                <span class="text-gray-800 font-medium">{{ phoneCountryCode }}</span>
                <i class="fa-solid fa-chevron-down text-[10px] text-gray-400 ml-1"></i>
                <select v-model="phoneCountryCode" class="absolute inset-0 w-full flex-1 opacity-0 cursor-pointer">
                  <option v-for="c in countryCodes" :key="c.code" :value="c.code">
                    {{ c.label }}
                  </option>
                </select>
              </div>
              <input 
                v-model="phoneNumber" 
                type="tel" 
                placeholder="(555) 000-0000" 
                class="flex-1 bg-surface border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-brand outline-none transition-all" 
              />
            </div>
          </div>
        </div>
      </div>

      <div v-else class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-3">
        <div class="w-10 h-10 bg-brand-light text-brand rounded-full flex items-center justify-center shrink-0">
          <i class="fa-solid fa-user-check"></i>
        </div>
        <div>
          <p class="text-sm font-bold text-gray-800">Billed to {{ userStore.name }}</p>
          <p class="text-xs text-gray-500">Using account profile details</p>
        </div>
      </div>

      <div v-if="isProduct" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-surface px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700 flex items-center gap-2">
          <i class="fa-solid fa-truck-fast text-brand"></i> Shipping Address
        </div>
        <div class="p-4 space-y-4">
          
          <div class="relative">
            <label class="block text-xs font-bold text-gray-600 mb-1">Country</label>
            <button 
              @click="showCountryDropdown = !showCountryDropdown"
              type="button"
              class="w-full bg-surface border border-gray-200 p-3 rounded-xl text-sm text-left flex justify-between items-center outline-none focus:ring-2 focus:ring-brand"
            >
              <span :class="country ? 'text-gray-800' : 'text-gray-400'">{{ country || 'Select a country...' }}</span>
              <i class="fa-solid fa-chevron-down text-gray-400 transition-transform" :class="{'rotate-180': showCountryDropdown}"></i>
            </button>

            <div v-if="showCountryDropdown" class="absolute z-30 w-full mt-1 bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden">
              <div class="p-2 border-b border-gray-100 bg-surface relative">
                <i class="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input 
                  v-model="countrySearch" 
                  type="text" 
                  placeholder="Search countries..." 
                  class="w-full pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-brand"
                />
              </div>
              <ul class="max-h-48 overflow-y-auto overscroll-contain">
                <li v-if="filteredCountries.length === 0" class="px-4 py-3 text-sm text-gray-500 text-center italic">No countries found</li>
                <li 
                  v-for="c in filteredCountries" 
                  :key="c"
                  @click="selectCountry(c)"
                  class="px-4 py-3 text-sm text-gray-700 hover:bg-brand-light cursor-pointer border-b border-gray-50 last:border-0 transition-colors"
                >
                  {{ c }}
                </li>
              </ul>
            </div>
            
            <div v-if="showCountryDropdown" @click="showCountryDropdown = false" class="fixed inset-0 z-20"></div>
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">Address Line 1</label>
            <input v-model="addressLine1" type="text" placeholder="Street address, P.O. box" class="w-full bg-surface border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-brand outline-none transition-all" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">Address Line 2 <span class="font-normal text-gray-400">(Optional)</span></label>
            <input v-model="addressLine2" type="text" placeholder="Apt, suite, unit, building, floor, etc." class="w-full bg-surface border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-brand outline-none transition-all" />
          </div>
          
          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">City</label>
            <input v-model="city" type="text" placeholder="City" class="w-full bg-surface border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-brand outline-none transition-all" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-600 mb-1">State / Province</label>
              <input v-model="state" type="text" placeholder="State" class="w-full bg-surface border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-brand outline-none transition-all" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-600 mb-1">ZIP / Postal Code</label>
              <input v-model="zipCode" type="text" placeholder="ZIP code" class="w-full bg-surface border border-gray-200 p-3 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-brand outline-none transition-all" />
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
            <span class="font-medium text-gray-800">${{ cartStore.shippingRate.toFixed(2) }}</span>
          </div>
          <div class="border-t border-gray-100 pt-2 mt-2 flex justify-between items-center">
            <span class="font-bold text-gray-800">Total</span>
            <span class="text-xl font-black text-brand">${{ grandTotal.toFixed(2) }}</span>
          </div>
        </div>
      </div>

    </div>

    <teleport to="body">
      <div v-if="showValidationModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm transition-opacity">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-xs overflow-hidden animate-scale-up">
          <div class="p-6 text-center">
            
            <div class="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i class="fa-solid fa-triangle-exclamation text-red-600 text-xl"></i>
            </div>
            
            <h3 class="text-lg font-bold text-gray-800 mb-2">Missing Information</h3>
            <p class="text-sm text-gray-500 mb-6 leading-relaxed">
              {{ validationMessage }}
            </p>
            
            <button 
              @click="showValidationModal = false"
              class="w-full py-3 px-4 bg-brand hover:bg-brand-dark text-white font-bold rounded-xl text-sm transition-colors outline-none"
            >
              Okay
            </button>

          </div>
        </div>
      </div>
    </teleport>

    <div class="fixed bottom-[calc(48px+env(safe-area-inset-bottom))] left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.1)] z-40 transform transition-transform">
      <div v-if="isProduct" class="flex justify-between mb-3 px-2">
        <span>Shipping Flat Rate</span>
        <span class="font-medium text-gray-800">${{ cartStore.shippingRate.toFixed(2) }}</span>
      </div>
      <button 
        @click="processPayment"
        :disabled="cartStore.loading"
        class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] outline-none disabled:opacity-75"
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

.animate-scale-up {
  animation: scaleUp 0.2s ease-out forwards;
}

@keyframes scaleUp {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>