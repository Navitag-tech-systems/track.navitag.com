<script setup>
import { ref, watch, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useInstallStore } from '@/stores/install.js';
import { signOut } from '@/utils/auth';
import { auth } from '@/firebase';
import { baseUrl } from '@/utils/variables';
import { request } from '@/utils/http';
import { countries } from '@/utils/countryList';
import { Capacitor } from '@capacitor/core';

const router = useRouter();
const userStore = useUserStore();
const installStore = useInstallStore();

// Build dial code groups from countryList: { isos: ['US','CA',...], code: '+1', label: 'US/CA (+1)' }
const countryCodes = (() => {
  const grouped = {};
  for (const c of countries) {
    if (!grouped[c.dial]) grouped[c.dial] = [];
    grouped[c.dial].push(c.code);
  }
  return Object.entries(grouped)
    .map(([dial, isos]) => ({ isos, code: dial, label: `${isos.join('/')} (${dial})` }))
    .sort((a, b) => parseInt(a.code.replace('+', '')) - parseInt(b.code.replace('+', '')));
})();

// State for Profile Update
const name = ref('');
const phoneCountryCode = ref('+1');
const phoneNumber = ref('');
const profileLoading = ref(false);
const profileMessage = ref('');
const profileError = ref('');

// State for Password Update
const newPassword = ref('');
const confirmPassword = ref('');
const showPassword = ref(false);
const passwordLoading = ref(false);
const passwordMessage = ref('');
const passwordError = ref('');

// Watch for changes to the user's name and auto-fill
watch(() => userStore.name, (newName) => {
  if (newName) name.value = newName;
}, { immediate: true });

// Watch for changes to the user's phone
watch(() => userStore.phone, (newPhone) => {
  if (newPhone) {
    const match = countryCodes.find(c => newPhone.startsWith(c.code));
    if (match) {
      phoneCountryCode.value = match.code;
      // Strip out the hyphen if it was saved with one
      if (newPhone.charAt(match.code.length) === '-') {
        phoneNumber.value = newPhone.slice(match.code.length + 1);
      } else {
        phoneNumber.value = newPhone.slice(match.code.length);
      }
    } else {
      phoneNumber.value = newPhone;
    }
  }
}, { immediate: true });

// Prefill country code based on IP location if no phone number is set
watch(() => userStore.countryCode, (newIso) => {
  // Only auto-fill if the user doesn't already have a phone number saved
  if (!userStore.phone && newIso) {
    const defaultCountry = countryCodes.find(c => c.isos.includes(newIso));
    if (defaultCountry) {
      phoneCountryCode.value = defaultCountry.code;
    }
  }
}, { immediate: true });

const updateProfile = async () => {
  profileLoading.value = true;
  profileMessage.value = '';
  profileError.value = '';

  // Format with a hyphen: +[code]-[number]
  const fullPhone = phoneNumber.value.trim() 
    ? `${phoneCountryCode.value}-${phoneNumber.value.trim()}` 
    : '';
  
  const payload = {};

  let hasChanges = false;
  if (name.value.trim() !== userStore.name) {
    payload.name = name.value.trim();
    hasChanges = true;
  }
  
  if (fullPhone !== userStore.phone && fullPhone !== '') {
    payload.phone = fullPhone;
    payload.mobile = fullPhone; // Included to match backend docs explicitly
    hasChanges = true;
  }

  if (!hasChanges) {
    profileMessage.value = 'No changes to save.';
    profileLoading.value = false;
    return;
  }

  try {
    const data = await request.send({
      url: `${baseUrl}/user/update`,
      method: 'POST',
      data: payload,
      token: userStore.idToken
    });

    if (data.status === 'success') {
      profileMessage.value = 'Profile updated successfully.';
      if (payload.name) userStore.name = payload.name;
      if (payload.phone) userStore.phone = payload.phone;
    } else {
      throw new Error(data.error || 'Failed to update profile.');
    }
  } catch (error) {
    console.error('Update profile error:', error);
    profileError.value = error.message || 'Error communicating with the server.';
  } finally {
    profileLoading.value = false;
  }
};

const validatePassword = (pwd) => {
  if (pwd.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pwd)) return "Must contain at least one uppercase letter.";
  if (!/[0-9]/.test(pwd)) return "Must contain at least one number.";
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) return "Must contain at least one special character.";
  return null;
};

const updatePassword = async () => {
  passwordMessage.value = '';
  passwordError.value = '';

  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = "Passwords do not match.";
    return;
  }

  const pwdError = validatePassword(newPassword.value);
  if (pwdError) {
    passwordError.value = pwdError;
    return;
  }

  passwordLoading.value = true;

  try {
    await auth.updatePassword({ newPassword: newPassword.value });
    passwordMessage.value = 'Password changed successfully.';
    newPassword.value = '';
    confirmPassword.value = '';
  } catch (error) {
    console.error('Update password error:', error);
    if (error.message?.includes('requires-recent-login') || error.code === 'auth/requires-recent-login') {
      passwordError.value = 'For security reasons, please log out and log back in to change your password.';
    } else {
      passwordError.value = error.message || 'Failed to update password.';
    }
  } finally {
    passwordLoading.value = false;
  }
};

// State for Push Notifications
const pushBusy = ref(false);
const pushMessage = ref('');
const pushError = ref('');

const pushEnabled = computed(() => userStore.pushPermission === 'granted');
const pushUnsupported = computed(() => userStore.pushPermission === 'unsupported');

const pushHelpText = computed(() => {
  switch (userStore.pushPermission) {
    case 'granted':
      return 'Enabled. Tap to refresh the device token.';
    case 'denied':
      return 'Blocked at the system level. Open your device settings to allow notifications.';
    case 'unsupported':
      return 'Notifications are not supported on this platform.';
    case 'prompt':
    case 'prompt-with-rationale':
      return 'Tap to enable push notifications on this device.';
    default:
      return 'Tap to enable push notifications on this device.';
  }
});

const togglePush = async () => {
  if (pushBusy.value || pushUnsupported.value) return;
  pushBusy.value = true;
  pushMessage.value = '';
  pushError.value = '';

  try {
    if (userStore.pushPermission === 'denied') {
      pushError.value = 'Notifications are blocked. Open your device settings to enable them, then come back.';
      return;
    }

    const result = await userStore.enablePushFromGesture();

    if (result === 'granted') {
      pushMessage.value = userStore.fcmToken
        ? 'Notifications enabled.'
        : 'Permission granted, but token registration failed. Try again.';
    } else if (result === 'token-error') {
      pushError.value = 'Permission granted, but failed to register with the server. Try again.';
    } else if (result === 'denied') {
      pushError.value = 'Permission denied. Open your device settings to enable notifications.';
    } else if (result === 'unsupported') {
      pushError.value = 'Notifications are not supported on this platform.';
    } else {
      pushError.value = 'Unable to enable notifications.';
    }
  } catch (err) {
    console.error('Toggle push failed:', err);
    pushError.value = err?.message || 'Failed to update notification permission.';
  } finally {
    pushBusy.value = false;
  }
};

onMounted(() => {
  userStore.checkPushPermission();
});

// Install PWA section — manual install entry point for testing.
// Hidden inside the native app and once the PWA is already installed.
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
const showIosInstructions = ref(false);
const installFallbackMessage = ref('');
const installSuccessMessage = ref('');

const showInstallCard = computed(() => !installNative && !installStandalone && !installStore.installed);
const canInstallProgrammatic = computed(() => !!installStore.deferred);

const installHelpText = computed(() => {
  if (installIsIOS) return 'Add Navitag to your home screen for an app-like experience.';
  if (canInstallProgrammatic.value) return 'Install Navitag for a faster, app-like experience.';
  return 'Install Navitag for a faster, app-like experience. If the button below does nothing, open your browser menu (three dots) and choose "Install app" or "Add to Home screen".';
});

const installButtonLabel = computed(() => {
  if (installIsIOS) return showIosInstructions.value ? 'Hide instructions' : 'How to install on iOS';
  return 'Install Navitag';
});

async function clickAccountInstall() {
  installFallbackMessage.value = '';
  installSuccessMessage.value = '';

  if (installIsIOS) {
    showIosInstructions.value = !showIosInstructions.value;
    return;
  }

  if (installStore.deferred) {
    try {
      await installStore.deferred.prompt();
      const choice = await installStore.deferred.userChoice;
      if (choice?.outcome === 'accepted') {
        installSuccessMessage.value = 'Install accepted. Look for the app on your home screen.';
      } else {
        installFallbackMessage.value = 'Install dismissed. You can try again from your browser menu later.';
      }
    } catch (err) {
      installFallbackMessage.value = 'Install prompt unavailable. Open your browser menu and choose "Install app" or "Add to Home screen".';
    }
    installStore.setDeferred(null);
    installStore.markResolved();
    return;
  }

  // No deferred event captured. Either Chrome's engagement heuristic hasn't
  // fired yet, the device isn't installable (in-app webview, unsupported
  // browser), or the user reached this page without ever passing through
  // the ?pwa=1 first-deploy gate.
  installFallbackMessage.value = 'Your browser hasn\'t offered an install prompt yet. Open the browser menu (three dots) and choose "Install app" or "Add to Home screen". On Chrome desktop, look for the install icon in the URL bar.';
}

const handleLogout = async () => {
  try {
    await signOut();
  } catch (error) {
    console.error('Logout error:', error);
  }
};
</script>

<template>
  <div class="flex flex-col flex-1 bg-surface ">
    
    <div class="bg-white p-4 shadow-sm flex items-center mb-4">
      <button @click="router.back()" class="text-gray-600 mr-4 cursor-pointer hover:text-gray-900">
        <i class="fa-solid fa-arrow-left text-xl"></i>
      </button>
      <h1 class="text-xl font-bold text-gray-800">Account Settings</h1>
    </div>

    <div class="flex-1 p-4 overflow-y-auto space-y-6">
      
      <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h2 class="text-lg font-bold text-gray-800 mb-4">Profile Information</h2>
        
        <form @submit.prevent="updateProfile" class="space-y-4">
          <div>
            <input
              :value="userStore.user?.email || userStore.email || ''"
              type="email"
              placeholder="Email"
              readonly
              class="w-full border p-1 rounded bg-gray-100 text-gray-500 outline-none cursor-not-allowed"
            />
          </div>

          <div>
            <input
              v-model="name"
              type="text"
              placeholder="Full Name"
              class="w-full border p-1 rounded focus:ring-2 focus:ring-brand outline-none"
            />
          </div>

          <div>
            <div class="flex space-x-2">
              
              <div class="relative border p-1 rounded bg-white flex items-center justify-center w-[60px] focus-within:ring-2 focus-within:ring-brand overflow-hidden">
                <span class="text-gray-800">{{ phoneCountryCode }}</span>
                <i class="fa-solid fa-chevron-down text-[10px] text-gray-400 ml-1"></i>
                
                <select 
                  v-model="phoneCountryCode" 
                  class="absolute inset-0 w-full flex-1 opacity-0 cursor-pointer"
                >
                  <option v-for="c in countryCodes" :key="c.code" :value="c.code">
                    {{ c.label }}
                  </option>
                </select>
              </div>

              <input 
                v-model="phoneNumber" 
                type="tel" 
                placeholder="Phone Number" 
                class="flex-1 border p-1 rounded focus:ring-2 focus:ring-brand outline-none"
              />
            </div>
          </div>

          <p v-if="profileMessage" class="text-green-600 text-sm mt-2"><i class="fa-solid fa-check mr-1"></i>{{ profileMessage }}</p>
          <p v-if="profileError" class="text-red-500 text-sm mt-2">{{ profileError }}</p>

          <button 
            type="submit" 
            :disabled="profileLoading"
            class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 px-4 rounded transition cursor-pointer text-sm shadow active:scale-[0.98] disabled:opacity-50 mt-2"
          >
            <i v-if="profileLoading" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
            {{ profileLoading ? 'Saving...' : 'Save Profile' }}
          </button>
        </form>
      </div>

      <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h2 class="text-lg font-bold text-gray-800 mb-4">Notifications</h2>

        <div class="flex items-center justify-between">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-800">Push notifications</p>
            <p class="text-xs text-gray-500 mt-1 leading-snug">{{ pushHelpText }}</p>
          </div>

          <button
            type="button"
            :disabled="pushBusy || pushUnsupported"
            @click="togglePush"
            :aria-pressed="pushEnabled"
            :class="[
              'relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0',
              pushEnabled ? 'bg-brand' : 'bg-gray-300',
              (pushBusy || pushUnsupported) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            ]"
          >
            <span
              :class="[
                'inline-block h-4 w-4 transform rounded-full bg-white transition shadow',
                pushEnabled ? 'translate-x-6' : 'translate-x-1'
              ]"
            />
            <i
              v-if="pushBusy"
              class="fa-solid fa-circle-notch fa-spin absolute -right-6 text-gray-400 text-sm"
            ></i>
          </button>
        </div>

        <p v-if="pushMessage" class="text-green-600 text-sm mt-3"><i class="fa-solid fa-check mr-1"></i>{{ pushMessage }}</p>
        <p v-if="pushError" class="text-red-500 text-sm mt-3">{{ pushError }}</p>
      </div>

      <div v-if="showInstallCard" class="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h2 class="text-lg font-bold text-gray-800 mb-4">Install App</h2>

        <p class="text-xs text-gray-500 mb-4 leading-snug">{{ installHelpText }}</p>

        <button
          type="button"
          @click="clickAccountInstall"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 px-4 rounded transition cursor-pointer text-sm shadow active:scale-[0.98]"
        >
          <i class="fa-solid fa-download mr-2"></i>{{ installButtonLabel }}
        </button>

        <div v-if="installIsIOS && showIosInstructions" class="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 leading-relaxed border border-gray-200">
          <p class="font-semibold mb-2">Install on iPhone / iPad:</p>
          <ol class="list-decimal list-inside space-y-1">
            <li>Tap the <i class="fa-solid fa-arrow-up-from-bracket"></i> Share button at the bottom of Safari.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> in the top-right corner.</li>
          </ol>
          <p class="mt-2 text-gray-500 italic">Only works in Safari on iOS — not Chrome or other browsers.</p>
        </div>

        <p v-if="installSuccessMessage" class="text-green-600 text-sm mt-3"><i class="fa-solid fa-check mr-1"></i>{{ installSuccessMessage }}</p>
        <p v-if="installFallbackMessage" class="text-amber-700 text-xs mt-3 leading-snug">{{ installFallbackMessage }}</p>
      </div>

      <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h2 class="text-lg font-bold text-gray-800 mb-4">Change Password</h2>
        
        <form @submit.prevent="updatePassword" class="space-y-4">
          <div class="relative">
            <input 
              v-model="newPassword" 
              :type="showPassword ? 'text' : 'password'" 
              placeholder="New Password" 
              required 
              class="w-full border p-1 rounded focus:ring-2 focus:ring-brand outline-none pr-10" 
            />
            <button 
              type="button"
              @click="showPassword = !showPassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer hover:text-brand"
            >
              <i :class="showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
            </button>
          </div>

          <div class="relative">
            <input 
              v-model="confirmPassword" 
              :type="showPassword ? 'text' : 'password'" 
              placeholder="Confirm New Password" 
              required 
              class="w-full border p-1 rounded focus:ring-2 focus:ring-brand outline-none pr-10" 
            />
          </div>

          <p class="text-[10px] text-gray-400 leading-tight italic">
            * Must be 8 characters long, 1 capital, 1 number, 1 special character.
          </p>

          <p v-if="passwordMessage" class="text-green-600 text-sm mt-2"><i class="fa-solid fa-check mr-1"></i>{{ passwordMessage }}</p>
          <p v-if="passwordError" class="text-red-500 text-sm mt-2">{{ passwordError }}</p>

          <button 
            type="submit" 
            :disabled="passwordLoading"
            class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 px-4 rounded transition cursor-pointer text-sm shadow active:scale-[0.98] disabled:opacity-50 mt-2"
          >
            <i v-if="passwordLoading" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
            {{ passwordLoading ? 'Updating...' : 'Update Password' }}
          </button>
        </form>
      </div>

      <button 
        @click="handleLogout"
        class="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-3 px-4 rounded transition cursor-pointer text-sm shadow-sm active:scale-[0.98]"
      >
        <i class="fa-solid fa-right-from-bracket mr-2"></i> Log Out
      </button>

    </div>
  </div>
</template>