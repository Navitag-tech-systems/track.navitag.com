<script setup>
import { ref } from 'vue';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/firebase';
import { getErrorMessage } from '@/utils/auth';

const email = ref('');
const message = ref('');
const errorMsg = ref('');
const loading = ref(false);

const handleReset = async () => {
  loading.value = true;
  message.value = '';
  errorMsg.value = '';

  const actionCodeSettings = {
    // 1. Point to your hosted PWA URL or localhost for dev
    // IMPORTANT: You must add this URL to "Authorized Domains" in Firebase Console -> Auth -> Settings
    url: `${window.location.origin}/auth/action`, 
    handleCodeInApp: true,
  };

  try {
    // 2. Pass settings as the second argument
    await sendPasswordResetEmail(auth, email.value, actionCodeSettings);
    message.value = "Password reset link sent! Check your inbox.";
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
      <h1 class="text-2xl font-bold mb-2 text-center text-gray-800">Reset Password</h1>
      <p class="text-gray-500 text-sm mb-6 text-center">Enter your email to receive reset instructions.</p>
      
      <form @submit.prevent="handleReset">
        <input 
          v-model="email" 
          type="email" 
          placeholder="Enter your email" 
          required
          class="w-full border p-2 rounded mb-4 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        
        <button type="submit" :disabled="loading" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition disabled:opacity-50">
          {{ loading ? 'Sending...' : 'Send Reset Link' }}
        </button>
      </form>

      <p v-if="message" class="text-green-600 mt-4 text-center text-sm bg-green-50 p-2 rounded">{{ message }}</p>
      <p v-if="errorMsg" class="text-red-500 mt-4 text-center text-sm">{{ errorMsg }}</p>

      <div class="mt-6 text-center text-sm">
        <RouterLink to="/login" class="text-blue-600 hover:underline">Back to Login</RouterLink>
      </div>
    </div>
  </div>
</template>