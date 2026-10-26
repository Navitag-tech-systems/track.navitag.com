<script setup>
// Shown on /login and /signup while a business join link is pending, so a
// visitor sent here from /join/:code still sees what they are joining.
import { getPendingJoinInfo } from '@/utils/join';

const pending = getPendingJoinInfo();
</script>

<template>
  <div
    v-if="pending"
    class="mb-4 p-3 rounded-lg bg-brand/10 border border-brand/30 text-sm text-gray-800 leading-snug text-center"
  >
    <i class="fa-solid fa-building text-brand mr-1"></i>
    <template v-if="pending.business_name">Joining <strong>{{ pending.business_name }}</strong></template>
    <template v-else>Joining a business on Navitag</template>
    <p class="text-xs text-gray-500 mt-1">You're added as soon as you sign in.</p>
  </div>
</template>
