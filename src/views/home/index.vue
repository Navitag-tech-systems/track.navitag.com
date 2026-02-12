<script setup>
import { useUserStore } from '@/stores/user';


//import LocationPicker from '@/components/LocationPicker.vue';
//import BarcodeScanner from '@/components/BarcodeScanner.vue';

const userStore = useUserStore();

</script>

<template>

  <div class="p-4 pt-safe-top bg-gray-50 min-h-screen">
    <h1 class="text-2xl font-bold mb-4">Navitag Track</h1>
    <div class="mt-8 bg-white shadow rounded p-4 text-center">
      <p class="mb-4 text-sm text-gray-500">Account: {{ userStore.user?.email }}</p>
      <button @click="handleLogout" class="text-red-500 text-sm font-semibold">
        Sign Out
      </button>
    </div>
  </div>
</template>