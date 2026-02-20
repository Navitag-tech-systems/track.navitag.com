<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { baseUrl } from '@/utils/variables';
import ky from 'ky';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const imei = route.params.imei;
const deviceName = ref('');
const loading = ref(false);
const errorMsg = ref('');

const linkDeviceToAccount = async (skipActivation = false) => {
  if (!deviceName.value || deviceName.value.trim() === '') {
    errorMsg.value = 'Please enter a name for your tracker.';
    return;
  }

  loading.value = true;
  errorMsg.value = '';

  try {
    const response = await ky.post(`${baseUrl}/user/link-device`, {
      json: {
        imei: imei,
        name: deviceName.value.trim()
      },
      headers: {
        Authorization: `Bearer ${userStore.idToken}`
      }
    }).json();

    if (response.status === 'success') {
      // Route based on whether the user chose to skip activation
      if (skipActivation) {
        router.push(`/linkdevice/success?activated=false`);
      } else {
        router.push(`/linkdevice/enable/${imei}`);
      }
    } else {
      throw new Error(response.message || 'Unknown error occurred.');
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
  <div class="flex flex-col min-h-screen bg-gray-50 pt-safe-top">
    <div class="bg-white p-4 shadow-sm flex items-center">
      <button @click="router.back()" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Name Your Tracker</h1>
    </div>

    <div class="flex-1 flex flex-col p-6 text-center mt-4">
      <div class="w-32 h-32 bg-blue-100 rounded-full flex items-center justify-center mb-6 shadow-inner mx-auto">
        <i class="fa-solid fa-satellite-dish text-5xl text-blue-600"></i>
      </div>
      
      <h2 class="text-2xl font-bold text-gray-800 mb-2">Device Found</h2>
      <p class="text-gray-500 mb-8 text-sm">
        IMEI: <span class="font-mono text-gray-800 font-semibold">{{ imei }}</span>
      </p>

      <div class="text-left w-full max-w-sm mx-auto">
        <label class="block text-sm font-medium text-gray-700 mb-1">Tracker Name</label>
        <input 
          v-model="deviceName" 
          type="text" 
          placeholder="e.g. My Car, Pet Collar, Backpack" 
          required 
          class="w-full border p-3 text-sm rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-2"
        />
        <p class="text-[11px] text-gray-400 italic">Give your tracker a recognizable name.</p>
        
        <p v-if="errorMsg" class="text-red-500 mt-2 text-sm">{{ errorMsg }}</p>
      </div>
    </div>

    <div class="p-6 bg-white shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] pb-safe-bottom">
      <button 
        @click="linkDeviceToAccount(false)" 
        :disabled="loading"
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center transition cursor-pointer text-lg shadow-md active:scale-[0.98] disabled:opacity-50"
      >
        <i v-if="loading" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
        {{ loading ? 'Linking...' : 'Link & Activate SIM' }}
      </button>

      <button 
        @click="linkDeviceToAccount(true)"
        :disabled="loading"
        class="w-full mt-4 text-sm text-gray-500 font-semibold hover:text-gray-800 cursor-pointer disabled:opacity-50 transition-colors"
      >
        Link only (Skip Activation)
      </button>
    </div>
  </div>
</template>