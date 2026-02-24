<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices-backup';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();

// Get the device ID from the URL
const deviceId = route.params.id;

// Find the device in the store
const device = computed(() => {
  return deviceStore.devices[deviceId];
});

// Helper to format dates
const formatDate = (isoString) => {
  if (!isoString) return 'N/A';
  return new Date(isoString).toLocaleString();
};

// Helper to format booleans/nulls
const formatValue = (val) => {
  if (val === true) return 'Yes';
  if (val === false) return 'No';
  if (val === null || val === undefined) return 'N/A';
  return val;
};

// Action to jump to this device on the map
const viewOnMap = () => {
  if (!device.value) return;
  // Select the device in the store (this usually triggers map centering watchers)
  deviceStore.deviceSelected = device.value.id; 
  router.push('/');
};

// Action to view history
const viewHistory = () => {
  if (!device.value) return;
  router.push(`/history/${device.value.uniqueId}`);
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
      <h1 class="text-lg font-bold text-gray-800">Device Details</h1>
    </div>

    <div v-if="!device" class="p-10 text-center text-gray-500">
      <p>Device not found or loading...</p>
    </div>

    <div v-else class="p-4 space-y-4 pb-10">
      
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div class="flex justify-between items-start mb-4">
          <div>
            <h2 class="text-xl font-bold text-gray-800">{{ device.name }}</h2>
            <p class="text-xs text-gray-400 font-mono mt-1">IMEI: {{ device.uniqueId }}</p>
            <p class="text-xs text-gray-400 font-mono">ID: {{ device.id }}</p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <span 
              class="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border"
              :class="device.status === 'online' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-gray-50 text-gray-500 border-gray-200'"
            >
              {{ device.status }}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mt-4">
          <button @click="viewOnMap" class="flex items-center justify-center gap-2 bg-blue-50 text-blue-600 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-100 transition-colors">
            <i class="fa-solid fa-map-location-dot"></i> Map
          </button>
          <button @click="viewHistory" class="flex items-center justify-center gap-2 bg-gray-50 text-gray-600 py-2.5 rounded-lg text-sm font-bold hover:bg-gray-100 transition-colors">
            <i class="fa-solid fa-clock-rotate-left"></i> History
          </button>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-gray-50 px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">
          Status & Sensors
        </div>
        <div class="divide-y divide-gray-100">
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Ignition</span>
            <span class="font-bold" :class="device.ignition ? 'text-green-600' : 'text-gray-400'">{{ device.ignition ? 'ON' : 'OFF' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Motion</span>
            <span class="font-bold text-gray-800">{{ formatValue(device.motion) }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Speed</span>
            <span class="font-bold text-gray-800">{{ device.speed ? Math.round(device.speed * 1.852) + ' km/h' : '0 km/h' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">External Power</span>
            <span class="font-bold text-gray-800">{{ device.power ? device.power + ' V' : 'N/A' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Battery Level</span>
            <span class="font-bold text-gray-800">{{ device.battery ? device.battery + '%' : 'N/A' }}</span>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-gray-50 px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">
          Location
        </div>
        <div class="divide-y divide-gray-100">
          <div class="p-3 text-sm">
            <span class="block text-gray-500 mb-1">Address</span>
            <span class="block font-medium text-gray-800 leading-snug">{{ device.address || 'Resolving address...' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Coordinates</span>
            <span class="font-mono text-gray-700 text-xs mt-0.5">
              {{ device.latlon ? `${device.latlon[0].toFixed(5)}, ${device.latlon[1].toFixed(5)}` : 'N/A' }}
            </span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Course / Bearing</span>
            <span class="font-bold text-gray-800">{{ device.bearing }}°</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Accuracy</span>
            <span class="font-bold text-gray-800">{{ device.accuracy ? device.accuracy + ' m' : 'N/A' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Last Update (Server)</span>
            <span class="font-bold text-gray-800 text-xs mt-0.5">{{ formatDate(device.updateTime) }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">GPS Fix Time</span>
            <span class="font-bold text-gray-800 text-xs mt-0.5">{{ formatDate(device.fixTime) }}</span>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-gray-50 px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">
          Network
        </div>
        <div class="divide-y divide-gray-100">
           <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Connection Type</span>
            <span class="font-bold text-gray-800 uppercase">{{ device.connectionType || 'N/A' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Signal Strength</span>
            <span class="font-bold text-gray-800">{{ device.signalLevel || 'N/A' }}</span>
          </div>
          <div class="flex justify-between p-3 text-sm">
            <span class="text-gray-500">Mobile Operator (MCC/MNC)</span>
            <span class="font-bold text-gray-800">{{ device.mobileCountryCode || '?' }} / {{ device.mobileNetworkCode || '?' }}</span>
          </div>
        </div>
      </div>

      <div v-if="device.attributes && Object.keys(device.attributes).length > 0" class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="bg-gray-50 px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">
          Other Attributes
        </div>
        <div class="divide-y divide-gray-100">
          <div 
            v-for="(value, key) in device.attributes" 
            :key="key"
            class="flex justify-between p-3 text-sm"
          >
            <template v-if="!['ignition', 'power', 'battery', 'motion', 'event'].includes(key)">
              <span class="text-gray-500 capitalize">{{ key.replace(/([A-Z])/g, ' $1').trim() }}</span>
              <span class="font-bold text-gray-800 text-right ml-4 break-all">{{ formatValue(value) }}</span>
            </template>
          </div>
        </div>
      </div>

      <details class="bg-gray-100 rounded-xl p-3 text-xs text-gray-500">
        <summary class="cursor-pointer font-bold mb-2">Debug Data (Raw JSON)</summary>
        <pre class="overflow-x-auto">{{ device }}</pre>
      </details>

    </div>
  </div>
</template>