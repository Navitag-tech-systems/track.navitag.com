<script setup>
import { ref } from 'vue';
import { useUserStore } from '@/stores/user';

import { supportedProviders, getErrorMessage, signInWithEmailAndPassword } from '@/utils/auth';

const email = ref('');
const password = ref('');
const errorMsg = ref('');
const loading = ref(false);
const userStore = useUserStore()
//const router = useRouter();

// Email Login
const handleLogin = async () => {
  loading.value = true;
  errorMsg.value = 'log: starting login';
  try {
    let user = await signInWithEmailAndPassword(email.value, password.value);

    errorMsg.value = 'log: ' + user.user.uid;
  } catch (e) {
    errorMsg.value = getErrorMessage(e);
  } finally {
    loading.value = false;
  }
};

// Provider Login (Google/Facebook/Apple)
const handleProviderLogin = async (providerHandler) => {
  loading.value = true;
  errorMsg.value = 'log: starting login';
  try {
    let creds = await providerHandler();
    console.log(creds)
    errorMsg.value = 'log: '+ creds.user.uid;
    //router.replace('/');
  } catch (e) {
    errorMsg.value = "Sign in failed: " + e.message;
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50 pt-safe-top">
    <div class="w-full max-w-sm bg-white p-6 rounded-lg shadow-md">
      <h1 class="text-2xl font-bold mb-3 text-center text-gray-800">Welcome Back</h1>

      <div v-show="userStore.countryCode !== null" class="text-center text-gray-500 mb-3 font-semibold">Country Server: {{ userStore.countryCode }}</div>

      <form @submit.prevent="handleLogin" class="mt-4">
        <input v-model="email" type="email" placeholder="Email" required class="w-full border p-2 rounded mb-3 focus:ring-2 focus:ring-blue-500 outline-none" />
        <div class="mb-4">
          <input v-model="password" type="password" placeholder="Password" required class="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
          <div class="text-right mt-1">
            <RouterLink to="/forgot-password" class="text-xs text-blue-600 hover:underline">Forgot password?</RouterLink>
          </div>
        </div>
        
        <button type="submit" :disabled="loading" class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-2 px-4 rounded transition disabled:opacity-50">
          {{ loading ? 'Loading...' : 'Sign In' }}
        </button>
      </form>

      <p v-if="errorMsg" class="text-red-500 mt-4 text-center text-sm">{{ errorMsg }}</p>

      <div class="mt-6 text-center text-sm text-gray-600">
        Don't have an account? 
        <RouterLink to="/signup" class="text-blue-600 hover:underline">Sign Up</RouterLink>
      </div>

      <div class="relative flex py-2 items-center">
        <div class="flex-grow border-t border-gray-300"></div>
        <span class="flex-shrink mx-4 text-gray-400 text-sm">Or Login With</span>
        <div class="flex-grow border-t border-gray-300"></div>
      </div>

      <div class="space-y-3 mb-6">
        <button 
          v-for="p in supportedProviders" 
          :key="p.id"
          @click="handleProviderLogin(p.handler)"
          :class="`${p.color} w-full text-white font-semibold py-2 px-4 rounded flex items-center justify-center transition hover:opacity-90`"
          :disabled="loading"
        >
          <i :class="`${p.icon} mr-2`"></i>
          Sign in with {{ p.name }}
        </button>
      </div>
    </div>
  </div>
</template>