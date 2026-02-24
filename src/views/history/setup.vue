<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices-backup';
import DatePicker from '@/components/datePicker.vue'; // Importing your component

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();

// --- State ---
const selectedDeviceId = ref(null);
const selectedDate = ref(new Date().toISOString().split('T')[0]); // Default today
const today = ref(new Date().toISOString().split('T')[0]); // Max date limit

const searchQuery = ref('');
const isDropdownOpen = ref(false);

// --- Computed ---
// 1. Filter store for devices that actually have position data
const devicesWithPositions = computed(() => {
  return Object.values(deviceStore.devices).filter(d => d.latlon && d.latlon.length === 2);
});

// 2. Filter the dropdown list based on the search input
const filteredDevices = computed(() => {
  if (!searchQuery.value.trim()) return devicesWithPositions.value;
  const lowerQuery = searchQuery.value.toLowerCase();
  return devicesWithPositions.value.filter(d => 
    d.name?.toLowerCase().includes(lowerQuery) || 
    String(d.uniqueId).includes(lowerQuery)
  );
});

// 3. Get the currently selected device object (Local State)
const selectedDevice = computed(() => {
  if (!selectedDeviceId.value) return null;
  return devicesWithPositions.value.find(d => d.id === selectedDeviceId.value);
});

// --- Auto-Select Logic ---
watch(
  () => devicesWithPositions.value,
  (devices) => {
    // If the user has already manually selected something, don't overwrite it
    if (selectedDeviceId.value) return;

    // 1. Priority: Check URL Param (IMEI)
    if (route.params.imei) {
      const match = devices.find(d => String(d.uniqueId) === String(route.params.imei));
      if (match) {
        selectedDeviceId.value = match.id;
        return; 
      }
    }

    // 2. Fallback: Check Global Store Selection (deviceSelectedObject)
    if (deviceStore.deviceSelectedObject) {
      const match = devices.find(d => d.id === deviceStore.deviceSelectedObject.id);
      if (match) {
        selectedDeviceId.value = match.id;
      }
    }
  },
  { immediate: true }
);

// --- Actions ---
const toggleDropdown = () => {
  isDropdownOpen.value = !isDropdownOpen.value;
  if (isDropdownOpen.value) {
    searchQuery.value = ''; // Clear search when opening
  }
};

const selectDevice = (id) => {
  selectedDeviceId.value = id;
  isDropdownOpen.value = false;
};

const generateReport = () => {
  if (!selectedDevice.value) {
    alert('Please select a tracker first.');
    return;
  }
  if (!selectedDate.value) {
    alert('Please select a date.');
    return;
  }
  
  router.push(`/history/${selectedDevice.value.uniqueId}/${selectedDate.value}`);
};
</script>

<template>
  <div class="flex flex-col min-h-full bg-gray-50 relative z-10 pointer-events-auto">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200 p-4 flex items-center safe-top">
      <button 
        @click="router.back()" 
        class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none"
      >
        <i class="fa-solid fa-arrow-left text-lg"></i>
      </button>
      <h1 class="text-lg font-bold text-gray-800">Route History</h1>
    </div>

    <div class="p-4 space-y-6 mt-2 max-w-md mx-auto w-full">
      
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div class="flex items-center justify-center w-16 h-16 bg-blue-50 text-blue-600 rounded-full mb-6 mx-auto">
          <i class="fa-solid fa-clock-rotate-left text-3xl"></i>
        </div>
        <h2 class="text-xl font-bold text-center text-gray-800 mb-2">Historical Playback</h2>
        <p class="text-sm text-center text-gray-500 mb-6">Select a tracker and a date to view its past routes and activities.</p>

        <div class="mb-5 relative">
          <label class="block text-sm font-bold text-gray-700 mb-2">Tracker</label>
          
          <button 
            @click="toggleDropdown"
            class="w-full pl-4 pr-10 py-3.5 bg-gray-50 border rounded-xl text-sm font-bold text-left transition-all outline-none flex justify-between items-center"
            :class="isDropdownOpen ? 'border-blue-500 bg-white ring-2 ring-blue-200' : 'border-gray-200 text-gray-700 hover:bg-gray-100'"
          >
            <span class="truncate" :class="{ 'text-gray-400 font-normal': !selectedDevice }">
              {{ selectedDevice ? selectedDevice.name : 'Select a tracker...' }}
            </span>
            <i class="fa-solid fa-chevron-down absolute right-4 text-gray-400 transition-transform duration-200" :class="{ 'rotate-180': isDropdownOpen }"></i>
          </button>

          <div 
            v-if="isDropdownOpen" 
            class="absolute left-0 right-0 top-full mt-2 bg-white border border-gray-100 shadow-xl rounded-xl z-30 overflow-hidden"
          >
            <div class="p-2 border-b border-gray-100 bg-gray-50">
              <div class="relative">
                <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input 
                  v-model="searchQuery" 
                  type="text" 
                  placeholder="Search by name or IMEI..." 
                  class="w-full pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <ul class="max-h-60 overflow-y-auto overscroll-contain">
              <li 
                v-if="filteredDevices.length === 0" 
                class="px-4 py-4 text-sm text-center text-gray-500"
              >
                No trackers found with positions.
              </li>
              <li 
                v-for="device in filteredDevices" 
                :key="device.id"
                @click="selectDevice(device.id)"
                class="px-4 py-3 border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors flex justify-between items-center"
                :class="{ 'bg-blue-50': selectedDeviceId === device.id }"
              >
                <div>
                  <p class="text-sm font-bold text-gray-800">{{ device.name || 'Unnamed' }}</p>
                  <p class="text-[10px] text-gray-400 font-mono">{{ device.uniqueId }}</p>
                </div>
                <i v-if="selectedDeviceId === device.id" class="fa-solid fa-check text-blue-600"></i>
              </li>
            </ul>
          </div>
          
          <div v-if="isDropdownOpen" @click="isDropdownOpen = false" class="fixed inset-0 z-20"></div>
        </div>

        <DatePicker 
          v-model="selectedDate" 
          label="Report Date" 
          :max="today" 
          class="mb-8"
        />

        <button 
          @click="generateReport"
          class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          Generate Report
          <i class="fa-solid fa-arrow-right"></i>
        </button>
      </div>

    </div>
  </div>
</template>