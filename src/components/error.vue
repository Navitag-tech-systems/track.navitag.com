<script setup>
/**
 * Transformed Status/Error component.
 * Replaces the animated spinner with Font Awesome icons as requested.
 */
const props = defineProps({
  msg: {
    type: String,
    default: 'Something went wrong.'
  }
})
</script>

<template>
  <div class="fixed inset-0 z-50 bg-surface flex flex-col items-center justify-center pt-safe-top pb-safe-bottom px-6">
    <i class="fa-solid fa-circle-xmark text-4xl text-red-500"></i>

    <h1 class="text-xl font-bold text-gray-800 my-4">Error</h1>

    <p class="text-sm text-gray-500 max-w-xs leading-relaxed text-center">
      {{ props.msg }}
    </p>

    <p class="text-xs text-gray-400 max-w-xs leading-relaxed text-center mt-6">
      Please refresh the page or restart the app to try again.
    </p>
  </div>
</template>