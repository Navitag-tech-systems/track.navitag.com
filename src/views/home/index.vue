<script setup>
import { useUserStore } from '@/stores/user';
import { useRouter } from 'vue-router';
import { getAuth, signOut } from 'firebase/auth';

const userStore = useUserStore();
const router = useRouter();

const handleLogout = async () => {
  const auth = getAuth();
  await signOut(auth);
  router.replace('/login');
};
</script>

<template>
  <div class="p-4 pt-safe-top">
    <h1 class="text-2xl font-bold mb-4">Dashboard</h1>
    <div class="bg-white shadow rounded p-4">
      <p class="mb-4">Logged in as: <strong>{{ userStore.user?.email }}</strong></p>
      <button 
        @click="handleLogout" 
        class="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded"
      >
        Sign Out
      </button>
    </div>
  </div>
</template>