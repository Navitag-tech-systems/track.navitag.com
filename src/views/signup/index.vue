<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/firebase';
import { getErrorMessage } from '@/utils/auth';

const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const errorMsg = ref('');
const loading = ref(false);
const router = useRouter();

const handleSignup = async () => {
  if (password.value !== confirmPassword.value) {
    errorMsg.value = "Passwords do not match.";
    return;
  }

  loading.value = true;
  errorMsg.value = '';

  try {
    await createUserWithEmailAndPassword(auth, email.value, password.value);
    router.push('/');
  } catch (e) {
    errorMsg.value = getErrorMessage(e);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50 pt-safe-top">
    <div class="w-full max-w-sm bg-white p-6 rounded-lg shadow-md">
      <h1 class="text-2xl font-bold mb-6 text-center text-gray-800">Create Account</h1>
      
      <form @submit.prevent="handleSignup">
        <div class="mb-3">
          <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input v-model="email" type="email" required class="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        
        <div class="mb-3">
          <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input v-model="password" type="password" required class="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>

        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
          <input v-model="confirmPassword" type="password" required class="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        
        <button type="submit" :disabled="loading" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition disabled:opacity-50">
          {{ loading ? 'Creating Account...' : 'Sign Up' }}
        </button>
      </form>

      <p v-if="errorMsg" class="text-red-500 mt-4 text-center text-sm">{{ errorMsg }}</p>

      <div class="mt-6 text-center text-sm text-gray-600">
        Already have an account? 
        <RouterLink to="/login" class="text-blue-600 hover:underline">Log In</RouterLink>
      </div>
    </div>
  </div>
</template>