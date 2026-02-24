<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user-backup';
import { useDevicesStore } from '@/stores/devices-backup';
import { baseUrl } from '@/utils/variables';
import ky from 'ky';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const deviceStore = useDevicesStore();

const loading = ref(true);
const errorMsg = ref('');
const positions = ref([]);

// Extract params from URL: /history/:imei/:date
const imei = route.params.imei;
const dateParam = route.params.date;

const fetchHistory = async () => {
  loading.value = true;
  errorMsg.value = '';

  try {
    const response = await ky.post(`https://${baseUrl}/history/positions`, {
      json: {
        date: dateParam,
        imei: Number(imei) 
      },
      credentials: 'include'
    }).json();

    positions.value = response || [];
    
    // --- DRAW ON MAP ---
    if (positions.value.length > 0) {
      const lineCoords = [];
      const mapMarkers = {};

      positions.value.forEach((pos, index) => {
        const latlon = [pos.latitude, pos.longitude];
        lineCoords.push(latlon);

        // Optional: Only create markers for Start, End, or Stops to prevent cluttering
        // Here we just mark the very first and very last point.
        if (index === 0) {
          mapMarkers['start'] = {
            latlon,
            type: 'pin',
            color: '#22c55e', // Green
            label: 'Start'
          };
        } else if (index === positions.value.length - 1) {
          mapMarkers['end'] = {
            latlon,
            type: 'car', // Or 'pin'
            color: '#ef4444', // Red
            bearing: pos.course || 0,
            label: 'End'
          };
        }
      });

      // Update the store, which instantly updates the map in App.vue!
      deviceStore.activeRoute = {
        line: lineCoords,
        markers: mapMarkers
      };
    }

  } catch (err) {
    console.error('Error fetching history:', err);
    errorMsg.value = 'Failed to load history data. Please check your connection or try again.';
  } finally {
    loading.value = false;
  }
};

const formatTime = (isoString) => {
  if (!isoString) return '--:--';
  const date = new Date(isoString);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

onMounted(() => {
  fetchHistory();
});

// Clean up the map route when leaving the view
onUnmounted(() => {
  deviceStore.activeRoute = { line: [], markers: {} };
});
</script>

<template>
  <div class="flex flex-col h-full relative z-10 pointer-events-none">
    
    <div class="pointer-events-auto bg-white/95 backdrop-blur-sm shadow-sm border-b border-gray-200 p-4 flex items-center safe-top">
      <button 
        @click="router.back()" 
        class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none"
      >
        <i class="fa-solid fa-arrow-left text-lg"></i>
      </button>
      <div>
        <h1 class="text-lg font-bold text-gray-800 leading-tight">History Report</h1>
        <p class="text-[11px] text-gray-500 font-medium">{{ dateParam }} • IMEI: {{ imei }}</p>
      </div>
    </div>

    <div class="flex-1 min-h-[30vh]"></div>

    <div class="pointer-events-auto bg-gray-50 rounded-t-3xl shadow-[0_-10px_20px_rgba(0,0,0,0.05)] border-t border-gray-200 flex flex-col max-h-[60vh]">
      
      <div class="w-full flex justify-center pt-3 pb-1 shrink-0">
        <div class="w-12 h-1.5 bg-gray-300 rounded-full"></div>
      </div>

      <div class="p-4 overflow-y-auto pb-safe-bottom">
        
        <div v-if="loading" class="flex flex-col items-center justify-center py-10 text-gray-400">
          <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-blue-500"></i>
          <p class="text-sm font-semibold">Generating report...</p>
        </div>

        <div v-else-if="errorMsg" class="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
          <i class="fa-solid fa-triangle-exclamation text-3xl text-red-500 mb-3"></i>
          <h3 class="font-bold text-red-800 mb-1">Report Failed</h3>
          <p class="text-sm text-red-600 mb-4">{{ errorMsg }}</p>
          <button @click="fetchHistory" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg transition-colors text-sm">
            Retry
          </button>
        </div>

        <div v-else-if="positions.length === 0" class="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
          <div class="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <i class="fa-solid fa-route text-xl text-gray-400"></i>
          </div>
          <h3 class="font-bold text-gray-800 mb-1">No Data Available</h3>
          <p class="text-sm text-gray-500">No recorded positions on {{ dateParam }}.</p>
        </div>

        <div v-else class="space-y-4">
          
          <div class="bg-blue-600 text-white rounded-2xl shadow-md p-5 flex justify-between items-center shrink-0">
            <div>
              <p class="text-blue-200 text-xs font-bold uppercase tracking-wider mb-1">Total Positions</p>
              <p class="text-3xl font-bold">{{ positions.length }}</p>
            </div>
            <div class="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center">
              <i class="fa-solid fa-map-location-dot text-xl"></i>
            </div>
          </div>

          <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div class="p-3 border-b border-gray-100 bg-gray-50 flex items-center text-gray-700">
              <i class="fa-solid fa-clock-rotate-left mr-2"></i>
              <h2 class="text-sm font-bold">Timeline</h2>
            </div>
            
            <div class="divide-y divide-gray-100">
              <div v-for="(pos, index) in positions" :key="index" class="p-3 flex items-start gap-3 hover:bg-gray-50 transition-colors">
                
                <div class="text-[11px] font-bold text-gray-500 w-12 pt-1">
                  {{ formatTime(pos.fixTime || pos.deviceTime) }}
                </div>
                
                <div class="mt-0.5">
                  <div class="w-6 h-6 rounded-full flex items-center justify-center" :class="pos.speed > 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'">
                    <i class="fa-solid text-[10px]" :class="pos.speed > 0 ? 'fa-play' : 'fa-stop'"></i>
                  </div>
                </div>

                <div class="flex-1">
                  <p class="text-sm font-bold text-gray-800">{{ pos.speed ? Math.round(pos.speed * 1.852) + ' km/h' : 'Stopped' }}</p>
                  <p class="text-xs text-gray-500 line-clamp-2 mt-0.5">{{ pos.address || `${pos.latitude}, ${pos.longitude}` }}</p>
                </div>

              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>