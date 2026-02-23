<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: {
    type: String,
    required: true // Expects format: 'YYYY-MM-DD'
  },
  label: {
    type: String,
    default: 'Select Date'
  },
  min: {
    type: String,
    default: undefined
  },
  max: {
    type: String,
    default: undefined
  }
});

const emit = defineEmits(['update:modelValue']);

// Computed property to handle 2-way binding elegantly
const internalValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});
</script>

<template>
  <div class="w-full">
    <label v-if="label" class="block text-sm font-bold text-gray-700 mb-2">
      {{ label }}
    </label>
    
    <div class="relative w-full">
      <i class="fa-regular fa-calendar absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none z-10 text-lg"></i>
      
      <input 
        v-model="internalValue"
        type="date" 
        :min="min"
        :max="max"
        class="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all outline-none appearance-none block"
      />
    </div>
  </div>
</template>

<style scoped>
/* Mobile UX Magic:
  This stretches the native browser calendar icon to cover the entire input field invisibly.
  This ensures that tapping ANYWHERE on the input opens the native iOS/Android date wheel,
  rather than forcing the user to tap a tiny icon on the far right.
*/
input[type="date"]::-webkit-calendar-picker-indicator {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: auto;
  height: auto;
  color: transparent;
  background: transparent;
  cursor: pointer;
  z-index: 20;
}

/* Fallback for formatting text placeholder color when empty on some browsers */
input[type="date"]::-webkit-datetime-edit-fields-wrapper {
  padding: 0;
}
</style>