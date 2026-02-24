<script setup>
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user.js';
import { signOut } from '@/utils/auth';
import { auth } from '@/firebase'; 
import { baseUrl } from '@/utils/variables';
import { CapacitorHttp } from '@capacitor/core';

const router = useRouter();
const userStore = useUserStore();

// Comprehensive country dial codes mapped with ISO codes
const countryCodes = [
  { isos: ['US', 'CA', 'PR'], code: '+1', label: 'US/CA/PR (+1)' },
  { isos: ['RU', 'KZ'], code: '+7', label: 'RU/KZ (+7)' },
  { isos: ['EG'], code: '+20', label: 'EG (+20)' },
  { isos: ['ZA'], code: '+27', label: 'ZA (+27)' },
  { isos: ['GR'], code: '+30', label: 'GR (+30)' },
  { isos: ['NL'], code: '+31', label: 'NL (+31)' },
  { isos: ['BE'], code: '+32', label: 'BE (+32)' },
  { isos: ['FR'], code: '+33', label: 'FR (+33)' },
  { isos: ['ES'], code: '+34', label: 'ES (+34)' },
  { isos: ['HU'], code: '+36', label: 'HU (+36)' },
  { isos: ['IT'], code: '+39', label: 'IT (+39)' },
  { isos: ['RO'], code: '+40', label: 'RO (+40)' },
  { isos: ['CH'], code: '+41', label: 'CH (+41)' },
  { isos: ['AT'], code: '+43', label: 'AT (+43)' },
  { isos: ['GB'], code: '+44', label: 'UK (+44)' },
  { isos: ['DK'], code: '+45', label: 'DK (+45)' },
  { isos: ['SE'], code: '+46', label: 'SE (+46)' },
  { isos: ['NO'], code: '+47', label: 'NO (+47)' },
  { isos: ['PL'], code: '+48', label: 'PL (+48)' },
  { isos: ['DE'], code: '+49', label: 'DE (+49)' },
  { isos: ['PE'], code: '+51', label: 'PE (+51)' },
  { isos: ['MX'], code: '+52', label: 'MX (+52)' },
  { isos: ['AR'], code: '+54', label: 'AR (+54)' },
  { isos: ['BR'], code: '+55', label: 'BR (+55)' },
  { isos: ['CL'], code: '+56', label: 'CL (+56)' },
  { isos: ['CO'], code: '+57', label: 'CO (+57)' },
  { isos: ['MY'], code: '+60', label: 'MY (+60)' },
  { isos: ['AU'], code: '+61', label: 'AU (+61)' },
  { isos: ['ID'], code: '+62', label: 'ID (+62)' },
  { isos: ['PH'], code: '+63', label: 'PH (+63)' },
  { isos: ['NZ'], code: '+64', label: 'NZ (+64)' },
  { isos: ['SG'], code: '+65', label: 'SG (+65)' },
  { isos: ['TH'], code: '+66', label: 'TH (+66)' },
  { isos: ['JP'], code: '+81', label: 'JP (+81)' },
  { isos: ['KR'], code: '+82', label: 'KR (+82)' },
  { isos: ['VN'], code: '+84', label: 'VN (+84)' },
  { isos: ['CN'], code: '+86', label: 'CN (+86)' },
  { isos: ['TR'], code: '+90', label: 'TR (+90)' },
  { isos: ['IN'], code: '+91', label: 'IN (+91)' },
  { isos: ['PK'], code: '+92', label: 'PK (+92)' },
].sort((a, b) => parseInt(a.code.replace('+', '')) - parseInt(b.code.replace('+', ''))); // <-- This handles the numerical sorting

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
    const options = {
      url: `${baseUrl}/user/update`,
      method: 'POST', // Explicitly set the method
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userStore.idToken}`
      },
      data: payload, // In Capacitor, 'data' is used for the request body
    };

    const response = await CapacitorHttp.post(options);
    const data = response.data;

    if (response.status === 'success') {
      profileMessage.value = 'Profile updated successfully.';
      if (payload.name) userStore.name = payload.name;
      if (payload.phone) userStore.phone = payload.phone;
    } else {
      throw new Error('Failed to update profile.');
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

const handleLogout = async () => {
  try {
    await signOut();
    userStore.clearUser();
    router.push('/login');
  } catch (error) {
    console.error('Logout error:', error);
  }
};
</script>

<template>
  <div class="flex flex-col flex-1 bg-gray-50 ">
    
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
              v-model="name" 
              type="text" 
              placeholder="Full Name" 
              class="w-full border p-1 rounded focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <div class="flex space-x-2">
              
              <div class="relative border p-1 rounded bg-white flex items-center justify-center w-[60px] focus-within:ring-2 focus-within:ring-blue-500 overflow-hidden">
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
                class="flex-1 border p-1 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <p v-if="profileMessage" class="text-green-600 text-sm mt-2"><i class="fa-solid fa-check mr-1"></i>{{ profileMessage }}</p>
          <p v-if="profileError" class="text-red-500 text-sm mt-2">{{ profileError }}</p>

          <button 
            type="submit" 
            :disabled="profileLoading"
            class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded transition cursor-pointer text-sm shadow active:scale-[0.98] disabled:opacity-50 mt-2"
          >
            <i v-if="profileLoading" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
            {{ profileLoading ? 'Saving...' : 'Save Profile' }}
          </button>
        </form>
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
              class="w-full border p-1 rounded focus:ring-2 focus:ring-blue-500 outline-none pr-10" 
            />
            <button 
              type="button"
              @click="showPassword = !showPassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer hover:text-blue-500"
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
              class="w-full border p-1 rounded focus:ring-2 focus:ring-blue-500 outline-none pr-10" 
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
            class="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3 px-4 rounded transition cursor-pointer text-sm shadow active:scale-[0.98] disabled:opacity-50 mt-2"
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