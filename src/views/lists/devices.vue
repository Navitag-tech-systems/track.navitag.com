<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';

const router = useRouter();
const deviceStore = useDevicesStore();

// --- State ---
const searchQuery = ref('');
const filterBy = ref('all'); 
const sortBy = ref('name'); 

// --- Actions ---
const toggleSelection = (id) => {
  if (deviceStore.deviceSelected === id) {
    deviceStore.deviceSelected = null;
  } else {
    deviceStore.deviceSelected = id;
  }
};

const goToHistory = (uniqueId) => {
  router.push(`/history/${uniqueId}`);
};

const goToDetails = (id) => {
  router.push(`/devices/${id}`);
};

const goToSettings = (id) => {
  router.push(`/device/settings/${id}`);
};

// --- Helpers ---
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

// Standard Li-ion Voltage Map (3.7V Nominal, 4.2V Max)
const getBatteryPercentage = (val) => {
  if (val === undefined || val === null) return 'N/A';
  const v = Number(val);
  
  if (isNaN(v)) return 'N/A';
  if (v >= 4.20) return '100%';
  if (v >= 4.10) return '90%';
  if (v >= 4.00) return '80%';
  if (v >= 3.90) return '70%';
  if (v >= 3.80) return '60%';
  if (v >= 3.70) return '50%';
  if (v >= 3.65) return '20%';
  if (v >= 3.60) return '10%';
  return '0%'; // Critical
};

const getGpsQuality = (device) => {
  const sat = device.sat || 0;
  const hdop = device.hdop || 0;
  const valid = device.valid;

  if (!valid && sat === 0) return { label: 'No Fix', color: 'text-red-500', icon: 'fa-satellite' };
  if (sat < 4 || (hdop > 0 && hdop > 6)) return { label: 'Bad', color: 'text-orange-500', icon: 'fa-satellite' };
  if (sat < 7 || (hdop > 0 && hdop > 2.5)) return { label: 'Fair', color: 'text-yellow-600', icon: 'fa-satellite' };
  if (sat < 12 || (hdop > 0 && hdop > 1)) return { label: 'Good', color: 'text-brand', icon: 'fa-satellite' };
  return { label: 'Excellent', color: 'text-green-600', icon: 'fa-satellite' };
};

const getWarnings = (device) => {
  const warnings = [];
  if (device.power !== undefined && device.power !== null && device.power < 5) {
    warnings.push('Low Power (< 5V)');
  }
  const signal = getSignalLevel(device.signalLevel);
  if (signal === 'Low') {
    warnings.push(`Weak Network`);
  }
  return warnings;
};

// --- Processed Devices ---
const processedDevices = computed(() => {
  let arr = Object.values(deviceStore.devices);

  if (searchQuery.value.trim()) {
    arr = arr.filter(device => 
      device.name?.toLowerCase().includes(searchQuery.value.toLowerCase())
    );
  }

  if (filterBy.value !== 'all') {
    arr = arr.filter(device => {
      if (filterBy.value === 'online') return !isOffline(device);
      if (filterBy.value === 'offline') return isOffline(device);
      if (filterBy.value === 'ignition') return device.ignition === true;
      if (filterBy.value === 'warning') return getWarnings(device).length > 0;
      return true;
    });
  }

  arr.sort((a, b) => {
    if (sortBy.value === 'name') {
      const nameA = a.name || '';
      const nameB = b.name || '';
      return nameA.localeCompare(nameB);
    } 
    if (sortBy.value === 'lastUpdate') {
      const timeA = a.lastUpdate ? new Date(a.lastUpdate).getTime() : 0;
      const timeB = b.lastUpdate ? new Date(b.lastUpdate).getTime() : 0;
      return timeB - timeA; 
    }
    return 0;
  });

  return arr;
});

const formatDate = (dateString) => {
  if (!dateString) return 'Waiting for update...';
  const date = new Date(dateString);
  return date.toLocaleString(undefined, { 
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200">
      <div class="p-4">
        <div class="flex justify-between">
          <h1 class="text-xl font-bold text-gray-800 mb-3">Overview</h1>
          <RouterLink to="/linkdevice/start" class="w-10 h-10 rounded-full bg-accent-light text-accent flex items-center justify-center shrink-0" >
            <i class="fa-solid fa-plus"></i>
          </RouterLink>
          
        </div>
        
        
        <div class="flex space-x-6 overflow-x-auto no-scrollbar mb-4">
          <button class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-brand text-brand">
            <i class="fa-solid fa-satellite-dish"></i>
            Devices
          </button>
          <button @click="router.push('/list/geofences')" class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-transparent text-gray-500 hover:text-gray-700">
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
            class="w-full pl-10 pr-4 py-2 bg-gray-100 border-transparent rounded-xl text-sm focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none"
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
      
      <div v-if="processedDevices.length === 0" class="text-center text-gray-500 py-10 bg-white rounded-xl border border-gray-200 shadow-sm">
        <div class="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fa-solid fa-satellite-dish text-2xl text-gray-400"></i>
        </div>
        <h3 class="font-bold text-gray-800 mb-1">No Trackers</h3>
        <p class="text-sm px-4 mb-4">You haven't linked any GPS trackers yet. Scan or enter your device code to get started.</p>
        <RouterLink to="/linkdevice/start">
          <button class="bg-accent-light text-accent px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent-light transition cursor-pointer">
            Link Device
          </button>
        </RouterLink>
        <div class="mt-4 pt-4 mx-6 border-t border-gray-100">
          <p class="text-xs text-gray-500 font-medium">
            Need a new Navitag Device?
            <a href="https://www.navitag.com/shop" target="_blank" class="text-accent hover:underline font-bold ml-1">Shop Devices</a>
          </p>
        </div>
      </div>

      <div v-else>
        <div 
          v-for="device in processedDevices" 
          :key="device.id"
          @click="toggleSelection(device.id)"
          class="bg-white rounded-xl shadow-sm border p-4 my-2 relative overflow-hidden transition-all duration-200 cursor-pointer"
          :class="[
            getWarnings(device).length > 0 ? 'border-red-200' : 'border-gray-200',
            deviceStore.deviceSelected === device.id ? 'ring-2 ring-brand shadow-md' : 'hover:shadow-md'
          ]"
        >
          <div class="flex items-start mb-3">
            <div class="p-2 rounded-full bg-brand-light text-brand mr-3">
              <i class="fa-solid fa-truck text-lg"></i>
            </div>

            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-bold text-gray-800 leading-tight truncate">{{ device.name || 'Unnamed Tracker' }}</h2>
              <p class="text-[11px] text-gray-400 font-mono mt-0.5 truncate">IMEI: {{ device.uniqueId }}</p>
            </div>

            <div class="flex items-center space-x-1.5 px-2 py-1 rounded-md border shrink-0 ml-2"
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
            <i class="fa-solid fa-triangle-exclamation text-red-500 mt-0.5 text-xs"></i>
            <div class="flex flex-col">
              <span v-for="(warn, idx) in getWarnings(device)" :key="idx" class="text-xs font-semibold text-red-700 leading-tight">
                {{ warn }}
              </span>
            </div>
          </div>

          <div :class="{ 'opacity-60 saturate-50': isOffline(device) }">
            
            <div class="grid grid-cols-2 gap-2 mb-4">
              <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
                <div class="w-6 text-brand text-center"><i class="fa-solid fa-gauge-high"></i></div>
                <span class="font-medium ml-1">{{ device.speed ? Math.round(device.speed * 1.852) : 0 }} km/h</span>
              </div>
              
              <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
                <div class="w-6 text-center" :class="device.ignition ? 'text-green-500' : 'text-gray-400'">
                  <i class="fa-solid fa-key"></i>
                </div>
                <span class="font-medium ml-1">{{ device.ignition ? 'On' : 'Off' }}</span>
              </div>

              <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
                <div class="w-6 text-accent text-center"><i class="fa-solid fa-bolt"></i></div>
                <span class="font-medium ml-1">{{ device.power !== undefined ? `${Number(device.power).toFixed(2)}V` : 'N/A' }}</span>
              </div>

              <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
                <div class="w-6 text-green-500 text-center"><i class="fa-solid fa-battery-full"></i></div>
                <span class="font-medium ml-1">{{ getBatteryPercentage(device.battery) }}</span>
              </div>
              
              <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
                <div class="w-6 text-purple-500 text-center"><i class="fa-solid fa-signal"></i></div>
                <span class="font-medium ml-1 uppercase text-xs">{{ getSignalLevel(device.signalLevel) }}</span>
              </div>

              <div class="flex items-center text-sm text-gray-600 bg-surface p-2 rounded-lg">
                <div class="w-6 text-center" :class="getGpsQuality(device).color">
                  <i class="fa-solid" :class="getGpsQuality(device).icon"></i>
                </div>
                <span class="font-medium ml-1 text-xs">{{ getGpsQuality(device).label }}</span>
                <span v-if="device.sat" class="ml-auto text-[10px] text-gray-400 font-mono">{{ device.sat }} sats</span>
              </div>
            </div>

            <div class="pt-3 border-t border-gray-100">
              <div class="flex items-start text-xs text-gray-600 mb-2">
                <div class="w-5 mt-0.5 text-gray-400 text-center"><i class="fa-solid fa-location-dot"></i></div>
                <span class="line-clamp-1 leading-tight">{{ device.address || 'Address calculating...' }}</span>
              </div>
              <div class="flex items-center text-[10px] text-gray-400 pl-1">
                <i class="fa-regular fa-clock mr-1.5"></i>
                Updated: {{ formatDate(device.lastUpdate) }}
              </div>
            </div>

          </div> 

          <div v-if="deviceStore.deviceSelected === device.id" class="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center animate-fade-in gap-2">
            
            <button @click.stop="goToSettings(device.id)" class="flex-1 flex flex-col items-center justify-center bg-surface hover:bg-gray-100 py-2 rounded-lg transition-colors group">
              <i class="fa-solid fa-gear text-lg text-gray-500 group-hover:text-brand mb-1"></i>
              <span class="text-[10px] font-bold text-gray-600 group-hover:text-brand">Settings</span>
            </button>

            <button @click.stop="goToHistory(device.uniqueId)" class="flex-1 flex flex-col items-center justify-center bg-surface hover:bg-gray-100 py-2 rounded-lg transition-colors group">
              <i class="fa-solid fa-clock-rotate-left text-lg text-gray-500 group-hover:text-brand mb-1"></i>
              <span class="text-[10px] font-bold text-gray-600 group-hover:text-brand">History</span>
            </button>

            <button @click.stop="goToDetails(device.id)" class="flex-1 flex flex-col items-center justify-center bg-surface hover:bg-gray-100 py-2 rounded-lg transition-colors group">
              <i class="fa-solid fa-circle-info text-lg text-gray-500 group-hover:text-brand mb-1"></i>
              <span class="text-[10px] font-bold text-gray-600 group-hover:text-brand">Details</span>
            </button>

          </div>

        </div>
        
        <RouterLink to="/linkdevice/start" class="bg- my-2 rounded-xl shadow-sm border border-gray-200 p-4 flex justify-center items-center transition-all hover:shadow-md">
          <div class="flex items-center gap-4">

            <div class="w-10 h-10 rounded-full bg-accent-light text-accent flex items-center justify-center shrink-0">
              <i class="fa-solid fa-plus"></i>
            </div>
            <div>
              <h3 class="font-bold text-gray-800 leading-tight">NEW DEVICE</h3>
            </div>
          </div>
        </RouterLink>
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

.animate-fade-in {
  animation: fadeIn 0.2s ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>