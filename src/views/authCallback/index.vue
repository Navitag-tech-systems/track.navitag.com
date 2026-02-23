<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { auth } from '@/firebase';

const route = useRoute();
const router = useRouter();

const mode = route.query.mode;
const actionCode = route.query.oobCode;

const loading = ref(true);
const errorMsg = ref('');
const successMsg = ref('');
const newPassword = ref('');
const showPassword = ref(false);
const showPasswordForm = ref(false);

const validatePassword = (pwd) => {
  if (pwd.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pwd)) return "Must contain at least one uppercase letter.";
  if (!/[0-9]/.test(pwd)) return "Must contain at least one number.";
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) return "Must contain at least one special character.";
  return null;
};

onMounted(async () => {
  if (!mode || !actionCode) {
    errorMsg.value = "Invalid link.";
    loading.value = false;
    return;
  }

  switch (mode) {
    case 'resetPassword':
      await handleResetPasswordInit();
      break;
    case 'verifyEmail':
      await handleVerifyEmail();
      break;
    default:
      errorMsg.value = "Invalid action mode.";
      loading.value = false;
  }
});

const handleResetPasswordInit = async () => {
  try {
    // Basic check to see if code is valid
    await auth.confirmPasswordReset({
        actionCode: actionCode,
        newPassword: 'temporary_check_only' 
    }).catch(e => {
        // If it's just a weak password error, the code is valid
        if (e.code === 'auth/weak-password') return;
        throw e;
    });
    showPasswordForm.value = true;
  } catch (e) {
    errorMsg.value = "Invalid or expired reset link.";
  } finally {
    loading.value = false;
  }
};

const submitNewPassword = async () => {
  const passwordError = validatePassword(newPassword.value);
  if (passwordError) {
    errorMsg.value = passwordError;
    return;
  }

  loading.value = true;
  errorMsg.value = '';
  try {
    await auth.confirmPasswordReset({
      actionCode: actionCode,
      newPassword: newPassword.value
    });
    successMsg.value = "Password updated!";
    setTimeout(() => router.push('/login'), 3000);
  } catch (e) {
    errorMsg.value = e.message;
    loading.value = false;
  }
};

const handleVerifyEmail = async () => {
  try {
    await auth.applyActionCode({ oobCode: actionCode });
    successMsg.value = "Email verified successfully!";
  } catch (e) {
    errorMsg.value = "Verification failed.";
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col items-center justify-center flex-1 p-4 bg-gray-50">
    <div class="w-full max-w-md bg-white p-6 rounded-lg shadow-md text-center">
      
      <div v-if="loading" class="py-4">
        <i class="fa-solid fa-circle-notch fa-spin text-3xl text-blue-600"></i>
        <p class="mt-2 text-gray-600">Processing...</p>
      </div>

      <div v-else-if="errorMsg" class="text-red-500">
        <i class="fa-solid fa-circle-exclamation text-4xl mb-2"></i>
        <p>{{ errorMsg }}</p>
        <RouterLink to="/login" class="block mt-4 text-blue-600 underline">Back to Login</RouterLink>
      </div>

      <div v-else-if="successMsg" class="text-green-600">
        <i class="fa-solid fa-circle-check text-4xl mb-2"></i>
        <p>{{ successMsg }}</p>
        <RouterLink to="/login" class="block mt-4 text-blue-600 underline text-sm">Go to Login</RouterLink>
      </div>

      <div v-else-if="showPasswordForm">
        <h2 class="text-lg font-bold mb-4 text-gray-800 text-left">Set New Password</h2>
        <form @submit.prevent="submitNewPassword" class="text-left">
          <div class="relative mb-1">
            <input 
              v-model="newPassword" 
              :type="showPassword ? 'text' : 'password'" 
              placeholder="Enter new password" 
              class="w-full border p-1 text-sm rounded focus:ring-2 focus:ring-blue-500 outline-none pr-10" 
              required 
            />
            <button 
              type="button"
              @click="showPassword = !showPassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer hover:text-blue-500"
            >
              <i :class="showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
            </button>
          </div>
          <p class="text-[10px] text-gray-400 mb-6 leading-tight italic">
            * Must be 8 characters long, 1 Capital, 1 number, 1 special Character
          </p>
          <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 text-sm rounded shadow hover:bg-blue-700 transition">
            Save Password
          </button>
        </form>
      </div>

    </div>
  </div>
</template>