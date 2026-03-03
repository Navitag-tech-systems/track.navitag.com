<script setup>
import { ref, computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { useUserStore } from '@/stores/user.js';
import { request } from '@/utils/http';

const router = useRouter();
const deviceStore = useDevicesStore();
const userStore = useUserStore();

// Modal State
const showDeleteModal = ref(false);
const geofenceToDelete = ref(null);
const isDeleting = ref(false);

// Convert the reactive object into an array for the v-for loop
const geofencesList = computed(() => {
  return Object.entries(deviceStore.geofences).map(([id, data]) => ({
    id,
    ...data
  }));
});

// Step 1: Open the modal
const confirmDelete = (id) => {
  geofenceToDelete.value = id;
  showDeleteModal.value = true;
};

// Helper: The actual delete request
const sendDeleteRequest = async (id) => {
  return await 
  
  
  CapacitorHttp.delete({
    url: `https://${userStore.server_url}/api/geofences/${id}`,
    withCredentials: true // Crucial: sends the JSESSIONID cookie
  });
};

// Step 2: Perform the actual delete via API with 401 Retry Logic
const performDelete = async () => {
  if (!geofenceToDelete.value) return;
  
  isDeleting.value = true;
  const id = geofenceToDelete.value;

  try {
    // Attempt 1
    let response = await request.send({
      url: `https://${userStore.server_url}/api/geofences/${id}`,
      isTraccar: true
    })

    
    if (response) {
      delete deviceStore.geofences[id];
      // Close modal
      showDeleteModal.value = false;
      geofenceToDelete.value = null;
    
    } else {
      console.error('Delete failed with status:', response.status);
      alert('Failed to delete geofence. Please restart the app or log in again.');
    }
  } catch (error) {
    console.error('Error deleting geofence:', error);
    alert('An error occurred while deleting the geofence.');
  } finally {
    isDeleting.value = false;
  }
};

const editGeofence = (id) => {
  console.log('click')
  router.push(`/editgeo/geo-${id}/${id}`);
};
</script>

<template>
  <div class="flex flex-col min-h-full bg-gray-50">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200">
      <div class="p-4">
        <div class="flex justify-between">
          <h1 class="text-xl font-bold text-gray-800 mb-3">Overview</h1>
          <RouterLink to="/addgeo" class="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0" >
            <i class="fa-solid fa-plus"></i>
          </RouterLink>
        </div>
        
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

    <div class="p-4 space-y-4 relative z-10">
      
      <div v-if="geofencesList.length === 0" class="text-center text-gray-500 py-10 bg-white rounded-xl border border-gray-200 shadow-sm">
        <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fa-solid fa-draw-polygon text-2xl text-gray-400"></i>
        </div>
        <h3 class="font-bold text-gray-800 mb-1">No Geofences</h3>
        <p class="text-sm px-4 mb-4">You haven't set up any geofences yet. Draw areas on the map to receive alerts when trackers enter or exit.</p>
        <RouterLink to="/addgeo">
          <button class="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-100 transition cursor-pointer">
            Create Geofence
          </button>
        </RouterLink>
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
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button 
              @click="editGeofence(geofence.id)"
              class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0 outline-none"
              title="Edit Geofence"
            >
              <i class="fa-solid fa-pen-to-square"></i>
            </button>

            <button 
              @click="confirmDelete(geofence.id)"
              class="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 outline-none"
              title="Delete Geofence"
            >
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>

        <RouterLink to="/addgeo" class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex justify-center items-center transition-all hover:shadow-md">
          <div class="flex items-center gap-4">

            <div class="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
              <i class="fa-solid fa-plus"></i>
            </div>
            <div>
              <h3 class="font-bold text-gray-800 leading-tight">NEW GEOFENCE</h3>
            </div>
          </div>
        </RouterLink>
      </div>
    </div>

    <teleport to="body">
      <div v-if="showDeleteModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm transition-opacity">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-xs overflow-hidden animate-scale-up">
          <div class="p-6 text-center">
            
            <div class="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i class="fa-solid fa-trash-can text-red-600 text-xl"></i>
            </div>
            
            <h3 class="text-lg font-bold text-gray-800 mb-2">Delete Geofence?</h3>
            <p class="text-sm text-gray-500 mb-6 leading-relaxed">
              Are you sure you want to delete this geofence? This action cannot be undone.
            </p>
            
            <div class="grid grid-cols-2 gap-3">
              <button 
                @click="showDeleteModal = false"
                class="py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-sm transition-colors outline-none"
              >
                Cancel
              </button>
              
              <button 
                @click="performDelete"
                :disabled="isDeleting"
                class="py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 outline-none disabled:opacity-70"
              >
                <i v-if="isDeleting" class="fa-solid fa-circle-notch fa-spin"></i>
                {{ isDeleting ? 'Deleting...' : 'Delete' }}
              </button>
            </div>

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