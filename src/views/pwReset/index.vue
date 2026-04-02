<script setup>
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { getErrorMessage, sendResetPasswordEmail } from '@/utils/auth';
import { getPlatformInfo } from '@/utils/variables';

const email = ref('');
const errorMsg = ref('');
const loading = ref(false);
const sent = ref(false);

const { isNative } = getPlatformInfo();

const actionCodeSettings = {
  url: isNative
    ? 'https://auth.navitag.com/firebase/reset-complete'
    : 'https://track.navitag.com/login',
  handleCodeInApp: false,
};

const handleReset = async () => {
  loading.value = true;
  errorMsg.value = '';

  try {
    await sendResetPasswordEmail({ email: email.value, actionCodeSettings });
    sent.value = true;
  } catch (e) {
    errorMsg.value = getErrorMessage(e);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col items-center justify-center flex-1 p-4 bg-gray-50">
    <div class="w-full max-w-sm bg-white p-6 rounded-lg shadow-md">

      <div v-if="sent" class="text-center">
        <i class="fa-solid fa-circle-check text-4xl text-green-500 mb-4"></i>
        <h1 class="text-xl font-bold text-gray-800 mb-2">Check your inbox</h1>
        <p class="text-sm text-gray-500 leading-relaxed mb-6">
          We've sent a password reset link to <span class="font-semibold text-gray-700">{{ email }}</span>. Follow the link in the email to set your new password.
        </p>
        <RouterLink to="/login" class="text-blue-600 hover:underline text-sm">Back to Login</RouterLink>
      </div>

      <div v-else>
        <h1 class="text-2xl font-bold mb-2 text-center text-gray-800">Reset Password</h1>
        <p class="text-gray-500 text-sm mb-6 text-center">Enter your email to receive reset instructions.</p>

        <form @submit.prevent="handleReset">
          <input
            v-model="email"
            type="email"
            placeholder="Enter your email"
            required
            class="w-full border p-1 text-sm rounded mb-4 focus:ring-2 focus:ring-blue-500 outline-none"
          />

          <button type="submit" :disabled="loading" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 text-sm rounded transition disabled:opacity-50 cursor-pointer">
            {{ loading ? 'Sending...' : 'Send Reset Link' }}
          </button>
        </form>

        <p v-if="errorMsg" class="text-red-500 mt-4 text-center text-sm">{{ errorMsg }}</p>

        <div class="mt-6 text-center text-sm">
          <RouterLink to="/login" class="text-blue-600 hover:underline">Back to Login</RouterLink>
        </div>
      </div>

    </div>
  </div>
</template>
