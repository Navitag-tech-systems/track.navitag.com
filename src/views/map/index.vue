<script setup>
import { ref, computed } from 'vue';
import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';


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

// REMOVED `watch(searchQuery)`
// Added this function to handle manual typing instead
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
  // Add logic to pan the map to this device
  deviceStore.deviceSelected = device.uniqueId
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
            class="w-full p-1 bg-white/95 backdrop-blur-sm border border-gray-200 rounded text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
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

    <div v-if="deviceStore.deviceSelectedObject !== null" class="pointer-events-auto mt-auto bg-white p-4 text-center">
      <p></p>
    </div>

  </div>
</template>

<style scoped>
/* Smooth animation for the dropdown */
.animate-fade-in {
  animation: fadeIn 0.15s ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px) scaleY(0.95); }
  to { opacity: 1; transform: translateY(0) scaleY(1); }
}
</style>