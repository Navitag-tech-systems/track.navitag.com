<script setup>
const props = defineProps({
  msg: {
    type: String,
    default: 'Navitag Track'
  }
})
</script>

<template>
  <div class="fixed inset-0 z-50 bg-gray-100 flex flex-col items-center justify-center pt-safe-top pb-safe-bottom">
    
    <div class="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-500 mb-4"></div>
    
    <p class="text-gray-500">{{ props.msg }}</p>
    
  </div>
</template>