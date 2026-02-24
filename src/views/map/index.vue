<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router'; 
import { useUserStore } from '@/stores/user-backup';
import { useDevicesStore } from '@/stores/devices-backup';

const router = useRouter(); 
const deviceStore = useDevicesStore();
const userStore = useUserStore();

// --- Search State ---
const searchQuery = ref('');
const showDropdown = ref(false);
const focusedIndex = ref(-1);

// Filter results based on search query
const filteredResults = computed(() => {
  const devicesArray = Object.values(deviceStore.devices);
  if (!searchQuery.value) return devicesArray;
  
  return devicesArray.filter(device => 
    device.name.toLowerCase().includes(searchQuery.value.toLowerCase())
  );
});

const onSearchInput = () => {
  focusedIndex.value = -1;
  if (searchQuery.value.trim().length > 0) {
    showDropdown.value = true;
  } else {
    showDropdown.value = false;
  }
};

// Handle selection from dropdown
const selectDevice = (device) => {
  if (!device) return;
  searchQuery.value = '';
  showDropdown.value = false;
  focusedIndex.value = -1;
  console.log('Selected:', device.name, 'UID:', device.uniqueId);
  deviceStore.deviceSelected = device.id; 
};

// --- Keyboard Navigation Handlers ---
const onArrowDown = () => {
  if (!showDropdown.value && searchQuery.value.trim().length > 0) {
    showDropdown.value = true;
  }
  if (focusedIndex.value < filteredResults.value.length - 1) {
    focusedIndex.value++;
  }
};

const onArrowUp = () => {
  if (focusedIndex.value > 0) {
    focusedIndex.value--;
  }
};

const onEnter = () => {
  if (showDropdown.value && focusedIndex.value >= 0 && focusedIndex.value < filteredResults.value.length) {
    selectDevice(filteredResults.value[focusedIndex.value]);
  }
};

function timeout(){
  setTimeout(() => showDropdown.value = false, 200)
}

// --- Device Card Helpers ---
const isOffline = (device) => {
  return !device.status || device.status === 'offline' || device.status === 'unknown';
};

const getSignalLevel = (signal) => {
  if (signal === undefined || signal === null) return 'N/A';
  if (signal < 0) {
    if (signal >= -75) return 'Good';
    if (signal >= -95) return 'Fair';
    return 'Low';
  }
  if (signal > 20 || signal >= 4) return 'Good';
  if (signal > 10 || signal >= 2) return 'Fair';
  return 'Low';
};

const getGpsQuality = (device) => {
  const sat = device.sat || 0;
  const hdop = device.hdop || 0;
  const valid = device.valid;

  if (!valid && sat === 0) return { label: 'No Fix', color: 'text-red-500' };
  
  // Logic: Low Satellites OR High HDOP (inaccuracy) = Bad Signal
  if (sat < 4 || (hdop > 0 && hdop > 6)) return { label: 'Bad', color: 'text-orange-500' };
  if (sat < 7 || (hdop > 0 && hdop > 2.5)) return { label: 'Fair', color: 'text-yellow-600' };
  if (sat < 12 || (hdop > 0 && hdop > 1)) return { label: 'Good', color: 'text-blue-500' };
  
  return { label: 'Excellent', color: 'text-green-600' };
};
</script>

<template>
  <div class="h-full flex flex-col pointer-events-none">
    
    <div class="p-4 flex justify-end pointer-events-auto">
      <div class="relative w-48 sm:w-64">
        <div class="relative">
          <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
          <input 
            v-model="searchQuery"
            @input="onSearchInput"
            @focus="searchQuery.trim().length > 0 ? showDropdown = true : null"
            @blur="timeout"
            @keydown.down.prevent="onArrowDown"
            @keydown.up.prevent="onArrowUp"
            @keydown.enter.prevent="onEnter"
            @keydown.esc="showDropdown = false"
            type="text" 
            placeholder="Find tracker..." 
            class="w-full pl-9 pr-2 py-2 bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
        </div>

        <div 
          v-if="showDropdown && searchQuery.trim().length > 0"
          class="absolute right-0 mt-1 w-full bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50 origin-top animate-fade-in"
        >
          <ul class="max-h-48 overflow-y-auto">
            <li 
              v-for="(device, index) in filteredResults" 
              :key="device.id"
              @click="selectDevice(device)"
              @mouseenter="focusedIndex = index"
              :class="[
                'px-4 py-3 cursor-pointer text-sm text-gray-700 border-b border-gray-50 last:border-0 flex items-center',
                focusedIndex === index ? 'bg-blue-50' : 'hover:bg-blue-50'
              ]"
            >
              <i class="fa-solid fa-location-dot text-blue-500 mr-2 opacity-70"></i>
              {{ device.name }}
            </li>
            <li v-if="filteredResults.length === 0" class="px-4 py-4 text-sm text-gray-500 text-center italic">
              No trackers found
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div 
      v-if="deviceStore.deviceSelectedObject" 
      class="pointer-events-auto mt-auto bg-white rounded-t-2xl shadow-[0_-5px_20px_rgba(0,0,0,0.1)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] animate-slide-up"
    >
      <div class="flex justify-between items-center mb-1">
        <h2 class="text-sm font-bold text-gray-800 truncate pr-4">{{ deviceStore.deviceSelectedObject.name }}</h2>
        <button 
          @click="deviceStore.deviceSelected = null" 
          class="w-6 h-6 flex items-center justify-center bg-gray-100 text-gray-500 rounded-full hover:bg-gray-200 transition-colors shrink-0"
        >
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>

      <div class="flex items-center gap-2 mb-2">
        <span 
          class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border shrink-0"
          :class="isOffline(deviceStore.deviceSelectedObject) ? 'bg-red-50 border-red-100 text-red-600' : 'bg-green-50 border-green-100 text-green-600'"
        >
          <span class="w-1.5 h-1.5 rounded-full" :class="isOffline(deviceStore.deviceSelectedObject) ? 'bg-red-500' : 'bg-green-500'"></span>
          {{ isOffline(deviceStore.deviceSelectedObject) ? 'Off' : 'On' }}
        </span>
        <p class="text-[10px] text-gray-500 truncate flex-1">
          <i class="fa-solid fa-location-dot text-blue-400 mr-1"></i>
          {{ deviceStore.deviceSelectedObject.address || 'Locating...' }}
        </p>
      </div>

      <div class="flex items-center justify-between">
        
        <div class="flex gap-3">
          <div class="flex items-center gap-1 text-[10px] text-gray-700">
            <i class="fa-solid fa-gauge-high text-blue-500"></i>
            <span class="font-bold">{{ deviceStore.deviceSelectedObject.speed ? Math.round(deviceStore.deviceSelectedObject.speed * 1.852) : 0 }}</span>
          </div>

          <div class="flex items-center gap-1 text-[10px] text-gray-700">
            <i class="fa-solid fa-key" :class="deviceStore.deviceSelectedObject.ignition ? 'text-green-500' : 'text-gray-400'"></i>
          </div>

          <div class="flex items-center gap-1 text-[10px] text-gray-700">
            <i class="fa-solid fa-signal text-purple-500"></i>
            <span class="font-bold text-[9px] uppercase">{{ getSignalLevel(deviceStore.deviceSelectedObject.signalLevel) }}</span>
          </div>

          <div class="flex items-center gap-1 text-[10px] text-gray-700">
            <i class="fa-solid fa-satellite" :class="getGpsQuality(deviceStore.deviceSelectedObject).color"></i>
            <span class="font-bold text-[9px]">{{ getGpsQuality(deviceStore.deviceSelectedObject).label }}</span>
          </div>
        </div>

        <button 
          @click="router.push(`/devices/${deviceStore.deviceSelectedObject.id}`)"
          class="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
        >
          Details <i class="fa-solid fa-chevron-right text-[8px]"></i>
        </button>

      </div>

    </div>

  </div>
</template>

<style scoped>
/* Smooth animation for the dropdown */
.animate-fade-in {
  animation: fadeIn 0.15s ease-out forwards;
}

.animate-slide-up {
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px) scaleY(0.95); }
  to { opacity: 1; transform: translateY(0) scaleY(1); }
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>