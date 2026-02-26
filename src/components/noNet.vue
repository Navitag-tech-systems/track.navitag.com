<script setup>
/**
 * Transformed Status/Error component.
 * Replaces the animated spinner with Font Awesome icons as requested.
 */
const props = defineProps({
  msg: {
    type: String,
    default: 'App Requires Active Internet Connection'
  }
})
</script>

<template>
  <div class="fixed inset-0 z-50 bg-gray-100 flex flex-col items-center justify-center pt-safe-top pb-safe-bottom">
    <i  class="fa-solid fa-ban text-4xl text-yellow-500"></i>
    
    <h1 class="text-xl font-bold text-gray-800 my-4">
      OFFLINE
    </h1>
    
    <p class="text-sm text-gray-500 max-w-xs leading-relaxed">
      {{ props.msg }}
    </p>

    <div class="mt-8 w-full max-w-xs">
      <slot name="action"></slot>
    </div>
    
  </div>
</template>