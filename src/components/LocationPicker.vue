<script setup>
import { ref, onMounted } from 'vue';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

const isDesktop = ref(false);
const coords = ref(null);
const error = ref(null);

onMounted(() => {
  // Check if we are on a desktop browser
  // This detects Windows, Mac, and Linux as "desktop"
  const platform = Capacitor.getPlatform();
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileOS = /android|iphone|ipad|ipod/.test(userAgent);
  
  if (platform === 'web' && !isMobileOS) {
    isDesktop.value = true;
  }
});

const getLocation = async () => {
  if (isDesktop.value) {
    error.value = "GPS features are disabled on desktop browsers.";
    return;
  }

  try {
    const coordinates = await Geolocation.getCurrentPosition();
    coords.value = coordinates.coords;
  } catch (e) {
    error.value = "Location error: " + e.message;
  }
};
</script>

<template>
  <div class="p-4 border rounded-lg bg-white shadow-sm mb-4">
    <h3 class="font-bold mb-2">Device Location</h3>
    
    <div v-if="isDesktop" class="bg-gray-100 p-3 rounded text-center text-gray-500 text-sm">
      <i class="fa-solid fa-laptop mb-1 block"></i>
      GPS disabled on desktop
    </div>

    <button 
      v-else
      @click="getLocation" 
      class="bg-brand text-white px-4 py-2 rounded w-full flex items-center justify-center"
    >
      <i class="fa-solid fa-location-dot mr-2"></i> Get GPS
    </button>
    
    <div v-if="coords" class="mt-2 text-sm text-gray-600 bg-brand-light p-2 rounded">
      <p>Lat: {{ coords.latitude.toFixed(4) }}</p>
      <p>Lng: {{ coords.longitude.toFixed(4) }}</p>
    </div>
    <p v-if="error" class="text-red-500 text-xs mt-2">{{ error }}</p>
  </div>
</template>