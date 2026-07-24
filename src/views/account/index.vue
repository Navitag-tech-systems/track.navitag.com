<script setup>
import { ref, watch, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { useInstallStore } from '@/stores/install.js';
import { useNotificationsStore } from '@/stores/notifications.js';
import QrDisplayModal from '@/components/QrDisplayModal.vue';
import { signOut } from '@/utils/auth';
import { auth } from '@/firebase';
import { baseUrl } from '@/utils/variables';
import { request } from '@/utils/http';
import { Capacitor } from '@capacitor/core';

const router = useRouter();
const userStore = useUserStore();
const installStore = useInstallStore();
const notifStore = useNotificationsStore();

// State for Profile Update
const name = ref('');
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

const updateProfile = async () => {
  profileLoading.value = true;
  profileMessage.value = '';
  profileError.value = '';

  if (name.value.trim() === userStore.name) {
    profileMessage.value = 'No changes to save.';
    profileLoading.value = false;
    return;
  }

  try {
    const data = await request.send({
      url: `${baseUrl}/user/update`,
      method: 'POST',
      data: { name: name.value.trim() },
      token: userStore.idToken
    });

    if (data.status === 'success') {
      profileMessage.value = 'Profile updated successfully.';
      userStore.name = name.value.trim();
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
// "Disabled on this device" is neither success (green check) nor error
// (red, no icon) — it's an intentional opt-out. Render in red with an X.
const pushDisabledMessage = ref('');

// "Enabled" requires both OS permission AND a registered token. After the
// user disables push on this device we delete the token but the OS permission
// stays 'granted'; without the token check the toggle would visually stick on.
const pushEnabled = computed(() =>
  userStore.pushPermission === 'granted' && userStore.fcmToken !== null
);
const pushUnsupported = computed(() => userStore.pushPermission === 'unsupported');

const pushHelpText = computed(() => {
  if (pushUnsupported.value) return 'Notifications are not supported on this platform.';
  if (userStore.pushPermission === 'denied') {
    return 'Blocked at the system level. Open your device settings to allow notifications.';
  }
  if (pushEnabled.value) return 'Enabled on this device. Tap to disable.';
  return 'Tap to enable push notifications on this device.';
});

const togglePush = async () => {
  if (pushBusy.value || pushUnsupported.value) return;
  pushBusy.value = true;
  pushMessage.value = '';
  pushError.value = '';
  pushDisabledMessage.value = '';

  try {
    if (pushEnabled.value) {
      await userStore.disablePushOnThisDevice();
      pushDisabledMessage.value = 'Notifications disabled on this device.';
      return;
    }

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
  notifStore.fetch().catch(() => {});
});

// Master + emergency toggle handlers
const masterBusy = ref(false);
const masterError = ref('');
const emergencyBusy = ref(false);
const emergencyError = ref('');

// Display state for the master/emergency toggles is gated on device-level
// push being fully active (OS permission + registered FCM token). Without
// device push, no notification can land, so the account-level switches
// render as OFF regardless of backend state.
const masterToggleOn = computed(() => pushEnabled.value && notifStore.notifications_enabled);
const emergencyToggleOn = computed(() => pushEnabled.value && notifStore.emergency_notifications_enabled);

// First-grant flow shared by both toggles: prompt the OS for notification
// permission, register the FCM token, then ensure both backend switches end
// up true (mirror if already true, PUT if false).
const enableViaPermission = async () => {
  if (pushUnsupported.value) {
    throw new Error('Notifications are not supported on this platform.');
  }
  if (userStore.pushPermission === 'denied') {
    throw new Error('Notifications are blocked. Open device settings to enable them, then come back.');
  }
  const result = await userStore.enablePushFromGesture();
  if (result !== 'granted') {
    if (result === 'denied') throw new Error('Permission denied. Open device settings to enable notifications.');
    if (result === 'token-error') throw new Error('Permission granted but failed to register with the server. Try again.');
    throw new Error('Notifications are not supported on this platform.');
  }
  if (!notifStore.notifications_enabled) await notifStore.setMaster(true);
  if (!notifStore.emergency_notifications_enabled) await notifStore.setEmergency(true);
};

const toggleMaster = async () => {
  if (masterBusy.value || !notifStore.loaded) return;
  masterBusy.value = true;
  masterError.value = '';
  try {
    if (!pushEnabled.value) {
      await enableViaPermission();
    } else {
      await notifStore.setMaster(!notifStore.notifications_enabled);
    }
  } catch (err) {
    masterError.value = err?.message || 'Failed to update setting.';
  } finally {
    masterBusy.value = false;
  }
};

const toggleEmergency = async () => {
  if (emergencyBusy.value || !notifStore.loaded) return;
  emergencyBusy.value = true;
  emergencyError.value = '';
  try {
    if (!pushEnabled.value) {
      await enableViaPermission();
    } else {
      await notifStore.setEmergency(!notifStore.emergency_notifications_enabled);
    }
  } catch (err) {
    emergencyError.value = err?.message || 'Failed to update setting.';
  } finally {
    emergencyBusy.value = false;
  }
};

// Platform detection — used by both Install card and Notifications card to
// gate visibility. Both cards are restricted to Android/iOS mobile/tablet only.
const installNative = Capacitor.isNativePlatform();
const installStandalone = (() => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
})();
const installIsMobileTouch = (() => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
})();
const installIsIOS = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && navigator.maxTouchPoints > 1);
})();
const installIsAndroid = (() => {
  if (typeof navigator === 'undefined') return false;
  return /Android/.test(navigator.userAgent || '');
})();
const isMobileOS = installIsIOS || installIsAndroid;
const showIosInstructions = ref(false);
const showManualInstructions = ref(false);
const installSuccessMessage = ref('');

// Install card: Android/iOS mobile/tablet browsers only. Hidden on desktop,
// non-Android/iOS UAs, native app, and once installed.
const showInstallCard = computed(() =>
  !installNative &&
  !installStandalone &&
  !installStore.installed &&
  installIsMobileTouch &&
  isMobileOS
);

// Notifications card: only inside the installed PWA on Android/iOS mobile.
// Hidden in any browser tab (per project rule: no notifications on web).
const showNotificationsCard = computed(() =>
  !installNative &&
  installStandalone &&
  installIsMobileTouch &&
  isMobileOS
);

const installHelpText = computed(() => {
  if (installIsIOS) return 'Add Navitag to your home screen for an app-like experience.';
  return 'Install Navitag for a faster, app-like experience.';
});

const installButtonLabel = computed(() => {
  if (installIsIOS) return showIosInstructions.value ? 'Hide instructions' : 'How to install on iOS';
  return 'Install Navitag';
});

async function clickAccountInstall() {
  showIosInstructions.value = false;
  showManualInstructions.value = false;
  installSuccessMessage.value = '';

  if (installIsIOS) {
    showIosInstructions.value = true;
    return;
  }

  if (installStore.deferred) {
    try {
      await installStore.deferred.prompt();
      const choice = await installStore.deferred.userChoice;
      if (choice?.outcome === 'accepted') {
        installSuccessMessage.value = 'Install accepted. Look for the app on your home screen.';
      } else {
        showManualInstructions.value = true;
      }
    } catch {
      showManualInstructions.value = true;
    }
    installStore.setDeferred(null);
    installStore.markResolved();
    return;
  }

  // No deferred event captured (engagement heuristic not yet met,
  // unsupported browser, in-app webview, etc.). Show the platform's
  // canonical manual install path.
  showManualInstructions.value = true;
}

const showQrModal = ref(false);

// Two-step delete confirmation: first tap arms the button (turns red,
// "Confirm Delete"), second tap triggers the actual deletion.
const deleteConfirming = ref(false);
const deleteLoading = ref(false);
const deleteError = ref('');
const handleDeleteClick = async () => {
  if (deleteLoading.value) return;

  if (!deleteConfirming.value) {
    deleteConfirming.value = true;
    return;
  }

  // Confirmed: delete the backend record + Firebase user, then sign out.
  // POST with no body (the endpoint takes none); auth is the Bearer token.
  deleteLoading.value = true;
  deleteError.value = '';
  try {
    await request.send({
      url: `${baseUrl}/user/delete-account`,
      method: 'POST',
      token: userStore.idToken,
    });
    // Account is gone on the backend — tear down the local session and
    // redirect to /login (signOut runs the full lifecycle teardown).
    await signOut();
  } catch (error) {
    console.error('Delete account error:', error);
    deleteError.value = error.message || 'Failed to delete account. Please try again.';
    deleteConfirming.value = false;
    deleteLoading.value = false;
  }
};

const logoutLoading = ref(false);
const handleLogout = async () => {
  if (logoutLoading.value) return;
  logoutLoading.value = true;
  try {
    await signOut();
    // Don't reset logoutLoading — auth-state listener will redirect to /login
    // and unmount this view. Resetting would briefly flash the button back.
  } catch (error) {
    console.error('Logout error:', error);
    logoutLoading.value = false;
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

      <div class="flex justify-center">
        <button
          type="button"
          @click="showQrModal = true"
          :disabled="!userStore.user?.uid"
          aria-label="Show my QR code"
          class="w-16 h-16 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-brand hover:bg-brand-light transition cursor-pointer active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i class="fa-solid fa-qrcode text-2xl"></i>
        </button>
      </div>

      <QrDisplayModal v-model="showQrModal" :value="userStore.user?.uid || ''" />

      <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h2 class="text-lg font-bold text-gray-800 mb-4">Profile Information</h2>
        
        <form @submit.prevent="updateProfile" class="space-y-4">
          <div>
            <input
              :value="userStore.email || userStore.user?.email || ''"
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
            <p class="text-sm font-medium text-gray-800">Allow Notifications</p>
            <p class="text-xs text-gray-500 mt-1 leading-snug">Master switch for all push notifications from your devices.</p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <i
              v-if="masterBusy || (!notifStore.loaded && notifStore.loading)"
              class="fa-solid fa-circle-notch fa-spin text-gray-400 text-sm"
            ></i>
            <button
              type="button"
              :disabled="masterBusy || !notifStore.loaded"
              @click="toggleMaster"
              :aria-pressed="masterToggleOn"
              :class="[
                'relative inline-flex h-6 w-11 items-center rounded-full transition',
                masterToggleOn ? 'bg-brand' : 'bg-gray-300',
                (masterBusy || !notifStore.loaded) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              ]"
            >
              <span
                :class="[
                  'inline-block h-4 w-4 transform rounded-full bg-white transition shadow',
                  masterToggleOn ? 'translate-x-6' : 'translate-x-1'
                ]"
              />
            </button>
          </div>
        </div>
        <p v-if="masterError" class="text-red-500 text-sm mt-3">{{ masterError }}</p>

        <div class="flex items-center justify-between mt-5 pt-5 border-t border-gray-100">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-800">Allow Emergency Notifications</p>
            <p class="text-xs text-gray-500 mt-1 leading-snug">Receive impact alerts for devices where you are listed as an emergency contact.</p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <i
              v-if="emergencyBusy"
              class="fa-solid fa-circle-notch fa-spin text-gray-400 text-sm"
            ></i>
            <button
              type="button"
              :disabled="emergencyBusy || !notifStore.loaded"
              @click="toggleEmergency"
              :aria-pressed="emergencyToggleOn"
              :class="[
                'relative inline-flex h-6 w-11 items-center rounded-full transition',
                emergencyToggleOn ? 'bg-brand' : 'bg-gray-300',
                (emergencyBusy || !notifStore.loaded) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              ]"
            >
              <span
                :class="[
                  'inline-block h-4 w-4 transform rounded-full bg-white transition shadow',
                  emergencyToggleOn ? 'translate-x-6' : 'translate-x-1'
                ]"
              />
            </button>
          </div>
        </div>
        <p v-if="emergencyError" class="text-red-500 text-sm mt-3">{{ emergencyError }}</p>

        <div v-if="showNotificationsCard" class="flex items-center justify-between mt-5 pt-5 border-t border-gray-100">
          <div class="flex-1 pr-4">
            <p class="text-sm font-medium text-gray-800">Push notifications on this device</p>
            <p class="text-xs text-gray-500 mt-1 leading-snug">{{ pushHelpText }}</p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <i
              v-if="pushBusy"
              class="fa-solid fa-circle-notch fa-spin text-gray-400 text-sm"
            ></i>
            <button
              type="button"
              :disabled="pushBusy || pushUnsupported"
              @click="togglePush"
              :aria-pressed="pushEnabled"
              :class="[
                'relative inline-flex h-6 w-11 items-center rounded-full transition',
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
            </button>
          </div>
        </div>

        <p v-if="pushMessage" class="text-green-600 text-sm mt-3"><i class="fa-solid fa-check mr-1"></i>{{ pushMessage }}</p>
        <p v-if="pushDisabledMessage" class="text-red-500 text-sm mt-3"><i class="fa-solid fa-xmark mr-1"></i>{{ pushDisabledMessage }}</p>
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

        <div v-if="showManualInstructions && installIsAndroid" class="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 leading-relaxed border border-gray-200">
          <p class="font-semibold mb-2">Install on Android:</p>
          <ol class="list-decimal list-inside space-y-1">
            <li>Tap the <strong><i class="fa-solid fa-ellipsis-vertical"></i> three-dots menu</strong> in the top-right of Chrome.</li>
            <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
            <li>Confirm <strong>Install</strong> in the dialog.</li>
          </ol>
          <p class="mt-2 text-gray-500 italic">Doesn't work in private/incognito mode or in-app browsers.</p>
        </div>

        <div v-if="showManualInstructions && !installIsAndroid && !installIsIOS" class="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 leading-relaxed border border-gray-200">
          <p class="font-semibold mb-2">Install on this device:</p>
          <ol class="list-decimal list-inside space-y-1">
            <li>Look for the <strong><i class="fa-solid fa-circle-down"></i> install icon</strong> in the URL bar.</li>
            <li>Or open the browser menu and choose <strong>Install Navitag</strong>.</li>
            <li>Confirm <strong>Install</strong> in the dialog.</li>
          </ol>
        </div>

        <p v-if="installSuccessMessage" class="text-green-600 text-sm mt-3"><i class="fa-solid fa-check mr-1"></i>{{ installSuccessMessage }}</p>
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

      <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h2 class="text-lg font-bold text-gray-800 mb-2">Delete Data and Account</h2>
        <p class="text-xs text-gray-500 mb-4 leading-snug">This is irreversible.</p>

        <button
          type="button"
          @click="handleDeleteClick"
          :disabled="deleteLoading"
          :class="[
            'w-full text-white font-bold py-3 px-4 rounded transition text-sm shadow active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed',
            deleteConfirming ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-400 hover:bg-gray-500',
            deleteLoading ? 'cursor-not-allowed' : 'cursor-pointer'
          ]"
        >
          <i v-if="deleteLoading" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
          {{ deleteLoading ? 'Deleting...' : (deleteConfirming ? 'Confirm Delete' : 'Delete') }}
        </button>

        <p v-if="deleteError" class="text-red-500 text-sm mt-3">{{ deleteError }}</p>
      </div>

      <button
        @click="handleLogout"
        :disabled="logoutLoading"
        class="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-3 px-4 rounded transition cursor-pointer text-sm shadow-sm active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <i :class="logoutLoading ? 'fa-solid fa-circle-notch fa-spin mr-2' : 'fa-solid fa-right-from-bracket mr-2'"></i>
        {{ logoutLoading ? 'Logging out...' : 'Log Out' }}
      </button>

    </div>
  </div>
</template>