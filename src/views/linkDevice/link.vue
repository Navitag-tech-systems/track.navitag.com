<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { baseUrl } from '@/utils/variables';
import { request } from '@/utils/http';
import InlineLoader from '@/components/InlineLoader.vue';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const imei = route.params.imei;
const deviceName = ref('');
const loading = ref(false);
const errorMsg = ref('');

const linkDeviceToAccount = async () => {
  if (!deviceName.value || deviceName.value.trim() === '') {
    errorMsg.value = 'Please enter a name for your tracker.';
    return;
  }

  loading.value = true;
  errorMsg.value = '';

  try {
    const data = await request.send({
      url: `${baseUrl}/user/link-device`,
      method: 'POST',    
      data: {
          imei: imei,
          name: deviceName.value.trim()
        },
      token: userStore.idToken
    });

    if (data.status === 'success') {
      // /user/link-device is the whole activation: it sets Traccar
      // disabled=false, joins the owner group, enables the SIM (with rollback
      // on failure) and sets expiration from preloaded_months. There is no
      // separate activation step left to route through.
      router.push('/linkdevice/success');
    } else {
      throw new Error(data.error || data.message || 'Unknown error occurred.');
    }
  } catch (error) {
    console.error('Failed to link device:', error);
    router.push({ 
      path: '/linkdevice/error', 
      query: { message: error.message || 'Failed to connect to the server to link this device.' } 
    });
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col flex-1 bg-surface">
    <div class="bg-white p-4 shadow-sm flex items-center">
      <button @click="router.back()" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Add Device</h1>
    </div>

    <div class="flex-1 flex flex-col p-6 text-center mt-4">
      <div class="w-32 h-32 bg-brand-light rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto">
        <i class="fa-solid fa-satellite-dish text-5xl text-brand"></i>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-800 mb-2">Device Found</h2>
      <p class="text-gray-500 mb-8 text-sm">
        IMEI: <span class="font-mono text-gray-800 font-semibold">{{ imei }}</span>
      </p>

      <div class="text-left w-full max-w-sm mx-auto">
        <label class="block text-sm font-medium text-gray-700 mb-1">Device Name</label>
        <input 
          v-model="deviceName" 
          type="text" 
          placeholder="e.g. My Car, Pet Collar, Backpack" 
          required 
          class="w-full border p-3 text-sm rounded-xl focus:ring-2 focus:ring-brand outline-none mb-2"
        />
        
        <p v-if="errorMsg" class="text-red-500 mt-2 text-sm">{{ errorMsg }}</p>
      </div>
    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)]">
      <button 
        @click="linkDeviceToAccount(false)" 
        :disabled="loading"
        class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98] disabled:opacity-50"
      >
        <InlineLoader v-if="loading" class="mr-2" />
        {{ loading ? 'Linking…' : 'Link Device' }}
      </button>
    </div>
  </div>
</template>