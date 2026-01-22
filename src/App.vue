<script setup>
import { useUserStore } from '@/stores/user';
import { RouterView } from 'vue-router';

const userStore = useUserStore();
</script>

<template>
  <div class="fixed top-0 left-0 right-0 h-safe-top bg-blue-500 z-50"></div>

  <div v-if="userStore.loading" class="flex flex-col items-center justify-center h-screen bg-gray-100">
    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
    <p class="text-gray-500 text-sm">Navitag GPS tracking</p>
  </div>

  <RouterView v-else />
</template>

<style>
/* Global resets handled by Tailwind, but ensuring full height is good for mobile */
html, body, #app {
  height: 100%;
}
</style>