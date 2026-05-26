<script setup>
defineProps({
  device: { type: Object, default: null },
});
</script>

<template>
  <i
    v-if="device?.shared"
    class="fa-solid fa-link text-gray-400 text-xs shrink-0"
    aria-label="Shared with you"
    title="Shared with you"
  ></i>
</template>
