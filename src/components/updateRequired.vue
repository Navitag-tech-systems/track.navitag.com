<script setup>
/**
 * Hard version wall. Rendered when GET /app/config returns action='block'.
 *
 * Intentionally offers NO way out — no dismiss, no close, no "later". This
 * appears only when the running build can no longer function correctly against
 * the backend (e.g. after App Check enforcement, when a build that cannot mint
 * an attestation token would otherwise fail every login with an opaque error).
 * A dismiss button here would just return the user to a broken app.
 *
 * z-[100] sits above Loading / Error / NoNet (all z-50) so the wall wins
 * regardless of what else the app decided to show this frame.
 */
import { useAppGateStore } from '@/stores/appGate';

const appGate = useAppGateStore();
</script>

<template>
  <div class="fixed inset-0 z-[100] bg-surface flex flex-col items-center justify-center px-8 text-center pt-safe-top pb-safe-bottom">
    <i class="fa-solid fa-circle-arrow-up text-4xl text-blue-600"></i>

    <h1 class="text-xl font-bold text-gray-800 my-4">
      Update Required
    </h1>

    <p class="text-sm text-gray-500 max-w-xs leading-relaxed">
      {{ appGate.message || 'A required update is available. Please update Navitag Track to continue.' }}
    </p>

    <div class="mt-8 w-full max-w-xs">
      <button
        v-if="appGate.storeUrl"
        class="w-full px-4 py-3 bg-blue-600 text-white rounded-lg text-sm font-semibold cursor-pointer"
        @click="appGate.openStore()"
      >
        Update Now
      </button>
    </div>
  </div>
</template>
