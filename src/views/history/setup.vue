<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { hasScope } from '@/utils/scopes';
import DatePicker from '@/components/datePicker.vue'; // Importing your component
import SharedBadge from '@/components/SharedBadge.vue';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();

// Local-date helper: native <input type="date"> and the backend's per-user-tz
// "today" check both interpret the YYYY-MM-DD string in the user's local zone.
// toISOString() returns UTC, so before ~08:00 in Manila (UTC+8) it lags a day
// and the backend rejects a picker pick of "today (Manila)" as in the future.
const toLocalDateString = (d = new Date()) =>
  d.getFullYear() + '-' +
  String(d.getMonth() + 1).padStart(2, '0') + '-' +
  String(d.getDate()).padStart(2, '0');

// --- State ---
const selectedDeviceId = ref(null);
const selectedDate = ref(toLocalDateString()); // Default today (local)
const today = ref(toLocalDateString());         // Max date limit (local)

// Plan-based min date
const minDate = computed(() => {
  const device = selectedDevice.value;
  const plan = (device?.plan_level || 'basic').toLowerCase();
  const maxDays = plan === 'pro' ? 90 : 31;
  const d = new Date();
  d.setDate(d.getDate() - maxDays);
  return toLocalDateString(d);
});

const searchQuery = ref('');
const isDropdownOpen = ref(false);

// --- Computed ---
// 1. Filter store for devices that actually have position data and that
//    the viewer has history:read access to. Owners pass via OWNER_SENTINEL.
const devicesWithPositions = computed(() => {
  return Object.values(deviceStore.devices).filter(d => {
    if (!d.latlon || d.latlon.length !== 2) return false;
    if (!hasScope(d, 'history:read')) return false;
    return true;
  });
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

// Generate-Report gate: must have a selection that the viewer can read
// history on. Owners pass via OWNER_SENTINEL; shared devices need
// history:read in their /share/tome scope list. Belt-and-braces — the
// devicesWithPositions filter already excludes inaccessible devices.
const canGenerate = computed(() => hasScope(selectedDevice.value, 'history:read'));

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
  
  router.push(`/history/${selectedDevice.value.uniqueId}/${selectedDate.value}/route`);
};
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface relative z-10 pointer-events-auto">
    
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
        <div class="flex items-center justify-center w-16 h-16 bg-brand-light text-brand rounded-full mb-6 mx-auto">
          <i class="fa-solid fa-clock-rotate-left text-3xl"></i>
        </div>
        <h2 class="text-xl font-bold text-center text-gray-800 mb-2">Historical Playback</h2>
        <p class="text-sm text-center text-gray-500 mb-6">Select a tracker and a date to view its past routes and activities.</p>

        <div class="mb-5 relative">
          <label class="block text-sm font-bold text-gray-700 mb-2">Tracker</label>
          
          <button 
            @click="toggleDropdown"
            class="w-full pl-4 pr-10 py-3.5 bg-surface border rounded-xl text-sm font-bold text-left transition-all outline-none flex justify-between items-center"
            :class="isDropdownOpen ? 'border-brand bg-white ring-2 ring-brand-light' : 'border-gray-200 text-gray-700 hover:bg-gray-100'"
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
            <div class="p-2 border-b border-gray-100 bg-surface">
              <div class="relative">
                <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input 
                  v-model="searchQuery" 
                  type="text" 
                  placeholder="Search by name or IMEI..." 
                  class="w-full pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-brand"
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
                class="px-4 py-3 border-b border-gray-50 hover:bg-brand-light cursor-pointer transition-colors flex justify-between items-center"
                :class="{ 'bg-brand-light': selectedDeviceId === device.id }"
              >
                <div>
                  <div class="flex items-center gap-1.5">
                    <p class="text-sm font-bold text-gray-800">{{ device.name || 'Unnamed' }}</p>
                    <SharedBadge :device="device" />
                  </div>
                  <p class="text-[10px] text-gray-400 font-mono">{{ device.uniqueId }}</p>
                </div>
                <i v-if="selectedDeviceId === device.id" class="fa-solid fa-check text-brand"></i>
              </li>
            </ul>
          </div>
          
          <div v-if="isDropdownOpen" @click="isDropdownOpen = false" class="fixed inset-0 z-20"></div>
        </div>

        <DatePicker
          v-model="selectedDate"
          label="Report Date"
          :min="minDate"
          :max="today"
          class="mb-8"
        />

        <button
          @click="generateReport"
          :disabled="!canGenerate"
          :title="canGenerate ? '' : 'History access not granted for this device'"
          :class="[
            'w-full font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]',
            canGenerate
              ? 'bg-brand hover:bg-brand-dark text-white'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed',
          ]"
        >
          Generate Report
          <i class="fa-solid fa-arrow-right"></i>
        </button>
      </div>

    </div>
  </div>
</template>