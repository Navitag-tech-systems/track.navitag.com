<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { auth } from '@/firebase';

const route = useRoute();
const router = useRouter();

// Query params from the email link
const mode = route.query.mode; // 'resetPassword', 'verifyEmail', or 'recoverEmail'
const actionCode = route.query.oobCode;

// State
const loading = ref(true);
const errorMsg = ref('');
const successMsg = ref('');
const newPassword = ref('');
const showPasswordForm = ref(false);

onMounted(async () => {
  if (!mode || !actionCode) {
    errorMsg.value = "Invalid link.";
    loading.value = false;
    return;
  }

  // Handle different modes
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

// --- Mode: Reset Password ---
const handleResetPasswordInit = async () => {
  try {
    // Verify the reset code using the plugin
    // This returns the email associated with the code
    const result = await auth.confirmPasswordReset({
        actionCode: actionCode,
        newPassword: 'temporary_check_only' // Some versions require verification first
    });
    showPasswordForm.value = true;
  } catch (e) {
    errorMsg.value = "Invalid or expired reset link.";
  } finally {
    loading.value = false;
  }
};

const submitNewPassword = async () => {
  loading.value = true;
  try {
    // Finalize the password reset via the plugin
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

// --- Mode: Verify Email ---
const handleVerifyEmail = async () => {
  try {
    // Apply the email verification code via the plugin
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
  <div class="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50 pt-safe-top">
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
        <RouterLink to="/login" class="block mt-4 text-blue-600 underline">Go to Login</RouterLink>
      </div>

      <div v-else-if="showPasswordForm">
        <h2 class="text-xl font-bold mb-4">Set New Password</h2>
        <form @submit.prevent="submitNewPassword">
          <input 
            v-model="newPassword" 
            type="password" 
            placeholder="Enter new password" 
            class="w-full border p-2 rounded mb-4" 
            required 
            minlength="6"
          />
          <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 rounded">
            Save Password
          </button>
        </form>
      </div>

    </div>
  </div>
</template>