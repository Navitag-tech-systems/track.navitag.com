<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/firebase';
import { supportedProviders, getErrorMessage } from '@/utils/auth'; // Import providers

const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const errorMsg = ref('');
const loading = ref(false);
const router = useRouter();

// Password Validation Logic
const validatePassword = (pwd) => {
  if (pwd.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pwd)) return "Password must contain at least one uppercase letter.";
  if (!/[0-9]/.test(pwd)) return "Password must contain at least one number.";
  return null;
};

// Social Signup Handler
const handleProviderSignup = async (providerHandler) => {
  loading.value = true;
  errorMsg.value = '';
  try {
    await providerHandler();
    router.replace('/');
  } catch (e) {
    errorMsg.value = "Signup failed: " + e.message;
  } finally {
    loading.value = false;
  }
};

const handleSignup = async () => {
  // 1. Check Matching Passwords
  if (password.value !== confirmPassword.value) {
    errorMsg.value = "Passwords do not match.";
    return;
  }

  // 2. Check Password Complexity
  const passwordError = validatePassword(password.value);
  if (passwordError) {
    errorMsg.value = passwordError;
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
      
      <div class="space-y-3 mb-6">
        <button 
          v-for="p in supportedProviders" 
          :key="p.id"
          @click="handleProviderSignup(p.handler)"
          :class="`${p.color} w-full text-white font-semibold py-2 px-4 rounded flex items-center justify-center transition disabled:opacity-50`"
          :disabled="loading"
        >
          <i :class="`${p.icon} mr-2`"></i>
          Sign up with {{ p.name }}
        </button>
      </div>

      <div class="relative flex py-2 items-center">
        <div class="flex-grow border-t border-gray-300"></div>
        <span class="flex-shrink mx-4 text-gray-400 text-sm">Or with email</span>
        <div class="flex-grow border-t border-gray-300"></div>
      </div>

      <form @submit.prevent="handleSignup" class="mt-4">
        <div class="mb-3">
          <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input v-model="email" type="email" required class="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        
        <div class="mb-3">
          <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input 
            v-model="password" 
            type="password" 
            required 
            class="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="8+ chars, 1 uppercase, 1 number"
          />
        </div>

        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
          <input v-model="confirmPassword" type="password" required class="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        
        <button type="submit" :disabled="loading" class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-2 px-4 rounded transition disabled:opacity-50">
          {{ loading ? 'Creating Account...' : 'Sign Up' }}
        </button>
      </form>

      <p v-if="errorMsg" class="text-red-500 mt-4 text-center text-sm bg-red-50 p-2 rounded">{{ errorMsg }}</p>

      <div class="mt-6 text-center text-sm text-gray-600">
        Already have an account? 
        <RouterLink to="/login" class="text-blue-600 hover:underline">Log In</RouterLink>
      </div>
    </div>
  </div>
</template>