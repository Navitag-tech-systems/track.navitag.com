<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices';

const router = useRouter();
const deviceStore = useDevicesStore();

// Convert the reactive object into an array for the v-for loop
const geofencesList = computed(() => {
  return Object.entries(deviceStore.geofences).map(([id, data]) => ({
    id,
    ...data
  }));
});

// Placeholder for future delete functionality
const deleteGeofence = (id) => {
  if (confirm('Are you sure you want to delete this geofence?')) {
    console.log('Deleting geofence ID:', id);
    // TODO: Add an API call to delete from the Traccar server
    // e.g., await ky.delete(`https://${userStore.server_url}/api/geofences/${id}`)
    // and then remove it from the local store: delete deviceStore.geofences[id]
  }
};
</script>

<template>
  <div class="flex flex-col min-h-full bg-gray-50">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200">
      <div class="p-4">
        <h1 class="text-xl font-bold text-gray-800 mb-3">Overview</h1>
        
        <div class="flex space-x-6 overflow-x-auto no-scrollbar">
          <button
            @click="router.replace('/list/devices')"
            class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-transparent text-gray-500 hover:text-gray-700"
          >
            <i class="fa-solid fa-satellite-dish"></i>
            Devices
          </button>
          <button
            class="pb-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 outline-none cursor-pointer border-blue-600 text-blue-600"
          >
            <i class="fa-solid fa-draw-polygon"></i>
            Geofences
          </button>
        </div>
      </div>
    </div>

    <div class="p-4 space-y-4">
      
      <div v-if="geofencesList.length === 0" class="text-center text-gray-500 py-10 bg-white rounded-xl border border-gray-200 shadow-sm">
        <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fa-solid fa-draw-polygon text-2xl text-gray-400"></i>
        </div>
        <h3 class="font-bold text-gray-800 mb-1">No Geofences</h3>
        <p class="text-sm px-4 mb-4">You haven't set up any geofences yet. Draw areas on the map to receive alerts when trackers enter or exit.</p>
        <button class="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-100 transition cursor-pointer">
          Create Geofence
        </button>
      </div>

      <div v-else class="space-y-3">
        <div 
          v-for="geofence in geofencesList" 
          :key="geofence.id"
          class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex justify-between items-center transition-all hover:shadow-md"
        >
          <div class="flex items-center gap-4">
            <div class="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
              <i class="fa-solid fa-draw-polygon"></i>
            </div>
            <div>
              <h3 class="font-bold text-gray-800 leading-tight">{{ geofence.name }}</h3>
              <p class="text-xs text-gray-400 mt-0.5">
                Polygon area ({{ geofence.points?.length || 0 }} points)
              </p>
            </div>
          </div>

          <button 
            @click="deleteGeofence(geofence.id)"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 outline-none"
            title="Delete Geofence"
          >
            <i class="fa-solid fa-trash-can"></i>
          </button>
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