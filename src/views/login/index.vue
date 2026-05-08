<script setup>
import { ref, computed } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { useInstallStore } from '@/stores/install.js';
import { RouterLink } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

import { supportedProviders, getErrorMessage, signInWithEmailAndPassword, sendEmailVerification } from '@/utils/auth';

const forgotPasswordUrl = 'https://www.navitag.com/forgot-password';

function goToForgotPassword() {
  if (Capacitor.isNativePlatform()) {
    Browser.open({ url: forgotPasswordUrl });
  } else {
    window.location.href = forgotPasswordUrl;
  }
}

const email = ref('');
const password = ref('');
const feedbackMsg = ref('');
const isError = ref(false);
const loading = ref(false);
const showPassword = ref(false);
const userStore = useUserStore()

function setFeedback(msg, error = false) {
  feedbackMsg.value = msg;
  isError.value = error;
}

// Email Login
const handleLogin = async () => {
  loading.value = true;
  setFeedback('Signing in...');
  try {
    const user = await signInWithEmailAndPassword(email.value, password.value);

    if (user && !user.emailVerified) {
      setFeedback('Verification email sent. Please check your inbox.');
      sendEmailVerification().catch(() => {});
    } else {
      setFeedback('Signed in successfully.');
    }
  } catch (e) {
    setFeedback(getErrorMessage(e), true);
  } finally {
    loading.value = false;
  }
};

// Install PWA — pre-login entry point. Letting iOS users install before
// login avoids the "isolated PWA storage = re-login required" UX hit.
const installStore = useInstallStore();
const installNative = Capacitor.isNativePlatform();
const installStandalone = (() => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
})();
const installIsIOS = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && navigator.maxTouchPoints > 1);
})();
const showInstallLink = computed(() => !installNative && !installStandalone && !installStore.installed);
const showIosInstructions = ref(false);
const installFallbackMessage = ref('');

async function clickLoginInstall() {
  installFallbackMessage.value = '';
  if (installIsIOS) {
    showIosInstructions.value = !showIosInstructions.value;
    return;
  }
  if (installStore.deferred) {
    try {
      await installStore.deferred.prompt();
      await installStore.deferred.userChoice;
    } catch {}
    installStore.setDeferred(null);
    installStore.markResolved();
    return;
  }
  installFallbackMessage.value = 'Your browser hasn\'t offered an install prompt yet. Open the browser menu (three dots) and choose "Install app" or "Add to Home screen".';
}

// Provider Login (Google/Apple)
const handleProviderLogin = async (providerHandler) => {
  loading.value = true;
  setFeedback('Signing in...');
  try {
    await providerHandler();
    setFeedback('Signed in successfully.');
  } catch (e) {
    setFeedback("Sign in failed: " + e.message, true);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col items-center justify-center flex-1 p-4 bg-surface">
    <div class="w-full max-w-sm bg-white p-6 rounded-lg shadow-md">
      <h1 class="text-2xl font-bold mb-3 text-center text-gray-800">Welcome Back</h1>

      <!--div v-show="userStore.countryCode !== null" class="text-center text-gray-500 mb-3 font-semibold">Country Server: {{ userStore.countryCode }}</div-->

      <form @submit.prevent="handleLogin" class="mt-4">
        <input v-model="email" type="email" placeholder="Email" required class="w-full border p-1 rounded mb-3 focus:ring-2 focus:ring-brand outline-none" />
        <div class="mb-4">
          <div class="relative">
            <input v-model="password" :type="showPassword ? 'text' : 'password'" placeholder="Password" required class="w-full border p-1 rounded focus:ring-2 focus:ring-brand outline-none pr-10" />
            <button
              type="button"
              @click="showPassword = !showPassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer hover:text-brand transition-colors"
            >
              <i :class="showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
            </button>
          </div>
          <div class="text-right mt-1">
            <a v-if="!loading" href="#" @click.prevent="goToForgotPassword" class="text-xs text-brand hover:underline">Forgot password?</a>
            <span v-else class="text-xs text-gray-400">Forgot password?</span>
          </div>
        </div>
        
        <button type="submit" :disabled="loading" class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-2 px-4 rounded transition disabled:opacity-50 flex items-center justify-center gap-2">
          <svg v-if="loading" class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </button>

        <div v-if="showInstallLink" class="text-center mt-3">
          <a href="#" @click.prevent="clickLoginInstall" class="text-xs text-brand hover:underline">
            <i class="fa-solid fa-mobile-screen mr-1"></i>Install App on Home Screen
          </a>
        </div>

        <div v-if="installIsIOS && showIosInstructions" class="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 leading-relaxed border border-gray-200">
          <p class="font-semibold mb-2">Install on iPhone / iPad:</p>
          <ol class="list-decimal list-inside space-y-1">
            <li>Tap the <i class="fa-solid fa-arrow-up-from-bracket"></i> Share button at the bottom of Safari.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> in the top-right corner.</li>
          </ol>
          <p class="mt-2 text-gray-500 italic">Only works in Safari on iOS.</p>
        </div>

        <p v-if="installFallbackMessage" class="text-amber-700 text-xs mt-2 leading-snug">{{ installFallbackMessage }}</p>
      </form>

      <p v-if="feedbackMsg" :class="['mt-4 text-center text-sm', isError ? 'text-red-500' : 'text-gray-600']">{{ feedbackMsg }}</p>

      <div class="relative flex py-5 items-center">
        <div class="flex-grow border-t border-gray-300"></div>
        <span class="flex-shrink mx-4 text-accent text-sm font-medium">Or Login With</span>
        <div class="flex-grow border-t border-gray-300"></div>
      </div>

      <div class="flex justify-center space-x-4 mb-6 mt-2">
        <button
          v-for="p in supportedProviders"
          :key="p.id"
          @click="handleProviderLogin(p.handler)"
          :class="[loading ? 'bg-gray-300 cursor-not-allowed' : `${p.color} hover:opacity-90 cursor-pointer`, 'w-12 h-12 text-white rounded-full flex items-center justify-center transition shadow-sm']"
          :disabled="loading"
          :title="`Sign in with ${p.name}`"
        >
          <i :class="`${p.icon} text-xl`"></i>
        </button>
      </div>

      <div class="mt-6 text-center font-bold text-gray-600">
        Don't have an account?
        <RouterLink v-if="!loading" to="/signup" class="text-brand hover:underline">Sign Up</RouterLink>
        <span v-else class="text-gray-400">Sign Up</span>
      </div>
    </div>
  </div>
</template>