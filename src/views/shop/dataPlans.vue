<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { useUserStore } from '@/stores/user.js';
import { useCartStore } from '@/stores/cart.js'; // <-- Import Cart Store
import { request } from '@/utils/http.js';
import { baseUrl } from '@/utils/variables.js';

const router = useRouter();
const deviceStore = useDevicesStore();
const userStore = useUserStore();
const cartStore = useCartStore(); // <-- Instantiate Cart Store

// --- State ---
const searchQuery = ref('');
const sortBy = ref('name');
const availablePlans = ref({}); 
const showInfoModal = ref(false);

// --- Helpers ---
const isValidDate = (dateString) => {
  if (!dateString) return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { 
    year: 'numeric', month: 'short', day: 'numeric' 
  });
};

const isExpired = (dateString) => {
  const expDate = new Date(dateString);
  const now = new Date();
  return expDate < now;
};

const isExpiringSoon = (dateString) => {
  const expDate = new Date(dateString);
  const now = new Date();
  const oneMonthFromNow = new Date();
  oneMonthFromNow.setMonth(now.getMonth() + 1);
  
  return expDate >= now && expDate <= oneMonthFromNow;
};

// --- Computed ---

// Compile all valid device models into a single array of unique strings
const uniqueModels = computed(() => {
  const models = new Set();
  
  Object.values(deviceStore.devices).forEach(device => {
    // Exclude nulls, booleans, or empty strings
    if (typeof device.model === 'string' && device.model.trim() !== '') {
      models.add(device.model.trim());
    }
  });

  return Array.from(models).sort();
});

const processedDevices = computed(() => {
  // 1. Filter for eligible devices first
  let arr = Object.values(deviceStore.devices).filter(device => {
    return (
      device.positionId && 
      device.positionId > 0 && 
      isValidDate(device.expiration)
    );
  });
  
  // 2. Apply Search Filter
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    arr = arr.filter(device => 
      device.name?.toLowerCase().includes(query)
    );
  }

  // 3. Apply Sorting
  arr.sort((a, b) => {
    if (sortBy.value === 'name') {
      return (a.name || '').localeCompare(b.name || '');
    } 
    if (sortBy.value === 'model') {
      return (a.model || '').localeCompare(b.model || '');
    } 
    if (sortBy.value === 'expiration') {
      const timeA = new Date(a.expiration).getTime();
      const timeB = new Date(b.expiration).getTime();
      return timeA - timeB; // Sorts by soonest to expire first
    }
    return 0;
  });

  return arr;
});

// Helper to get plans specific to a device's model
const getDevicePlans = (model) => {
  if (!model || !availablePlans.value[model]) return [];
  return availablePlans.value[model];
};

// --- Actions ---

const fetchPlans = async () => {
  cartStore.loading = true
  if (uniqueModels.value.length === 0) return;
  
  try {
    const response = await request.send({
      url: `${baseUrl}/shop/dataplans`,
      method: 'POST',
      data: { models: uniqueModels.value },
      token: userStore.idToken
    });

    if (response.status == "success" && Array.isArray(response.message)) {
      const groupedPlans = {};
      
      // Group the array of objects by their `model`
      response.message.forEach(plan => {
        if (!groupedPlans[plan.model]) {
          groupedPlans[plan.model] = [];
        }
        groupedPlans[plan.model].push(plan);
      });

      // Optional: Sort each model's plans ascending by the number of months
      for (const model in groupedPlans) {
        groupedPlans[model].sort((a, b) => a.months - b.months);
      }

      availablePlans.value = groupedPlans;
    }
  } catch (error) {
    console.error('Failed to fetch data plans:', error);
  } finally{
    cartStore.loading = false
  }
};

// --- Lifecycle ---
onMounted(() => {
  fetchPlans();

});

// Watch: in case devices finish loading *after* the view mounts
watch(uniqueModels, (newVal, oldVal) => {
  if (newVal.length > 0 && newVal.join(',') !== oldVal?.join(',')) {
    fetchPlans();
  }
});
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface relative z-10 pointer-events-auto">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200">
      <div class="p-4 pb-2">
        <div class="flex space-x-6 overflow-x-auto no-scrollbar">
          <RouterLink to="/app-shop"
            class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-transparent text-gray-500 hover:text-gray-700"
          >
            <i class="fa-solid fa-box"></i>
            All Products
          </RouterLink>
          <button 
            class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-brand text-brand"
          >
            <i class="fa-solid fa-wifi"></i>
            Data Plans
          </button>
        </div>

        <div class="relative my-3">
          <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input 
            v-model="searchQuery"
            type="text" 
            placeholder="Search trackers by name..." 
            class="w-full pl-10 pr-4 py-2 bg-gray-100 border-transparent rounded-xl text-sm focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none"
          />
        </div>

        <div class="flex items-center justify-between pb-1">
          <div class="flex items-center">
            <button class="text-xs text-gray-500 hover:text-brand outline-none cursor-pointer" @click="showInfoModal= true">
              <span>More Info</span>
              <i class="fa-solid fa-circle-info ms-1"></i>
            </button>
          </div>
          <div class="shrink-0 flex items-center gap-1.5 pl-2">
            <i class="fa-solid fa-arrow-down-short-wide text-gray-400 text-xs"></i>
            <select v-model="sortBy" class="bg-transparent text-xs font-semibold text-gray-600 outline-none cursor-pointer">
              <option value="name">Sort by Name</option>
              <option value="model">Sort by Model</option>
              <option value="expiration">Sort by Expiration</option>
            </select>
          </div>
        </div>

      </div>
    </div>

    <div class="p-4 space-y-4 pb-35">
      
      <div v-if="processedDevices.length === 0" class="text-center text-gray-500 py-10 bg-white rounded-xl border border-gray-200 shadow-sm">
        <i class="fa-solid fa-satellite-dish text-3xl mb-3 text-gray-300"></i>
        <p class="text-sm px-4">No active devices found matching your criteria.</p>
      </div>

      <div 
        v-for="device in processedDevices" 
        :key="device.id"
        class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 transition-all"
        :class="{ 'ring-2 ring-brand border-brand': cartStore.planCart[device.id] }"
      >
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                 :class="isExpired(device.expiration) ? 'bg-red-50 text-red-500' : isExpiringSoon(device.expiration) ? 'bg-yellow-50 text-yellow-500' : 'bg-green-50 text-green-500'">
              <i class="fa-solid" 
                 :class="isExpired(device.expiration) ? 'fa-ban' : isExpiringSoon(device.expiration) ? 'fa-triangle-exclamation' : 'fa-check'"></i>
            </div>
            
            <div>
              <h2 class="text-base font-bold text-gray-800 leading-tight">{{ device.name || 'Unnamed Tracker' }}</h2>
              <div class="flex items-center gap-2 mt-0.5">
                <p class="text-xs" 
                   :class="isExpired(device.expiration) ? 'text-red-500 font-bold' : isExpiringSoon(device.expiration) ? 'text-yellow-600 font-bold' : 'text-gray-500'">
                  Exp: {{ formatDate(device.expiration) }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <button 
            v-for="plan in getDevicePlans(device.model)" 
            :key="plan.months"
            @click="cartStore.togglePlan(device.id, plan)"
            class="py-2 px-1 rounded-lg border flex flex-col items-center transition-colors outline-none cursor-pointer active:scale-95"
            :class="cartStore.planCart[device.id]?.months === plan.months 
              ? 'bg-brand-light border-brand text-brand-dark font-bold shadow-inner' 
              : 'bg-white border-gray-200 text-gray-600 hover:bg-surface'"
          >
            <span class="text-xs mb-1">+{{ plan.months }} Months</span>
            <span class="text-[11px]" :class="cartStore.planCart[device.id]?.months === plan.months ? 'text-brand' : 'text-gray-400'">
              ${{ plan.price_usd }}
            </span>
          </button>
          
          <div v-if="getDevicePlans(device.model).length === 0" class="col-span-3 text-center text-xs text-gray-400 py-2">
            No active data plans currently available for this model.
          </div>
        </div>
      </div>
    </div>

    <div 
      v-if="cartStore.planCount > 0"
      class="fixed bottom-[calc(48px+env(safe-area-inset-bottom))] left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.1)] z-30 transform transition-transform"
    >
      <div class="flex justify-between items-center mb-3 px-1">
        <span class="text-sm text-gray-600 font-semibold">
          Renewing {{ cartStore.planCount }}
        </span>
        <span class="text-lg font-bold text-gray-800">
          TOTAL: ${{ cartStore.planTotal }}
        </span>
      </div>
      <button @click="cartStore.checkout('plan')" class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]">
        Checkout
        <i class="fa-solid fa-cart-shopping"></i>
      </button>
    </div>

    <teleport to="body">
      <div v-if="showInfoModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm transition-opacity">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-scale-up">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
                <i class="fa-solid fa-wifi text-brand"></i> Data Plans Explained
              </h3>
              <button @click="showInfoModal = false" class="text-gray-400 hover:text-gray-600 outline-none">
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            
            <div class="text-sm text-gray-600 space-y-3 leading-relaxed">
              <p>
                <strong>What is a Data Plan?</strong><br/>
                Your devices relies on wireless networks to transmit their location to Navitag servers. A data plan allows your device to connect with various global network service providers for continuous telemetry reporting.
              </p>
              <p>
                <strong>What does this purchase include?</strong><br/>
                Purchasing a data plan extends the active service life of the selected device by the chosen number of months. It includes all necessary access credentials to connect to supported networks to keep your device online and tracking.
              </p>
              <p>
                <strong>Service Terms:</strong><br/>
                These data plans are one-time purchases and <em>do not automatically renew</em>. You will receive a notification before your device expires so you can choose whether or not to extend it again.
              </p>
            </div>
            
            <button 
              @click="showInfoModal = false"
              class="mt-6 w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl text-sm transition-colors outline-none"
            >
              Understood
            </button>
          </div>
        </div>
      </div>
    </teleport>

  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.animate-scale-up {
  animation: scaleUp 0.2s ease-out forwards;
}

@keyframes scaleUp {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>