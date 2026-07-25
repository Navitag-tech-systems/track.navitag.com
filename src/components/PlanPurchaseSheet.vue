<script setup>
import { ref, shallowRef, computed, watch } from 'vue';
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

// shallowRef, NOT ref: a deep `ref` wraps every RevenueCat package in a Vue
// reactive Proxy, and a Proxy does not survive serialization across the
// Capacitor bridge — the native side then sees no `aPackage` dictionary and
// Purchases.purchasePackage rejects with "must provide aPackage parameter".
// The offering is only ever replaced wholesale, never mutated in place, so
// shallow reactivity is sufficient for the computeds that derive from it.
const offering = shallowRef(null);
const loadingOffering = ref(false);
const purchasingId = ref(null);
const errorMsg = ref('');
// Purchase lifecycle: 'idle' → 'processing' (paid, awaiting fulfillment) →
// 'done' (expiration confirmed extended) | 'pending' (paid, webhook slow).
const phase = ref('idle');

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

// The sheet shows ONE tier at a time — a toggle, not two stacked lists.
// showOtherTier false → the device's current tier; true → the opposite tier.
const showOtherTier = ref(false);
const displayedTier = computed(() => (showOtherTier.value ? otherTier.value : currentTier.value));
const displayedPackages = computed(() => (showOtherTier.value ? otherPackages.value : currentPackages.value));

// Single toggle button. Label depends on the device's plan AND which tier is
// currently shown:
//   basic device → "Get to pro plans" (show pro) / "Stay with basic" (go back)
//   pro device   → "Change to basic"  (show basic) / "Stay with pro"  (go back)
const toggleLabel = computed(() => {
  if (currentTier.value === 'basic') {
    return showOtherTier.value ? 'Stay with basic' : 'Get Pro Plans';
  }
  return showOtherTier.value ? 'Stay with pro' : 'Change to basic';
});

// Radio-style selection: tapping a duration only SELECTS it; the Buy Now button
// commits the purchase. selectedEntry is the currently-picked package, or null.
const selectedId = ref(null);
const selectedEntry = computed(
  () => displayedPackages.value.find((e) => e.pkg.identifier === selectedId.value) || null,
);

// Switching tiers re-defaults the pick to the 3-month option of the newly shown
// tier (handled by the displayedPackages watcher below).
function toggleTier() {
  showOtherTier.value = !showOtherTier.value;
}

// Once Buy Now is tapped, the sheet leaves the selection UI and shows ONLY the
// purchase status (spinner → blue/green/amber). Errors and cancellations reset
// phase to 'idle' with purchasingId cleared, which returns to selection.
const showStatus = computed(() => !!purchasingId.value || phase.value !== 'idle');

// The spinner is up while paying or extending — no exit during that window
// (the header ✕ is hidden; Close only appears once settled/timed out).
const isProcessing = computed(() => !!purchasingId.value || phase.value === 'processing');

// The 3-month price for a tier, from the loaded offering — used for the
// tier-change conversion ratio below. Prefers the numeric StoreProduct.price,
// falls back to parsing priceString (covers the localhost preview mock).
function threeMonthPrice(tier) {
  const list = groupedPackages.value[tier] || [];
  const three = list.find((e) => e.months === 3) || list[0];
  const p = three?.pkg?.product;
  if (p?.price != null && !Number.isNaN(Number(p.price))) return Number(p.price);
  const n = parseFloat(String(p?.priceString || '').replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? null : n;
}

// Whether buying `entry` converts an already-active plan to a different tier —
// i.e. the shown date is the backend's value-preserving *estimate*, not an exact
// top-up. Drives the "est." prefix on the card (and the conversion math below).
function isConversionEstimate(entry) {
  const now = new Date();
  const current = props.device?.expiration ? new Date(props.device.expiration) : null;
  const hasActive = current && current > now;
  const curPrice = threeMonthPrice(currentTier.value);
  const tgtPrice = threeMonthPrice(entry.tier);
  return !!(entry.tier !== currentTier.value && hasActive && curPrice && tgtPrice);
}

// Estimated new expiration if this duration is bought now.
//  • Same tier: top-ups stack — extend from the later of today / current
//    expiration (mirrors applyPreviewUpdate). Exact.
//  • Tier change (upgrade/downgrade): the backend converts the remaining paid
//    time by the 3-month price ratio (currentTier/targetTier) and rebases from
//    today (api.navitag.net Webhook.php::dataRenew). We mirror that so the
//    preview matches reality — the basic₃/pro₃ ratio is identical on-device and
//    in Medusa (both web×1.2). Accurate to about a day (no server tz / −2
//    buffer), so the card flags it "est." via isConversionEstimate.
// Display-only estimate.
function estimatedExpiration(entry) {
  const now = new Date();
  const current = props.device?.expiration ? new Date(props.device.expiration) : null;
  const hasActive = current && current > now;
  const isTierChange = isConversionEstimate(entry);

  const result = new Date(isTierChange || !hasActive ? now : current);
  result.setMonth(result.getMonth() + entry.months);
  if (isTierChange) {
    const curPrice = threeMonthPrice(currentTier.value);
    const tgtPrice = threeMonthPrice(entry.tier);
    const remainingDays = Math.max(0, Math.floor((current.getTime() - now.getTime()) / 86400000));
    result.setDate(result.getDate() + Math.floor(remainingDays * (curPrice / tgtPrice)));
  }
  return result.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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
    phase.value = 'idle';
    errorMsg.value = '';
    showOtherTier.value = false;
    selectedId.value = null;
    loadOffering();
  }
});

// Always default the pick to the 3-month option (fallback: first/cheapest)
// whenever the shown list changes — i.e. on open once the offering loads, and
// on every tier switch.
watch(displayedPackages, (pkgs) => {
  if (!pkgs.length) return;
  const preferred = pkgs.find((e) => e.months === 3) || pkgs[0];
  selectedId.value = preferred.pkg.identifier;
});

// Fulfillment lands via an async RevenueCat webhook (order → data-renew →
// device_inventory), NOT in the StoreKit purchase response. So after payment we
// poll device-expiration until the stored expiration CHANGES (or plan_level
// changes) — that transition is the real "top-up complete" signal. Same-tier
// top-ups push the expiration later; a tier UPGRADE (basic→pro) converts unused
// allocation to the pricier tier and can move the expiration EARLIER, so we
// detect any change in either direction (guarded against a transient null/0),
// not just an advance. Returns false if nothing landed within the window
// (webhook slow or failed); the caller then shows a "will update shortly"
// state, never a false "done".
async function waitForFulfillment(prevExpiration, prevPlan, attempts = 16, delayMs = 1500) {
  const prevMs = prevExpiration ? new Date(prevExpiration).getTime() : 0;
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await deviceStore.fetchDeviceExpirations().catch(() => {});
    const d = deviceStore.devices?.[props.device.id];
    const nowMs = d?.expiration ? new Date(d.expiration).getTime() : 0;
    if ((nowMs && nowMs !== prevMs) || (d && d.plan_level !== prevPlan)) return true;
  }
  return false;
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
  if (purchasingId.value || !props.device || !entry) return;
  purchasingId.value = entry.pkg.identifier;
  errorMsg.value = '';
  phase.value = 'idle';

  // Snapshot before paying so waitForFulfillment can detect the extension —
  // top-ups stack on an already-active plan (the backend just pushes the
  // expiration further out), so we diff against these, not against "no plan".
  const beforeExpiration = props.device.expiration;
  const beforePlan = props.device.plan_level;

  const result = await purchasePlan({
    device: props.device,
    tier: entry.tier,
    months: entry.months,
    pkg: entry.pkg,
  });
  purchasingId.value = null;

  if (result.cancelled) {
    // Don't dump silently back to the cards — after a full-screen native sheet
    // that reads as "it just closed". Show an explicit cancelled state.
    phase.value = 'cancelled';
    return;
  }

  if (!result.ok) {
    errorMsg.value = result.error || 'Purchase failed. Please try again.';
    phase.value = 'error';
    return;
  }

  // Payment succeeded. Preview has no webhook, so fake the extension and report
  // done immediately; on iOS, wait for the real expiration to move before we
  // claim the plan actually changed.
  if (result.preview) {
    applyPreviewUpdate(entry);
    phase.value = 'done';
    return;
  }

  phase.value = 'processing';
  phase.value = (await waitForFulfillment(beforeExpiration, beforePlan)) ? 'done' : 'pending';
}

// After a failed/cancelled purchase, return to the selection view so the user
// can retry without reopening the sheet (the current selection is kept).
function tryAgain() {
  errorMsg.value = '';
  phase.value = 'idle';
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
            v-if="!isProcessing"
            @click="close"
            aria-label="Close"
            class="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors outline-none"
          >
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div class="p-5 space-y-5">

          <!-- STATUS VIEW: after Buy Now, everything else is hidden. -->
          <div v-if="showStatus" class="flex flex-col items-center text-center py-6 space-y-5">
            <!-- Paying / extending: spinner + (blue) processing feedback -->
            <template v-if="purchasingId || phase === 'processing'">
              <i class="fa-solid fa-circle-notch fa-spin text-4xl text-brand"></i>
              <p v-if="purchasingId" class="text-sm text-gray-500">Processing your purchase…</p>
              <div v-else class="w-full bg-blue-50 text-blue-600 text-sm p-3 rounded-xl border border-blue-100 flex items-center justify-center gap-2">
                <i class="fa-solid fa-circle-notch fa-spin"></i>
                Payment received — extending your plan…
              </div>
            </template>

            <!-- Done: green feedback -->
            <template v-else-if="phase === 'done'">
              <i class="fa-solid fa-circle-check text-4xl text-green-500"></i>
              <div class="w-full bg-green-50 text-green-600 text-sm p-3 rounded-xl border border-green-100 flex items-center justify-center gap-2">
                <i class="fa-solid fa-circle-check"></i>
                <span>Top-up complete! Your plan now runs to
                {{ device?.expiration ? new Date(device.expiration).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'the new date' }}.</span>
              </div>
            </template>

            <!-- Pending / timeout: amber feedback -->
            <template v-else-if="phase === 'pending'">
              <i class="fa-solid fa-clock text-4xl text-amber-500"></i>
              <div class="w-full bg-amber-50 text-amber-700 text-sm p-3 rounded-xl border border-amber-100 flex items-center justify-center gap-2">
                <i class="fa-solid fa-clock"></i>
                Payment received. Your plan will update shortly.
              </div>
            </template>

            <!-- Cancelled: neutral; you were not charged. Offer retry. -->
            <template v-else-if="phase === 'cancelled'">
              <i class="fa-solid fa-circle-xmark text-4xl text-gray-400"></i>
              <div class="w-full bg-gray-50 text-gray-600 text-sm p-3 rounded-xl border border-gray-200 flex items-center justify-center gap-2">
                Purchase cancelled — you were not charged.
              </div>
            </template>

            <!-- Error / failed purchase: red; the purchase did not go through. -->
            <template v-else-if="phase === 'error'">
              <i class="fa-solid fa-circle-exclamation text-4xl text-red-500"></i>
              <div class="w-full bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center justify-center gap-2">
                <i class="fa-solid fa-circle-exclamation"></i>
                <span>{{ errorMsg || 'Purchase not completed. Please try again.' }}</span>
              </div>
            </template>

            <!-- Retry after a failed/cancelled purchase (returns to selection). -->
            <button
              v-if="phase === 'error' || phase === 'cancelled'"
              type="button"
              @click="tryAgain"
              class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm active:scale-[0.98] outline-none"
            >
              Try again
            </button>
            <!-- Close appears once settled (green/amber) or after a failure/cancel. -->
            <button
              v-if="phase === 'done' || phase === 'pending' || phase === 'error' || phase === 'cancelled'"
              type="button"
              @click="close"
              :class="phase === 'error' || phase === 'cancelled'
                ? 'w-full text-gray-500 font-bold py-3 rounded-xl hover:bg-gray-100 transition-colors outline-none'
                : 'w-full bg-brand hover:bg-brand-dark text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm active:scale-[0.98] outline-none'"
            >
              Close
            </button>
          </div>

          <!-- SELECTION VIEW: pick a duration, then Buy Now. -->
          <template v-else>
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
              <span>Localhost review build — prices are the real App Store PH prices, but tapping Buy Now runs a <strong>simulated</strong> purchase (no charge, no StoreKit). On iOS this opens the real Apple payment sheet.</span>
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
              <!-- One tier at a time; the toggle below swaps which one is shown. -->
              <div v-if="displayedPackages.length">
                <div class="flex items-center gap-2 mb-2">
                  <h3 class="text-sm font-bold text-gray-700 uppercase tracking-wider capitalize">{{ displayedTier }}</h3>
                  <span v-if="!showOtherTier" class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-500">Your plan</span>
                </div>
                <p v-if="showOtherTier" class="text-xs text-gray-400 mb-2 leading-relaxed">
                  Changing your plan converts your unused allocation to the new tier, added on top of this purchase.
                </p>
                <!-- Radio-style selection: tap to select, Buy Now to purchase. -->
                <div class="space-y-2">
                  <button
                    v-for="entry in displayedPackages"
                    :key="entry.pkg.identifier"
                    type="button"
                    @click="selectedId = entry.pkg.identifier"
                    class="w-full flex items-center justify-between p-4 border rounded-xl transition-colors active:scale-[0.98]"
                    :class="selectedId === entry.pkg.identifier ? 'border-brand ring-2 ring-brand-light bg-brand/5' : 'border-gray-200 hover:border-brand'"
                  >
                    <span class="flex items-center gap-3">
                      <span
                        class="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                        :class="selectedId === entry.pkg.identifier ? 'border-brand' : 'border-gray-300'"
                      >
                        <span v-if="selectedId === entry.pkg.identifier" class="w-2.5 h-2.5 rounded-full bg-brand"></span>
                      </span>
                      <span class="flex flex-col items-start">
                        <span class="text-sm font-bold text-gray-800">{{ entry.months }} Months</span>
                        <span class="text-[11px] font-normal text-gray-400 mt-0.5">{{ isConversionEstimate(entry) ? 'est. ' : '' }}expires on {{ estimatedExpiration(entry) }}</span>
                      </span>
                    </span>
                    <span class="text-sm font-bold text-brand">{{ entry.pkg.product.priceString }}</span>
                  </button>
                </div>
              </div>

              <!-- Buy Now: commits the selected duration (the real purchase). -->
              <button
                type="button"
                :disabled="!selectedEntry"
                @click="buy(selectedEntry)"
                class="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed outline-none"
              >
                <i class="fa-solid fa-bolt"></i>
                Buy Now<span v-if="selectedEntry"> · {{ selectedEntry.pkg.product.priceString }}</span>
              </button>

              <!-- Single toggle: swaps between the current tier and the other tier. -->
              <button
                v-if="otherPackages.length"
                type="button"
                @click="toggleTier"
                class="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-gray-300 text-sm font-bold text-brand hover:bg-brand/5 transition-colors outline-none"
              >
                <i class="fa-solid" :class="showOtherTier ? 'fa-arrow-left' : 'fa-arrow-up-right-dots'"></i>
                {{ toggleLabel }}
              </button>
            </template>
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
