<script setup>
import { ref, computed, watch } from 'vue';
import { useDevicesStore } from '@/stores/devices.js';
import { getPlanOffering, purchasePlan, isIapPreview } from '@/utils/iap';

// True only in the localhost web review (`npm run dev` in a browser). Used to
// show a "simulated purchase" badge and to fake the plan update so the flow can
// be reviewed end to end without a device.
const previewMode = isIapPreview();

// iOS-only native purchase flow (App Store guideline 3.1.1 remediation).
// Reads packages from the RevenueCat "Navitag Data Plans" offering — package
// identifiers follow the dashboard's $rc_custom_<basic|pro>_<months>month
// convention, mirroring the Medusa DATAPLAN-<TIER>-<MONTHS> SKU pattern used
// on Android/web.
const props = defineProps({
  show: { type: Boolean, default: false },
  device: { type: Object, default: null },
});
const emit = defineEmits(['close']);

const deviceStore = useDevicesStore();

const offering = ref(null);
const loadingOffering = ref(false);
const purchasingId = ref(null);
const errorMsg = ref('');
const purchaseSucceeded = ref(false);

const TIER_PATTERN = /^\$rc_custom_(basic|pro)_(\d+)month$/i;

function parsePackage(pkg) {
  const match = TIER_PATTERN.exec(pkg.identifier);
  return {
    pkg,
    tier: match ? match[1].toLowerCase() : 'basic',
    months: match ? Number(match[2]) : 0,
  };
}

const groupedPackages = computed(() => {
  const packages = offering.value?.availablePackages || [];
  const parsed = packages.map(parsePackage).sort((a, b) => a.months - b.months);
  return {
    basic: parsed.filter((p) => p.tier === 'basic'),
    pro: parsed.filter((p) => p.tier === 'pro'),
  };
});

// The sheet opens showing only the device's CURRENT plan_level durations; a
// single button reveals the other tier (upgrade/change). Unknown/missing
// plan_level defaults to basic (matches the web top-up default).
const currentTier = computed(() => {
  const lvl = (props.device?.plan_level || '').toLowerCase();
  return lvl === 'pro' ? 'pro' : 'basic';
});
const otherTier = computed(() => (currentTier.value === 'pro' ? 'basic' : 'pro'));
const currentPackages = computed(() => groupedPackages.value[currentTier.value] || []);
const otherPackages = computed(() => groupedPackages.value[otherTier.value] || []);

// Basic → "Upgrade to Pro"; Pro → generic "Change plan" (reveals Basic).
const changeLabel = computed(() => (currentTier.value === 'basic' ? 'Upgrade to Pro' : 'Change plan'));

// Whether the other tier's durations have been revealed.
const showOtherTier = ref(false);

async function loadOffering() {
  loadingOffering.value = true;
  errorMsg.value = '';
  offering.value = await getPlanOffering();
  if (!offering.value) {
    errorMsg.value = 'Plans are unavailable right now. Please try again later.';
  }
  loadingOffering.value = false;
}

watch(() => props.show, (visible) => {
  if (visible) {
    purchaseSucceeded.value = false;
    errorMsg.value = '';
    showOtherTier.value = false;
    loadOffering();
  }
});

// Fulfillment lands via an async RevenueCat webhook, not in the purchase
// response itself — poll device-expiration a few times so the Plan/
// Expiration rows on the settings page catch up without the user having to
// back out and back in.
async function pollForUpdatedPlan(attempts = 6, delayMs = 2500) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await deviceStore.fetchDeviceExpirations().catch(() => {});
  }
}

// Localhost review only: fake the plan/expiration update so the Current Plan
// row reflects the "purchase" without a real fulfillment webhook. Top-ups
// extend from the later of now / current expiration, mirroring the backend.
function applyPreviewUpdate(entry) {
  const stored = deviceStore.devices?.[props.device.id];
  if (!stored) return;
  const now = new Date();
  const current = stored.expiration ? new Date(stored.expiration) : null;
  const base = current && current > now ? current : now;
  base.setMonth(base.getMonth() + entry.months);
  stored.plan_level = entry.tier;
  stored.expiration = base.toISOString();
}

async function buy(entry) {
  if (purchasingId.value || !props.device) return;
  purchasingId.value = entry.pkg.identifier;
  errorMsg.value = '';

  const result = await purchasePlan({
    device: props.device,
    tier: entry.tier,
    months: entry.months,
    pkg: entry.pkg,
  });
  purchasingId.value = null;

  if (result.cancelled) return;

  if (!result.ok) {
    errorMsg.value = result.error || 'Purchase failed. Please try again.';
    return;
  }

  purchaseSucceeded.value = true;
  if (result.preview) {
    applyPreviewUpdate(entry);
  } else {
    pollForUpdatedPlan();
  }
}

function close() {
  emit('close');
}
</script>

<template>
  <teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-gray-900/50 backdrop-blur-sm">
      <div class="bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto animate-scale-up">
        <div class="sticky top-0 bg-white p-5 pb-3 flex items-center justify-between border-b border-gray-100">
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-bold text-gray-800">Top-Up</h2>
            <span v-if="previewMode" class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-700">
              Preview
            </span>
          </div>
          <button
            @click="close"
            aria-label="Close"
            class="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors outline-none"
          >
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div class="p-5 space-y-5">
          <div v-if="device" class="flex items-center justify-between p-4 border rounded-lg">
            <span class="text-sm text-gray-500">Current Plan</span>
            <span class="text-sm font-bold text-gray-800 capitalize">
              {{ device.plan_level || 'N/A' }}
              <span v-if="device.expiration" class="font-normal text-gray-500">
                · expires {{ new Date(device.expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
              </span>
            </span>
          </div>

          <div v-if="previewMode" class="bg-amber-50 text-amber-700 text-xs p-3 rounded-xl border border-amber-100 flex items-start gap-2">
            <i class="fa-solid fa-flask mt-0.5"></i>
            <span>Localhost review build — prices are the real App Store PH prices, but tapping a plan runs a <strong>simulated</strong> purchase (no charge, no StoreKit). On iOS this opens the real Apple payment sheet.</span>
          </div>

          <div v-if="purchaseSucceeded" class="bg-green-50 text-green-600 text-sm p-3 rounded-xl border border-green-100 flex items-center gap-2">
            <i class="fa-solid fa-circle-check"></i>
            Purchase successful! Your plan will update shortly.
          </div>

          <div v-if="errorMsg" class="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2">
            <i class="fa-solid fa-circle-exclamation"></i>
            {{ errorMsg }}
          </div>

          <div v-if="loadingOffering" class="flex items-center justify-center p-10 text-gray-400 text-sm">
            <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>
            Loading plans…
          </div>

          <template v-else>
            <!-- Current plan_level durations -->
            <div v-if="currentPackages.length">
              <div class="flex items-center gap-2 mb-2">
                <h3 class="text-sm font-bold text-gray-700 uppercase tracking-wider capitalize">{{ currentTier }}</h3>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-500">Your plan</span>
              </div>
              <div class="space-y-2">
                <button
                  v-for="entry in currentPackages"
                  :key="entry.pkg.identifier"
                  type="button"
                  :disabled="!!purchasingId"
                  @click="buy(entry)"
                  class="w-full flex items-center justify-between p-4 border rounded-xl transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:border-brand"
                >
                  <span class="text-sm font-bold text-gray-800">{{ entry.months }} Months</span>
                  <span class="flex items-center gap-2 text-sm font-bold text-brand">
                    <i v-if="purchasingId === entry.pkg.identifier" class="fa-solid fa-circle-notch fa-spin"></i>
                    {{ entry.pkg.product.priceString }}
                  </span>
                </button>
              </div>
            </div>

            <!-- Reveal the other tier (upgrade / change plan) -->
            <button
              v-if="!showOtherTier && otherPackages.length"
              type="button"
              @click="showOtherTier = true"
              class="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-gray-300 text-sm font-bold text-brand hover:bg-brand/5 transition-colors outline-none"
            >
              <i class="fa-solid fa-arrow-up-right-dots"></i>
              {{ changeLabel }}
            </button>

            <!-- Other tier durations (revealed on demand) -->
            <div v-if="showOtherTier && otherPackages.length">
              <div class="flex items-center gap-2 mb-2">
                <h3 class="text-sm font-bold text-gray-700 uppercase tracking-wider capitalize">{{ otherTier }}</h3>
              </div>
              <p class="text-xs text-gray-400 mb-2 leading-relaxed">
                Changing your plan converts your unused allocation to the new tier, added on top of this purchase.
              </p>
              <div class="space-y-2">
                <button
                  v-for="entry in otherPackages"
                  :key="entry.pkg.identifier"
                  type="button"
                  :disabled="!!purchasingId"
                  @click="buy(entry)"
                  class="w-full flex items-center justify-between p-4 border rounded-xl transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed hover:border-brand"
                >
                  <span class="text-sm font-bold text-gray-800">{{ entry.months }} Months</span>
                  <span class="flex items-center gap-2 text-sm font-bold text-brand">
                    <i v-if="purchasingId === entry.pkg.identifier" class="fa-solid fa-circle-notch fa-spin"></i>
                    {{ entry.pkg.product.priceString }}
                  </span>
                </button>
              </div>
            </div>
          </template>
        </div>
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
