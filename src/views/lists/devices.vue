<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import ShareModal from '@/components/ShareModal.vue';
import DeviceCard from '@/components/DeviceCard.vue';
import { getWarnings } from '@/utils/deviceMetrics';

const router = useRouter();
const deviceStore = useDevicesStore();

// --- Share Modal ---
const showShareModal = ref(false);
const shareTarget = ref({ imei: null, name: '' });
const openShare = (device) => {
  shareTarget.value = { imei: device.uniqueId, name: device.name || '' };
  showShareModal.value = true;
};

// --- State ---
const searchQuery = ref('');
const filterBy = ref('all');
const sortBy = ref('name');

const toggleSelection = (id) => {
  deviceStore.deviceSelected = deviceStore.deviceSelected === id ? null : id;
};

// Online ⇔ recency-gated status, centralised in the store (see isDeviceOnline).
const isOffline = (device) => !deviceStore.isDeviceOnline(device);

// --- Processed Devices (search + filter + sort) ---
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
      return (a.name || '').localeCompare(b.name || '');
    }
    if (sortBy.value === 'lastUpdate') {
      return (b.lastSeenMs || 0) - (a.lastSeenMs || 0);
    }
    return 0;
  });

  return arr;
});
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
        <DeviceCard
          v-for="device in processedDevices"
          :key="device.id"
          :device="device"
          :selected="deviceStore.deviceSelected === device.id"
          @select="toggleSelection(device.id)"
          @share="openShare(device)"
        />

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

    <ShareModal
      v-model="showShareModal"
      :imei="shareTarget.imei"
      :label="shareTarget.name"
    />
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
