<script setup>
import { useRouter } from 'vue-router';

const router = useRouter();

const options = [
  {
    id: 'device',
    title: 'Link New Tracker',
    description: 'Add and configure a new GPS device to your account.',
    icon: 'fa-solid fa-satellite-dish',
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    route: '/linkdevice/start'
  },
  {
    id: 'geofence',
    title: 'Create Geofence',
    description: 'Draw a virtual boundary on the map to get entry/exit alerts.',
    icon: 'fa-solid fa-draw-polygon',
    color: 'text-green-500',
    bg: 'bg-green-50',
    route: '/addgeo'
  }
];

const navigateTo = (route) => {
  router.push(route);
};
</script>

<template>
  <div class="flex flex-col min-h-full bg-gray-50">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200 p-4 safe-top">
      <h1 class="text-xl font-bold text-gray-800">Add New</h1>
      <p class="text-sm text-gray-500 mt-1">What would you like to create?</p>
    </div>

    <div class="p-4 space-y-4 mt-2">
      
      <button 
        v-for="option in options" 
        :key="option.id"
        @click="navigateTo(option.route)"
        class="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center text-left transition-all hover:shadow-md hover:border-blue-100 active:scale-[0.98] outline-none cursor-pointer group"
      >
        <div :class="[option.bg, option.color, 'w-14 h-14 rounded-full flex items-center justify-center text-2xl shrink-0 transition-transform group-hover:scale-110']">
          <i :class="option.icon"></i>
        </div>
        
        <div class="ml-4 flex-1">
          <h2 class="text-lg font-bold text-gray-800 mb-0.5">{{ option.title }}</h2>
          <p class="text-sm text-gray-500 leading-snug pr-2">{{ option.description }}</p>
        </div>

        <div class="text-gray-300 group-hover:text-blue-500 transition-colors">
          <i class="fa-solid fa-chevron-right"></i>
        </div>
      </button>

    </div>
  </div>
</template>

<style scoped>
/* Optional: Prevents tap highlight on mobile devices */
button {
  -webkit-tap-highlight-color: transparent;
}
</style>