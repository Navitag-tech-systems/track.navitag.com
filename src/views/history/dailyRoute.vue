<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import { baseUrl } from '@/utils/variables';
import { request } from '@/utils/http';
import { hasScope } from '@/utils/scopes';

import VT100MapProcessor from '@/utils/reportProcessor.js';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const deviceStore = useDevicesStore();

const mapProcessor = new VT100MapProcessor();

const loading = ref(true);
const errorMsg = ref('');          // retryable failure (network / 400 / 404 / 5xx)
const unauthorizedMsg = ref('');   // non-retryable auth failure (401 / 403)
const positions = ref([]);
const timelineItems = ref([]);

// Controls the collapsible state of the event log
const isTimelineOpen = ref(false); 

const imei = route.params.imei;
// Make date reactive so we can change it without a full page reload
const currentDate = ref(route.params.date);

// Find the device by IMEI to get plan_level
const device = computed(() => Object.values(deviceStore.devices).find(d => String(d.uniqueId) === String(imei)));
const planLevel = computed(() => (device.value?.plan_level || 'basic').toLowerCase());
const maxDays = computed(() => planLevel.value === 'pro' ? 90 : 31);

// Owners pass via OWNER_SENTINEL; shared devices need an explicit
// history:read grant in their /share/tome scope list.
const hasHistoryAccess = computed(() => hasScope(device.value, 'history:read'));

// --- DATE HELPER LOGIC ---
const getTodayString = () => {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
};

const getOldestAllowedDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - maxDays.value);
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
};

// Computed property to disable the "Next" button if viewing today's route
const isNextDisabled = computed(() => {
  return currentDate.value === getTodayString();
});

const isPrevDisabled = computed(() => {
  return currentDate.value <= getOldestAllowedDate();
});

const fetchHistory = async () => {
  loading.value = true;
  errorMsg.value = '';
  unauthorizedMsg.value = '';

  if (!hasHistoryAccess.value) {
    loading.value = false;
    unauthorizedMsg.value = 'This device was shared without history access. Ask the owner to grant the History scope.';
    positions.value = [];
    timelineItems.value = [];
    Object.assign(deviceStore.activeRoute, { line: [], markers: {} });
    return;
  }

  try {
    // Send the user's IANA timezone so the backend resolves "today" against
    // their actual local zone instead of UTC. Without this, a Manila morning
    // (before UTC midnight rolls over) gets a "Future dates are not allowed"
    // error when picking today.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await request.send({
      url: `${baseUrl}/history/positions`,
      method: 'POST',
      data: {
        date: currentDate.value,
        imei: Number(imei),
        ...(tz ? { timezone: tz } : {}),
      },
      token: userStore.idToken
    });

    positions.value = response || [];
    
    if (positions.value.length > 0) {
      const processedData = mapProcessor.generateMapData(positions.value);

      timelineItems.value = positions.value.filter((pos, index) => {
        const markerId = `marker_${pos.id || index}`;
        return !!processedData.markers[markerId];
      }).map((pos, index) => {
        const markerId = `marker_${pos.id || index}`;
        const markerData = processedData.markers[markerId];
        const pointEvents = processedData.events.filter(e => e.markerId === markerId);

        return {
          ...pos,
          markerId, 
          markerData,
          events: pointEvents
        };
      });

      Object.assign(deviceStore.activeRoute, {
        line: processedData.line,
        markers: processedData.markers
      })

      // Plot new report and replace route back to 'route' mode
      //router.replace({ name: 'history-report', params: { ...route.params, mode: 'route', date: currentDate.value } });
    } else {
      // Clear map if no positions found for the new date
      deviceStore.activeRoute = { line: [], markers: {} };
      //router.replace({ name: 'history-report', params: { ...route.params, mode: 'route', date: currentDate.value } });
    }

  } catch (err) {
    console.error('Error fetching history:', err);
    // http.js throws Error('HTTP <status>'); pull the status so we can tell an
    // authorization failure (no retry) apart from a transient error (retryable).
    const status = Number(String(err?.message || '').match(/\b(401|403)\b/)?.[1]);
    if (status === 401) {
      unauthorizedMsg.value = 'Your session is no longer authorized. Please sign in again.';
    } else if (status === 403) {
      unauthorizedMsg.value = "You don't have permission to view this device's history.";
    } else {
      errorMsg.value = 'Failed to load history data. Please check your connection or try again.';
    }
  } finally {
    loading.value = false;
  }
};

// --- DATE NAVIGATION LOGIC ---
const changeDate = async (offset) => {
  Object.assign(deviceStore.activeRoute, { line: [], markers: {} })
  // Parse current date properly (assuming YYYY-MM-DD format)
  const [year, month, day] = currentDate.value.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);
  
  // Add or subtract days
  dateObj.setDate(dateObj.getDate() + offset);
  
  
  // Format back to YYYY-MM-DD
  const newDateStr = dateObj.getFullYear() + '-' + 
                     String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(dateObj.getDate()).padStart(2, '0');
                     
  currentDate.value = newDateStr;

  //router.replace({ name: 'history-report', params: { ...route.params, mode: 'track', date: currentDate.value } });
  // 2. Fetch new data (triggers loading spinner automatically)
  await fetchHistory();
};

const formatTime = (isoString) => {
  if (!isoString) return '--:--';
  const date = new Date(isoString);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

// --- INTERACTION LOGIC ---

// 1. User clicks an item in the list -> Update the global deviceSelected
const selectEvent = (markerId) => {
  deviceStore.deviceSelected = markerId; 
};

// 2. Map sets deviceSelected (via marker click) -> Auto-scroll list to the item
watch(() => deviceStore.deviceSelected, async (newdeviceSelected) => {
  if (newdeviceSelected && String(newdeviceSelected).startsWith('marker_')) {
    if (!isTimelineOpen.value) {
      isTimelineOpen.value = true;
    }
    
    await nextTick();
    
    const element = document.getElementById(`event-${newdeviceSelected}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
});

onMounted(() => {
  deviceStore.deviceSelected = null;
  fetchHistory();
});

onUnmounted(() => {
  Object.assign(deviceStore.activeRoute, { line: [], markers: {} })
  deviceStore.deviceSelected = null; 
});
</script>

<template>
  <div class="flex flex-col h-full relative z-10 pointer-events-none">
    
    <div class="pointer-events-auto absolute top-3 right-3">
      <button
        @click="router.back"
        class="w-9 h-9 flex items-center justify-center bg-white/95 backdrop-blur-sm text-red-500 hover:text-gray-800 hover:bg-gray-100 rounded-full shadow-sm border border-gray-200 transition-colors outline-none cursor-pointer"
      >
        <i class="fa-solid fa-xmark text-lg"></i>
      </button>
    </div>

    <div class="flex-1 min-h-[30vh]"></div>

    <div class="pointer-events-auto bg-surface rounded-t-3xl shadow-[0_-10px_20px_rgba(0,0,0,0.05)] border-t border-gray-200 flex flex-col max-h-[60vh]">
      <div class="p-4 overflow-y-auto pb-safe-bottom">
        
        <div class="flex justify-center items-center mb-2">
          <button
            @click="changeDate(-1)"
            :disabled="isPrevDisabled"
            class="text-xs font-bold p-2 rounded-lg transition-colors flex items-center"
            :class="isPrevDisabled ? 'text-gray-400 bg-gray-100 cursor-not-allowed opacity-60' : 'text-white bg-accent'"
          >
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          
          <span class="text-xs font-bold text-gray-700 mx-2">{{ currentDate }}</span>
          
          <button 
            @click="changeDate(1)" 
            :disabled="isNextDisabled"
            class="text-xs font-bold p-2 rounded-lg transition-colors flex items-center"
            :class="isNextDisabled ? 'text-gray-400 bg-gray-100 cursor-not-allowed opacity-60' : 'text-white bg-accent'"
          >
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>

        <div v-if="loading" class="flex flex-col items-center justify-center py-10 text-gray-400">
          <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-brand"></i>
          <p class="text-sm font-semibold">Generating report...</p>
        </div>

        <div v-else-if="unauthorizedMsg" class="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
          <i class="fa-solid fa-lock text-3xl text-amber-500 mb-3"></i>
          <h3 class="font-bold text-amber-800 mb-1">Unauthorized</h3>
          <p class="text-sm text-amber-700">{{ unauthorizedMsg }}</p>
        </div>

        <div v-else-if="errorMsg" class="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
          <i class="fa-solid fa-triangle-exclamation text-3xl text-red-500 mb-3"></i>
          <h3 class="font-bold text-red-800 mb-1">Report Failed</h3>
          <p class="text-sm text-red-600 mb-4">{{ errorMsg }}</p>
          <button @click="fetchHistory" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg transition-colors text-sm">
            Retry
          </button>
        </div>

        <div v-else class="space-y-4">

          <div v-if="positions.length === 0" class="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
            <div class="w-12 h-12 bg-surface rounded-full flex items-center justify-center mx-auto mb-3">
              <i class="fa-solid fa-route text-xl text-gray-400"></i>
            </div>
            <h3 class="font-bold text-gray-800 mb-1">No Data Available</h3>
            <p class="text-sm text-gray-500">No recorded positions on {{ currentDate }}.</p>
          </div>

          <div v-else class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col mb-3">
            
            <div 
              @click="isTimelineOpen = !isTimelineOpen" 
              class="p-3 border-b border-gray-100 bg-surface flex justify-between items-center text-gray-700 cursor-pointer select-none transition-colors hover:bg-gray-100"
            >
              <div class="flex items-center">
                <i class="fa-solid fa-clock-rotate-left mr-2 text-sm text-brand"></i>
                <h2 class="text-sm font-bold">Event Log</h2>
              </div>
              <i 
                class="fa-solid text-sm text-gray-400 transition-transform duration-300" 
                :class="isTimelineOpen ? 'fa-chevron-up' : 'fa-chevron-down'"
              ></i>
            </div>
            
            <div v-show="isTimelineOpen" class="divide-y divide-gray-100 overflow-y-auto max-h-[20vh] scroll-smooth relative">
              
              <div 
                v-for="(item, index) in timelineItems" 
                :key="index" 
                :id="`event-${item.markerId}`"
                @click="selectEvent(item.markerId)"
                class="p-2.5 flex items-start gap-2.5 transition-colors cursor-pointer border-l-2"
                :class="deviceStore.deviceSelected === item.markerId ? 'bg-brand-light/50 border-brand' : 'hover:bg-surface border-transparent'"
              >
                
                <div class="text-[10px] font-bold w-10 pt-0.5 text-right shrink-0 transition-colors"
                     :class="deviceStore.deviceSelected === item.markerId ? 'text-brand' : 'text-gray-400'">
                  {{ formatTime(item.fixTime || item.deviceTime) }}
                </div>
                
                <div class="mt-0.5 relative flex flex-col items-center shrink-0">
                  <div class="w-5 h-5 rounded-full flex items-center justify-center text-white shadow-sm z-10 transition-transform duration-200" 
                       :style="{ backgroundColor: item.markerData.color }"
                       :class="{'scale-125 ring-2 ring-brand-light ring-offset-1': deviceStore.deviceSelected === item.markerId}">
                    <i v-if="item.markerData.type === 'Start'" class="fa-solid fa-play text-[8px]"></i>
                    <i v-else-if="item.markerData.type === 'End'" class="fa-solid fa-flag-checkered text-[8px]"></i>
                    <i v-else-if="item.markerData.type === 'Waypoint'" class="fa-solid fa-location-dot text-[8px]"></i>
                    <i v-else class="fa-solid fa-bolt text-[8px]"></i>
                  </div>
                  <div v-if="index !== timelineItems.length - 1" class="w-[2px] bg-gray-100 absolute top-5 -bottom-3"></div>
                </div>

                <div class="flex-1 pb-1 min-w-0">
                  <div class="flex justify-between items-start">
                    <p class="text-xs font-bold truncate pr-2" :style="{ color: item.markerData.type !== 'Waypoint' ? item.markerData.color : '#374151' }">
                      {{ 
                        item.markerData.type === 'Waypoint' 
                          ? (item.speed > 0 ? 'Location Update' : 'Status Check') 
                          : item.markerData.type 
                      }}
                    </p>
                    <p class="text-[10px] font-semibold text-gray-400 whitespace-nowrap">
                      {{ item.speed ? Math.round(item.speed * 1.852) + ' km/h' : 'Stopped' }}
                    </p>
                  </div>
                  
                  <p class="text-[10px] truncate mt-0.5 transition-colors"
                     :class="deviceStore.deviceSelected === item.markerId ? 'text-gray-700' : 'text-gray-500'">
                    {{ item.address || `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>