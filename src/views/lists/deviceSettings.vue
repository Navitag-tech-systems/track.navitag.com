<script setup>
import { ref, computed, onMounted, watch} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { useDevicesStore } from '@/stores/devices.js';
import { useUserStore } from '@/stores/user.js';
import { request } from '@/utils/http.js';
import { categoryMapping, baseUrl } from '@/utils/variables';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();
const userStore = useUserStore();

const deviceId = route.params.id;

// Get the device from the store
const device = computed(() => deviceStore.devices[deviceId]);

const name = ref('');
const category = ref('');
const loading = ref(false);
const errorMsg = ref('');
const successMsg = ref('');

const isActive = ref(null);

// Categories supported by your Leaflet component


onMounted(() => {
  if (device.value) {
    name.value = device.value.name || '';
    category.value = device.value.category;
    isActive.value = !device.value.disabled
    deviceStore.fetchDeviceExpirations();
  } else {
    errorMsg.value = "Device not found.";
  }
});


async function openTopUp() {
  const url = `https://www.navitag.com/top-up/${device.value.uniqueId}`
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url })
  } else {
    window.open(url, '_blank')
  }
}

async function toggleDevice (mode = true){
  const ispState = await request.send({
    url: mode ? `${baseUrl}/device/enable` : `${baseUrl}/device/disable`,
    method: 'POST',
    data: { imei: device.value.uniqueId },
    token: userStore.idToken
  });
  return ispState
}

const saveDevice = async () => {
  if (!name.value.trim()) {
    errorMsg.value = 'Device name is required.';
    return;
  }
  
  loading.value = true;
  errorMsg.value = '';
  successMsg.value = '';

  try {
    // Traccar expects the full device object on PUT
    const updatedDevice = {
      "id": deviceId,
      "name": name.value.trim(),
      "uniqueId": device.value.uniqueId,
      //"status": "string",
      "disabled": !isActive.value,
      //"lastUpdate": "2019-08-24T14:15:22Z",
      //"positionId": 0,
      "groupId": device.value.groupId,
      "phone": device.value.phone,
      "model": device.value.model,
      "contact": device.value.contact,
      "category": category.value,
      "attributes": device.value.attributes
    }

    const update = await request.send({
      url: `https://${userStore.server_url}/api/devices/${deviceId}`,
      method: 'PUT',
      isTraccar: true,
      data: updatedDevice,
    });

    if(update){
      deviceStore.devices[deviceId] = update
      const catObj = categoryMapping.find(category => category.server === update.category)

      const newMarker = {
          id: deviceId, 
          latlon: deviceStore.deviceMarkers[deviceId].latlon,
          bearing: deviceStore.deviceMarkers[deviceId].bearing,
          color: deviceStore.deviceMarkers[deviceId].color,
          label: update.name,
          type: catObj.map
        };

        //lgoic not working to replace old marker with new marker
      delete deviceStore.deviceMarkers[deviceId]
      deviceStore.deviceMarkers[deviceId] = newMarker
      //deviceStore.updatedDevice = newMarker
      router.push("/")
    } else {
      userStore.error= true
    }

  } catch (err) {
    console.error('Update device error:', err);
    errorMsg.value = err.message || 'Failed to update device settings.';
  } finally {
    loading.value = false;
  }
};

watch(isActive, async (nv, ov) => {
  if(ov === null) {
    //skip
  } else {
    loading.value = true;
    toggleDevice(nv).then( (res) =>{
      //save to tracar
      saveDevice()
    }).catch((e) => {
      //do not save to traccar
      loading.value = false
    })
    

  }
})
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
      <h1 class="text-lg font-bold text-gray-800">Edit Device</h1>
    </div>

    <div class="p-4 space-y-6 max-w-md mx-auto w-full pb-safe-bottom">
      
      <div v-if="!device" class="text-center text-gray-500 py-10">
        <p>Loading device data...</p>
      </div>

      <div v-else class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <form @submit.prevent="saveDevice" class="space-y-5">

          <h2 class="text-lg font-bold text-gray-800">Labeling</h2>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Device Name</label>
            <div class="relative">
              <i class="fa-solid fa-tag absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input 
                v-model="name"
                type="text" 
                placeholder="e.g. Work Truck, Personal Car" 
                class="w-full pl-11 pr-4 py-3.5 bg-surface border border-gray-200 rounded-xl text-sm font-bold text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Map Icon (Category)</label>
            <div class="grid grid-cols-4 gap-3">
              <div 
                v-for="cat in categoryMapping" 
                :key="cat.server"
                @click="category = cat.server"
                class="flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all active:scale-95"
                :class="category === cat.server ? 'bg-brand-light border-brand text-brand shadow-sm' : 'bg-surface border-gray-200 text-gray-500 hover:bg-gray-100'"
              >
                <i :class="`fa-solid ${cat.icon} text-xl mb-1.5`"></i>
                <span class="text-[9px] font-bold uppercase tracking-wider text-center line-clamp-1">{{ cat.map }}</span>
              </div>
            </div>
          </div>

          <div v-if="errorMsg" class="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2">
            <i class="fa-solid fa-circle-exclamation"></i>
            {{ errorMsg }}
          </div>
          
          <div v-if="successMsg" class="bg-green-50 text-green-600 text-sm p-3 rounded-xl border border-green-100 flex items-center gap-2">
            <i class="fa-solid fa-circle-check"></i>
            {{ successMsg }}
          </div>

          <button 
            type="submit" 
            :disabled="loading"
            class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 outline-none mt-4"
          >
            <i v-if="loading" class="fa-solid fa-circle-notch fa-spin"></i>
            {{ loading ? 'Saving...' : 'Save Changes' }}
          </button>
        </form>
      </div>

      <div v-if="device" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <h2 class="text-lg font-bold text-gray-800">Status</h2>

        <div class="p-4 border rounded-lg">
          <label
            class="relative flex items-center justify-between w-full"
            :class="device.actionable === false ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
          >
            <input
              type="checkbox"
              v-model="isActive"
              class="sr-only peer"
              :disabled="loading || device.actionable === false"
            >

            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-light rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
            <span class="text-md font-medium text-gray-900">
              {{ isActive ? 'Active' : 'Disabled' }}
            </span>
          </label>
          <p v-if="device.actionable === false" class="text-xs text-gray-500 mt-2">
            This device cannot be toggled at this time.
          </p>
        </div>

        <div class="flex items-center justify-between p-4 border rounded-lg">
          <span class="text-sm text-gray-500">Plan</span>
          <span class="text-sm font-bold text-gray-800">{{ device.plan_level || 'N/A' }}</span>
        </div>

        <div class="flex items-center justify-between p-4 border rounded-lg">
          <span class="text-sm text-gray-500">Expiration</span>
          <span class="text-sm font-bold" :class="device.expiration ? 'text-gray-800' : 'text-red-500'">{{ device.expiration ? new Date(device.expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A' }}</span>
        </div>

        <button
          @click="openTopUp"
          class="w-full bg-accent hover:bg-accent/90 text-white font-bold py-3 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <i class="fa-solid fa-bolt"></i>
          Top Up
        </button>
      </div>

    </div>
  </div>
</template>