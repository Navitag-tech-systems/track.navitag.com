<script setup>
import { ref } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { signOut } from '@/utils/auth';

const userStore = useUserStore();
const email = ref('');
const loading = ref(false);
const errorMsg = ref('');
const success = ref(false);

const handleSubmit = async () => {
  const trimmed = email.value.trim();
  if (!trimmed) {
    errorMsg.value = 'Please enter your email address.';
    return;
  }

  loading.value = true;
  errorMsg.value = '';

  try {
    userStore.email = trimmed;
    // Do NOT set needsEmail = false — guards must stay active during backendSync.
    // clearUser() (triggered by authStateChange after token revocation) resets it.

    const synced = await userStore.backendSync();
    if (!synced) throw new Error('Failed to create account. Please try again.');

    // Backend updated Firebase email → refresh token is now revoked.
    // Show success message and let user click "Login Now" to proceed.
    success.value = true;
  } catch (e) {
    console.error('[Collect Email] Error:', e);
    errorMsg.value = e?.message || 'Failed to create account. Please try again.';
  } finally {
    loading.value = false;
  }
};

const handleLoginNow = async () => {
  await signOut();
};

const handleCancel = async () => {
  userStore.needsEmail = false;
  await signOut();
};
</script>

<template>
  <div class="flex flex-col items-center justify-center flex-1 p-4 bg-surface">
    <div class="w-full max-w-sm bg-white p-6 rounded-lg shadow-md">

      <!-- Success State -->
      <template v-if="success">
        <div class="text-center">
          <div class="text-green-500 text-5xl mb-4">
            <i class="fa-solid fa-circle-check"></i>
          </div>
          <h1 class="text-2xl font-bold mb-2 text-gray-800">Account Created!</h1>
          <p class="text-sm text-gray-500 mb-6">
            Please sign in again with the same provider to continue.
          </p>
          <button
            @click="handleLoginNow"
            class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-2 px-4 rounded transition cursor-pointer"
          >
            Login Now
          </button>
        </div>
      </template>

      <!-- Email Form State -->
      <template v-else>
        <h1 class="text-2xl font-bold mb-2 text-center text-gray-800">Email Required</h1>
        <p class="text-sm text-gray-500 text-center mb-6">
          We need your email address to complete your account setup.
        </p>

        <form @submit.prevent="handleSubmit">
          <input
            v-model="email"
            type="email"
            placeholder="Email address"
            required
            class="w-full border p-2 rounded mb-4 focus:ring-2 focus:ring-brand outline-none"
            :disabled="loading"
          />

          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-2 px-4 rounded transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg v-if="loading" class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            {{ loading ? 'Saving...' : 'Continue' }}
          </button>
        </form>

        <p v-if="errorMsg" class="text-red-500 mt-4 text-center text-sm bg-red-50 p-2 rounded">{{ errorMsg }}</p>

        <button
          @click="handleCancel"
          :disabled="loading"
          class="w-full mt-4 text-sm text-gray-500 hover:text-gray-700 transition cursor-pointer"
        >
          Cancel and sign out
        </button>
      </template>

    </div>
  </div>
</template>
