<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { baseUrl } from '@/utils/variables';
import { request } from '@/utils/http';


const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const imei = route.params.imei;
const loading = ref(false);

const enableDevice = async () => {
  loading.value = true;

  try {
    const data = await request.send({
      url: `${baseUrl}/device/enable`,
      method: 'POST',    
      data: { imei: imei },
      token: userStore.idToken
    });
    // add error handling for data error
    //change data in traccar server from disable to enabled
    const serverDeviceArr = await request.send({
      url: `https://${userStore.server_url}/api/devices?id=${data.server_ref}`,
      isTraccar: true,
    });
    let serverDevice = serverDeviceArr[0]
    serverDevice.disabled = false
    console.log(serverDevice)
    const serverUpdate = await request.send({
      url: `https://${userStore.server_url}/api/devices/${serverDevice.id}`,
      method: 'PUT',
      data: serverDevice,
    });

    // Route to success page on success
    router.push('/linkdevice/success?activated=true');
  } catch (error) {
    console.error('Failed to enable device:', error);
    
    router.push({ 
      path: '/linkdevice/error', 
      query: { message: error.message || 'Failed to activate the device SIM connection.' } 
    });
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col bg-gray-50 flex-1">
    <div class="bg-white p-4 shadow-sm flex items-center">
      <button @click="router.back()" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Activate SIM</h1>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div class="w-32 h-32 bg-green-100 rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto">
        <i class="fa-solid fa-sim-card text-5xl text-green-600"></i>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-800 mb-2">Enable Connection</h2>
      <p class="text-gray-600 mb-8 max-w-sm text-sm">
        Your device is linked. You now need to activate the cellular connection so it can transmit GPS data.
      </p>
    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] pb-safe-bottom">
      <button 
        @click="enableDevice" 
        :disabled="loading"
        class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98] disabled:opacity-50"
      >
        <i v-if="loading" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
        {{ loading ? 'Activating...' : 'Activate Device' }}
      </button>

      <button 
        @click="router.push('/linkdevice/success?activated=false')"
        :disabled="loading"
        class="w-full my-4 text-sm text-gray-500 font-semibold hover:text-gray-800 cursor-pointer disabled:opacity-50 transition-colors"
      >
        Skip for now
      </button>
    </div>
  </div>
</template>