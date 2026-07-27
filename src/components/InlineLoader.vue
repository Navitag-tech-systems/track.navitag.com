<script setup>
/**
 * The one inline loading indicator.
 *
 * Before this there were four idioms across 41 sites — a bordered `animate-spin`
 * div, a hand-rolled inline `<svg class="animate-spin">`, `fa-circle-notch
 * fa-spin`, and `fa-spinner fa-spin` — plus screens that showed no spinner at
 * all while busy. `fa-circle-notch` won because it was already 30 of the 41, so
 * the sweep is mostly deletion.
 *
 * Colour is inherited (Font Awesome renders in `currentColor`), so the call site
 * keeps owning it with a normal text-* class — no `tone` prop to get out of sync
 * with the palette.
 *
 * KEEP THIS A SINGLE ROOT. Most call sites pass a spacing or colour class
 * (`mr-2`, `text-gray-400`) straight through, and a v-if/v-else pair at the root
 * would turn the component into a fragment — which silently disables attribute
 * inheritance and drops every one of those classes.
 *
 * ACCESSIBILITY. With a label it is a live region. Without one it is decorative
 * and hidden — the icon-only form lives inside buttons whose own text already
 * swaps to "Saving…", and announcing both would just stutter.
 */
import { computed } from 'vue';

const props = defineProps({
  // Omit for the icon-only form (inside a button that states its own status).
  label: { type: String, default: '' },
  // The Tailwind text-size suffix, verbatim: xs | sm | md | lg | xl | 2xl | 3xl | 4xl.
  // (`md` maps to text-base.) A prop rather than a pass-through class because the
  // inner <i> carries its own size and would win over anything inherited.
  size: { type: String, default: 'sm' },
});

// There is deliberately no `block`/stacked variant. Every stacked site in the
// app (history report, the two geofence sheets) colours the spinner and its
// caption differently — brand icon, grey or slate caption — which a single
// inherited colour on one root cannot express. Those sites use the icon-only
// form and keep their own <p>.

const SIZES = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '4xl': 'text-4xl',
};

const iconClass = computed(() => SIZES[props.size] || SIZES.sm);
</script>

<template>
  <span
    class="inline-flex items-center gap-2"
    :role="label ? 'status' : undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <i class="fa-solid fa-circle-notch fa-spin" :class="iconClass" aria-hidden="true"></i>
    <span v-if="label">{{ label }}</span>
  </span>
</template>
