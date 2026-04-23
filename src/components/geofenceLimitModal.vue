<script setup>
defineProps({
  show: { type: Boolean, default: false },
});
defineEmits(['close']);
</script>

<template>
  <teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div class="bg-white rounded-3xl shadow-xl p-6 w-full max-w-sm text-center animate-scale-up">
        <div class="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fa-solid fa-lock text-amber-600 text-xl"></i>
        </div>
        <h2 class="text-xl font-bold text-gray-800 mb-2">Geofence Limit Reached</h2>
        <p class="text-sm text-gray-500 mb-6 leading-relaxed">
          You have reached the limit of your geofence creation. Please upgrade to the Pro plan to add more.
        </p>
        <button
          @click="$emit('close')"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm outline-none"
        >
          Got it
        </button>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.animate-scale-up {
  animation: scaleUp 0.2s ease-out forwards;
}
@keyframes scaleUp {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>
