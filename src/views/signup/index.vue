<script setup>
import { ref, computed } from 'vue';
import { RouterLink } from 'vue-router';
import { supportedProviders, getErrorMessage, createUserWithEmailAndPassword } from '@/utils/auth';
import { useUserStore } from '@/stores/user.js';
import { countries } from '@/utils/countryList';

const userStore = useUserStore();
const email = ref('');
const password = ref('');
const name = ref('');
const confirmPassword = ref('');
const errorMsg = ref('');
const loading = ref(false);
const showCountryModal = ref(false);
const countrySearch = ref('');

const filteredCountries = computed(() => {
  if (!countrySearch.value) return countries;
  const q = countrySearch.value.toLowerCase();
  return countries.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
});

const currentCountryName = computed(() => {
  const match = countries.find(c => c.code === userStore.countryCode);
  return match ? match.name : userStore.countryCode;
});

const selectCountry = (c) => {
  userStore.countryCode = c.code;
  showCountryModal.value = false;
  countrySearch.value = '';
};

// Toggle States
const showPassword = ref(false);
const showConfirmPassword = ref(false);

// Updated Password Validation Logic to include special characters
const validatePassword = (pwd) => {
  if (pwd.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pwd)) return "Password must contain at least one uppercase letter.";
  if (!/[0-9]/.test(pwd)) return "Password must contain at least one number.";
  // Added special character check
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) return "Password must contain at least one special character.";
  return null;
};

// Social Signup Handler
const handleProviderSignup = async (providerHandler) => {
  loading.value = true;
  errorMsg.value = '';
  try {
    await providerHandler();
  } catch (e) {
    errorMsg.value = "Signup failed: " + e.message;
  } finally {
    loading.value = false;
  }
};

const handleSignup = async () => {
  if (password.value !== confirmPassword.value) {
    errorMsg.value = "Passwords do not match.";
    return;
  }

  const passwordError = validatePassword(password.value);
  if (passwordError) {
    errorMsg.value = passwordError;
    return;
  }

  loading.value = true;
  errorMsg.value = '';

  try {
    userStore.name = name.value;
    await createUserWithEmailAndPassword(email.value, password.value);
  } catch (e) {
    errorMsg.value = getErrorMessage(e);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col items-center justify-center flex-1 p-4 bg-surface">
    <div class="w-full max-w-sm bg-white p-6 rounded-lg shadow-md">
      <h1 class="text-2xl font-bold mb-4 text-center text-gray-800">Create Account</h1>

      <div v-show="userStore.countryCode !== null" class="flex items-center justify-center gap-1 mb-3">
        <span class="text-gray-500 font-semibold text-sm">Country Server: {{ currentCountryName }}</span>
        <button
          type="button"
          @click="showCountryModal = true"
          class="text-brand hover:text-brand-dark transition text-xs cursor-pointer"
        >
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
      </div>

      <form @submit.prevent="handleSignup" class="mt-4">
        <div class="mb-3">
          <input v-model="name" placeholder="Full Name" type="text" required class="w-full border p-1 rounded focus:ring-2 focus:ring-brand outline-none" />
        </div>

        <div class="mb-3">
          <input v-model="email" type="email" placeholder="Email" required class="w-full border p-1 rounded focus:ring-2 focus:ring-brand outline-none" />
        </div>
        
        <div class="mb-3 relative">
          <input 
            v-model="password" 
            :type="showPassword ? 'text' : 'password'" 
            required 
            class="w-full border p-1 rounded focus:ring-2 focus:ring-brand outline-none pr-10"
            placeholder="Password"
          />
          <button 
            type="button"
            @click="showPassword = !showPassword"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer hover:text-brand transition-colors"
          >
            <i :class="showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
          </button>
        </div>

        <div class="mb-1 relative">
          <input 
            v-model="confirmPassword" 
            :type="showConfirmPassword ? 'text' : 'password'" 
            placeholder="Confirm Password" 
            required 
            class="w-full border p-1 rounded focus:ring-2 focus:ring-brand outline-none pr-10" 
          />
          <button 
            type="button"
            @click="showConfirmPassword = !showConfirmPassword"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer hover:text-brand transition-colors"
          >
            <i :class="showConfirmPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
          </button>
        </div>

        <p class="text-[10px] text-gray-400 mb-6 leading-tight italic">
          8 characters long and have 1 Capital, 1 Number, 1 special Character
        </p>
        
        <button type="submit" :disabled="loading" class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-2 px-4 rounded transition disabled:opacity-50 cursor-pointer">
          {{ loading ? 'Creating Account...' : 'Sign Up' }}
        </button>
      </form>

      <p v-if="errorMsg" class="text-red-500 mt-4 text-center text-sm bg-red-50 p-2 rounded">{{ errorMsg }}</p>
      <div v-else class="h-6"></div>

      <div class="relative flex py-5 items-center">
        <div class="flex-grow border-t border-gray-300"></div>
        <span class="flex-shrink mx-4 text-accent text-sm font-medium">Or Sign Up With</span>
        <div class="flex-grow border-t border-gray-300"></div>
      </div>

      <div class="flex justify-center space-x-4 mb-6 mt-2">
        <button 
          v-for="p in supportedProviders" 
          :key="p.id"
          @click="handleProviderSignup(p.handler)"
          :class="`${p.color} w-12 h-12 text-white rounded-full flex items-center justify-center transition hover:opacity-90 shadow-sm cursor-pointer`"
          :disabled="loading"
          :title="`Sign in with ${p.name}`"
        >
          <i :class="`${p.icon} text-xl`"></i>
        </button>
      </div>

      <div class="mt-6 text-center text-gray-600 font-bold">
        Already have an account?
        <RouterLink to="/login" class="text-brand hover:underline">Log In</RouterLink>
      </div>
    </div>

    <!-- Country Selector Modal -->
    <div v-if="showCountryModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="showCountryModal = false">
      <div class="bg-white rounded-xl shadow-lg w-full max-w-xs mx-4 overflow-hidden">
        <div class="p-4 border-b border-gray-100">
          <h2 class="text-sm font-bold text-gray-800 text-center">Select Country Server</h2>
          <input
            v-model="countrySearch"
            type="text"
            placeholder="Search..."
            class="w-full border p-2 rounded mt-3 text-sm focus:ring-2 focus:ring-brand outline-none"
          />
        </div>
        <ul class="max-h-60 overflow-y-auto">
          <li
            v-for="c in filteredCountries"
            :key="c.code"
            @click="selectCountry(c)"
            class="px-4 py-3 text-sm text-gray-700 cursor-pointer border-b border-gray-50 last:border-0 flex items-center justify-between"
            :class="userStore.countryCode === c.code ? 'bg-brand-light font-bold text-brand' : 'hover:bg-gray-50'"
          >
            <span>{{ c.name }} <span class="text-gray-400 text-xs">{{ c.code }}</span></span>
            <i v-if="userStore.countryCode === c.code" class="fa-solid fa-check text-brand text-xs"></i>
          </li>
          <li v-if="filteredCountries.length === 0" class="px-4 py-4 text-sm text-gray-400 text-center italic">No match</li>
        </ul>
        <div class="p-3 border-t border-gray-100">
          <button @click="showCountryModal = false" class="w-full text-sm text-gray-500 hover:text-gray-700 transition cursor-pointer">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>