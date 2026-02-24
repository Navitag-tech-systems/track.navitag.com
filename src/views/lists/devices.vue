<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices';

const router = useRouter();
const deviceStore = useDevicesStore();

// --- State ---
const searchQuery = ref('');
const filterBy = ref('all'); // 'all', 'online', 'offline', 'ignition', 'warning'
const sortBy = ref('name');  // 'name', 'lastUpdate'

// --- Helpers ---
const isOffline = (device) => {
  return !device.status || device.status === 'offline' || device.status === 'unknown';
};

const getSignalLevel = (signal) => {
  if (signal === undefined || signal === null) return 'Disconnected';
  // Handles typical dBm (negative numbers) or 0-5 scale
  if (signal < 0) {
    if (signal >= -75) return 'Good';
    if (signal >= -95) return 'Fair';
    return 'Low';
  }
  if (signal > 20 || signal >= 4) return 'Good';
  if (signal > 10 || signal >= 2) return 'Fair';
  return 'Low';
};

const getWarnings = (device) => {
  const warnings = [];
  if (isOffline(device)) {
    warnings.push('Device is offline');
  }
  if (device.power !== undefined && device.power !== null && device.power < 5) {
    warnings.push('Low Power (< 5V)');
  }
  const signal = getSignalLevel(device.signalLevel);
  if (signal === 'Low' || signal === 'Disconnected') {
    warnings.push(`Network: ${signal}`);
  }
  return warnings;
};

// --- Processed Devices (Search, Filter, Sort) ---
const processedDevices = computed(() => {
  let arr = Object.values(deviceStore.devices);

  // 1. Search
  if (searchQuery.value.trim()) {
    arr = arr.filter(device => 
      device.name?.toLowerCase().includes(searchQuery.value.toLowerCase())
    );
  }

  // 2. Filter
  if (filterBy.value !== 'all') {
    arr = arr.filter(device => {
      if (filterBy.value === 'online') return !isOffline(device);
      if (filterBy.value === 'offline') return isOffline(device);
      if (filterBy.value === 'ignition') return device.ignition === true;
      if (filterBy.value === 'warning') return getWarnings(device).length > 0;
      return true;
    });
  }

  // 3. Sort
  arr.sort((a, b) => {
    if (sortBy.value === 'name') {
      const nameA = a.name || '';
      const nameB = b.name || '';
      return nameA.localeCompare(nameB);
    } 
    if (sortBy.value === 'lastUpdate') {
      const timeA = a.lastUpdate ? new Date(a.lastUpdate).getTime() : 0;
      const timeB = b.lastUpdate ? new Date(b.lastUpdate).getTime() : 0;
      return timeB - timeA; // Descending (newest first)
    }
    return 0;
  });

  return arr;
});

// Helper for formatting the Traccar ISO timestamp
const formatDate = (dateString) => {
  if (!dateString) return 'Waiting for update...';
  const date = new Date(dateString);
  return date.toLocaleString(undefined, { 
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};
</script>

<template>
  <div class="flex flex-col min-h-full bg-gray-50">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200">
      <div class="p-4">
        <h1 class="text-xl font-bold text-gray-800 mb-3">Overview</h1>
        
        <div class="flex space-x-6 overflow-x-auto no-scrollbar mb-4">
          <button class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-blue-600 text-blue-600">
            <i class="fa-solid fa-satellite-dish"></i>
            Devices
          </button>
          <button @click="router.push('/addgeo')" class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-transparent text-gray-500 hover:text-gray-700">
            <i class="fa-solid fa-draw-polygon"></i>
            Geofences
          </button>
        </div>

        <div class="relative mb-3">
          <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input 
            v-model="searchQuery"
            type="text" 
            placeholder="Search trackers by name..." 
            class="w-full pl-10 pr-4 py-2 bg-gray-100 border-transparent rounded-xl text-sm focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all outline-none"
          />
        </div>

        <div class="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-1">
          <div class="flex space-x-2 shrink-0">
            <button @click="filterBy = 'all'" :class="filterBy === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">All</button>
            <button @click="filterBy = 'online'" :class="filterBy === 'online' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">Online</button>
            <button @click="filterBy = 'offline'" :class="filterBy === 'offline' ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">Offline</button>
            <button @click="filterBy = 'warning'" :class="filterBy === 'warning' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">Warnings</button>
          </div>
          <div class="shrink-0 flex items-center gap-1.5 pl-2 border-l border-gray-200">
            <i class="fa-solid fa-arrow-down-a-z text-gray-400 text-xs"></i>
            <select v-model="sortBy" class="bg-transparent text-xs font-semibold text-gray-600 outline-none cursor-pointer">
              <option value="name">Name</option>
              <option value="lastUpdate">Recent</option>
            </select>
          </div>
        </div>

      </div>
    </div>

    <div class="p-4 space-y-4">
      
      <div v-if="processedDevices.length === 0" class="text-center text-gray-500 py-10">
        <i class="fa-solid fa-satellite-dish text-4xl mb-3 text-gray-300"></i>
        <p class="text-sm">No trackers found.</p>
      </div>

      <div 
        v-for="device in processedDevices" 
        :key="device.id"
        class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 relative overflow-hidden transition-all hover:shadow-md"
        :class="{ 'border-red-200': getWarnings(device).length > 0 }"
      >
        <div class="flex items-start mb-3">
          <button class="p-1 rounded me-2">
            <i class="fa-solid fa-gear text-black-500 mt-0.5"></i>
          </button>

          <div>
            <h2 class="text-lg font-bold text-gray-800 leading-tight">{{ device.name || 'Unnamed Tracker' }}</h2>
            <p class="text-[11px] text-gray-400 font-mono mt-0.5">IMEI: {{ device.uniqueId }}</p>
          </div>

          

          

          <div class="flex-1"></div>

          <div class="flex items-center space-x-1.5 px-2 py-1 rounded-md border"
               :class="isOffline(device) ? 'bg-red-50 border-red-100 text-red-600' : 'bg-green-50 border-green-100 text-green-600'">
            <span class="relative flex h-2.5 w-2.5">
              <span v-if="!isOffline(device)" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2.5 w-2.5" :class="isOffline(device) ? 'bg-red-500' : 'bg-green-500'"></span>
            </span>
            <span class="text-[10px] font-bold uppercase tracking-wider">
              {{ isOffline(device) ? 'OFFLINE' : 'ONLINE' }}
            </span>
          </div>
        </div>

        <div v-if="getWarnings(device).length > 0" class="mb-4 bg-red-50 border border-red-100 rounded-lg p-2.5 flex items-start gap-2">
          <i class="fa-solid fa-triangle-exclamation text-red-500 mt-0.5"></i>
          <div class="flex flex-col">
            <span v-for="(warn, idx) in getWarnings(device)" :key="idx" class="text-xs font-semibold text-red-700 leading-tight">
              {{ warn }}
            </span>
          </div>
        </div>

        <div :class="{ 'opacity-40 saturate-0 pointer-events-none transition-all duration-300': isOffline(device) }">
          
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="flex items-center text-sm text-gray-600 bg-gray-50 p-2 rounded-lg">
              <div class="w-6 text-blue-500"><i class="fa-solid fa-gauge-high"></i></div>
              <span class="font-medium">{{ device.speed ? Math.round(device.speed * 1.852) : 0 }} km/h</span>
            </div>
            
            <div class="flex items-center text-sm text-gray-600 bg-gray-50 p-2 rounded-lg">
              <div class="w-6" :class="device.ignition ? 'text-green-500' : 'text-gray-400'">
                <i class="fa-solid fa-key"></i>
              </div>
              <span class="font-medium">{{ device.ignition ? 'Engine ON' : 'Engine OFF' }}</span>
            </div>

            <div class="flex items-center text-sm text-gray-600 bg-gray-50 p-2 rounded-lg">
              <div class="w-6 text-yellow-500"><i class="fa-solid fa-bolt"></i></div>
              <span class="font-medium">{{ device.power !== undefined ? `${device.power}V` : 'N/A' }}</span>
            </div>
            
            <div class="flex items-center text-sm text-gray-600 bg-gray-50 p-2 rounded-lg">
              <div class="w-6 text-purple-500"><i class="fa-solid fa-signal"></i></div>
              <span class="font-medium uppercase">{{ getSignalLevel(device.signalLevel) }}</span>
            </div>
          </div>

          <div class="pt-3 border-t border-gray-100">
            <div class="flex items-start text-xs text-gray-600 mb-2">
              <div class="w-5 mt-0.5 text-gray-400"><i class="fa-solid fa-location-dot"></i></div>
              <span class="line-clamp-2 leading-tight pr-2">{{ device.address || 'Address calculating...' }}</span>
            </div>
            <div class="flex items-center text-[10px] text-gray-400">
              <i class="fa-regular fa-clock mr-1.5"></i>
              Updated: {{ formatDate(device.lastUpdate) }}
            </div>
          </div>

        </div> 
      </div>
      
    </div>
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
</style>