<script setup>
import { ref, computed, onMounted, watch, useTemplateRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { useDevicesStore } from '@/stores/devices.js';
import { useUserStore } from '@/stores/user.js';
import { useNotificationsStore } from '@/stores/notifications.js';
import { request } from '@/utils/http.js';
import { categoryMapping, baseUrl } from '@/utils/variables';
import { hasScope } from '@/utils/scopes';
import QrScanner from '@/components/QrScanner.vue';
import SharedBadge from '@/components/SharedBadge.vue';
import PlanPurchaseSheet from '@/components/PlanPurchaseSheet.vue';
import InlineLoader from '@/components/InlineLoader.vue';
import { isIapUiEnabled } from '@/utils/iap';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();
const userStore = useUserStore();
const notifStore = useNotificationsStore();

const deviceId = route.params.id;

// iOS App Store guideline 3.1.1: real StoreKit IAP (via RevenueCat) replaces
// the external-browser Top Up flow on iOS. Plan/Expiration are safe to show
// again now that a native purchase path exists. Android/web keep the
// external Medusa web-checkout Top Up flow. `iapUi` is also true in the
// localhost web review (import.meta.env.DEV) so the native Manage Plan flow can
// be exercised in a browser; it stays false in production web/Android builds.
const iapUi = isIapUiEnabled();
const showPlanSheet = ref(false);

// Get the device from the store
const device = computed(() => deviceStore.devices[deviceId]);

const name = ref('');
const category = ref('');
const speedLimitKph = ref('');
const noSpeedLimit = ref(true);
const loading = ref(false);
const errorMsg = ref('');
const successMsg = ref('');

const isActive = ref(null);

// Owners pass both gates via OWNER_SENTINEL; shared devices need explicit
// energy:read / energy:write in their /share/tome scope list.
const canReadEnergy = computed(() => hasScope(device.value, 'energy:read'));
const canWriteEnergy = computed(() => hasScope(device.value, 'energy:write'));
// Logging an energy event (refuel / charge / odometer / tank) needs BOTH:
// energy:write to POST, and energy:read so the user can see the resulting
// metrics. Without read access, an entry-button click is half-blind.
const canLogEnergy = computed(() => canReadEnergy.value && canWriteEnergy.value);

const isProfileDirty = computed(() => {
  if (!device.value) return false;
  if (name.value.trim() !== (device.value.name || '')) return true;
  if (category.value !== device.value.category) return true;
  const existingKnots = device.value.attributes?.speedLimit;
  const existingHasLimit = !!(existingKnots && existingKnots > 0);
  if (noSpeedLimit.value === existingHasLimit) return true; // mismatch
  if (!noSpeedLimit.value) {
    const currentKph = String(speedLimitKph.value).trim();
    const savedKph = existingHasLimit ? String(Math.round(existingKnots * 1.852)) : '';
    if (currentKph !== savedKph) return true;
  }
  return false;
});

// FCM per-device notification rules sourced from notifStore. Rule keys are
// (device_imei, event_type) and are toggled idempotently via PUT
// /notification/permissions/rule.
const ruleBusy = ref(new Set());
const ruleError = ref('');

const deviceImei = computed(() => device.value?.uniqueId || '');

// Source of truth: notifStore.events is the backend-curated list from
// GET /notification/events. Preserves backend order. Any existing rules for
// this device that aren't in the curated list are appended so we never
// orphan a saved opt-in.
const eventTypesForDevice = computed(() => {
  const imei = deviceImei.value;
  if (!imei) return [];
  const curated = notifStore.events || [];
  const result = [...curated];
  const seen = new Set(curated);
  for (const key of notifStore.rules) {
    const [ruleImei, eventType] = key.split('::');
    if (ruleImei === imei && eventType && !seen.has(eventType)) {
      result.push(eventType);
      seen.add(eventType);
    }
  }
  return result;
});

function humanizeEvent(eventType) {
  if (!eventType) return '';
  if (eventType.startsWith('alarm:')) {
    return humanizeEvent(eventType.slice('alarm:'.length));
  }
  if (eventType.includes(':')) {
    const [prefix, subtype] = eventType.split(':');
    return `${humanizeEvent(prefix)}: ${humanizeEvent(subtype)}`;
  }
  return eventType
    .replace(/[_-]/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

async function toggleRule(eventType) {
  const imei = deviceImei.value;
  if (!imei || ruleBusy.value.has(eventType)) return;

  ruleBusy.value = new Set(ruleBusy.value).add(eventType);
  ruleError.value = '';

  const next = !notifStore.hasRule(imei, eventType);
  try {
    await notifStore.toggleRule(imei, eventType, next);
  } catch (err) {
    ruleError.value = `Failed to ${next ? 'enable' : 'disable'} ${humanizeEvent(eventType)}.`;
  } finally {
    const nextBusy = new Set(ruleBusy.value);
    nextBusy.delete(eventType);
    ruleBusy.value = nextBusy;
  }
}

// Emergency contacts. Backend: GET /contact/device/{imei},
// POST /contact/register, DELETE /contact/{imei}/{contact_auth_uid}.
const contacts = ref([]);
const contactsLoading = ref(false);
const contactsError = ref('');
const contactsExpanded = ref(false);
const notificationsExpanded = ref(false);
const deletingUids = ref(new Set());
const addingContact = ref(false);
const contactScannerRef = useTemplateRef('contactScannerRef');
const contactInfoOpen = ref(false);
const activityLockInfoOpen = ref(false);

// Activity Lock + Auto-Lock toggles. Backend endpoints take the full Traccar
// device object; reconcile UI state from response.traccar after every write.
const autoLockBusy = ref(false);
const activityLockBusy = ref(false);
const lockError = ref('');

const autoLock = computed(() => !!device.value?.attributes?.auto_lock);
const activityLock = computed(() => !!device.value?.attributes?.activity_lock);

async function toggleAutoLock() {
  if (autoLockBusy.value || !device.value) return;
  autoLockBusy.value = true;
  lockError.value = '';
  const res = await deviceStore.setAutoLock(deviceId, !autoLock.value);
  if (!res.ok) lockError.value = 'Auto-lock update failed. Please try again.';
  autoLockBusy.value = false;
}

async function toggleActivityLock() {
  if (activityLockBusy.value || !device.value) return;
  activityLockBusy.value = true;
  lockError.value = '';
  const res = await deviceStore.setActivityLock(deviceId, !activityLock.value);
  if (!res.ok) lockError.value = 'Activity lock update failed. Please try again.';
  activityLockBusy.value = false;
}

async function fetchContacts() {
  const imei = deviceImei.value;
  if (!imei) return;
  contactsLoading.value = true;
  contactsError.value = '';
  try {
    const data = await request.send({
      url: `${baseUrl}/contact/device/${imei}`,
      token: userStore.idToken,
    });
    contacts.value = data?.contacts || [];
  } catch (err) {
    console.error('Failed to fetch contacts:', err);
    contactsError.value = 'Failed to load contacts.';
  } finally {
    contactsLoading.value = false;
  }
}

async function startAddContact() {
  if (addingContact.value) return;
  contactsError.value = '';
  await contactScannerRef.value?.scan();
}

async function onContactScanned(scannedUid) {
  const imei = deviceImei.value;
  const uid = (scannedUid || '').trim();
  if (!imei || !uid) return;
  addingContact.value = true;
  contactsError.value = '';
  try {
    await request.send({
      url: `${baseUrl}/contact/register`,
      method: 'POST',
      data: { device_imei: imei, contact_auth_uid: uid },
      token: userStore.idToken,
    });
    await fetchContacts();
    contactsExpanded.value = true;
  } catch (err) {
    console.error('Failed to register contact:', err);
    contactsError.value = err?.message || 'Failed to add contact.';
  } finally {
    addingContact.value = false;
  }
}

function onContactScanError(err) {
  console.error('QR scan error:', err);
  contactsError.value = 'Failed to scan QR code.';
}

async function deleteContact(authUid) {
  const imei = deviceImei.value;
  if (!imei || !authUid || deletingUids.value.has(authUid)) return;
  deletingUids.value = new Set(deletingUids.value).add(authUid);
  contactsError.value = '';
  try {
    await request.send({
      url: `${baseUrl}/contact/${imei}/${authUid}`,
      method: 'DELETE',
      token: userStore.idToken,
    });
    contacts.value = contacts.value.filter((c) => c.auth_uid !== authUid);
    if (contacts.value.length === 0) contactsExpanded.value = false;
  } catch (err) {
    console.error('Failed to delete contact:', err);
    contactsError.value = 'Failed to delete contact.';
  } finally {
    const next = new Set(deletingUids.value);
    next.delete(authUid);
    deletingUids.value = next;
  }
}

watch(deviceImei, (imei) => {
  if (imei) fetchContacts();
}, { immediate: true });

const KNOTS_PER_KPH = 1 / 1.852;
const SPEED_LIMIT_MAX_KPH = 300;

function onSpeedLimitInput(e) {
  const digitsOnly = e.target.value.replace(/\D+/g, '');
  let next = digitsOnly.replace(/^0+(?=\d)/, '');
  if (next !== '' && Number(next) > SPEED_LIMIT_MAX_KPH) {
    next = String(SPEED_LIMIT_MAX_KPH);
  }
  if (next !== e.target.value) e.target.value = next;
  speedLimitKph.value = next;
}

function onSpeedLimitKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const allowed = ['Backspace', 'Delete', 'Tab', 'Enter', 'Home', 'End', 'ArrowLeft', 'ArrowRight'];
  if (allowed.includes(e.key)) return;
  if (!/^[0-9]$/.test(e.key)) e.preventDefault();
}

function onSpeedLimitPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text') || '';
  const digitsOnly = text.replace(/\D+/g, '');
  let next = (speedLimitKph.value === '' ? '' : String(speedLimitKph.value)) + digitsOnly;
  next = next.replace(/^0+(?=\d)/, '');
  if (next !== '' && Number(next) > SPEED_LIMIT_MAX_KPH) {
    next = String(SPEED_LIMIT_MAX_KPH);
  }
  speedLimitKph.value = next;
}

// Categories supported by your Leaflet component


onMounted(() => {
  notifStore.fetch().catch(() => {});
  if (device.value) {
    name.value = device.value.name || '';
    category.value = device.value.category;
    isActive.value = !device.value.disabled
    const existingKnots = device.value.attributes?.speedLimit;
    if (existingKnots && existingKnots > 0) {
      noSpeedLimit.value = false;
      speedLimitKph.value = Math.round(existingKnots * 1.852);
    } else {
      noSpeedLimit.value = true;
      speedLimitKph.value = '';
    }
    deviceStore.fetchDeviceExpirations();
  } else {
    errorMsg.value = "Device not found.";
  }
});


async function openTopUp() {
  if (iapUi) {
    showPlanSheet.value = true;
    return;
  }
  const url = `https://www.navitag.com/top-up/${device.value.uniqueId}`

  // Native (Android in practice — iOS always takes the IAP sheet above) opens
  // the REAL browser app, not an in-app view. Three things had to line up:
  //
  //   Browser.open()  is a Chrome Custom Tab on Android — styled to look
  //                   external, but still inside our task. Checkout should be
  //                   somewhere the user can see the address bar, use a saved
  //                   password, and keep the tab after leaving the app.
  //   window.open()   would not have escaped either: Capacitor's Android layer
  //                   defines no onCreateWindow, so '_blank' falls through to
  //                   shouldOverrideUrlLoading.
  //   that check      only fires ACTION_VIEW when the host does NOT match
  //                   allowNavigation (Bridge.java) — and www.navitag.com
  //                   matches our '*.navitag.com' entry, so a plain navigation
  //                   loads INSIDE the webview. Narrowing allowNavigation to
  //                   force it out would change routing for every navitag.com
  //                   URL in the app, which is far too blunt for one button.
  //
  // AppLauncher.openUrl is the surgical version: Intent.ACTION_VIEW on Android,
  // UIApplication.open on iOS. It hands off to the system browser and nothing
  // else changes.
  if (Capacitor.isNativePlatform()) {
    await AppLauncher.openUrl({ url })
  } else {
    window.open(url, '_blank')
  }
}

async function toggleDevice (mode = true){
  const ispState = await request.send({
    url: mode ? `${baseUrl}/device/enable` : `${baseUrl}/device/disable`,
    method: 'POST',
    data: { imei: device.value.uniqueId },
    token: userStore.idToken
  });
  return ispState
}

const saveDevice = async () => {
  if (!name.value.trim()) {
    errorMsg.value = 'Device name is required.';
    return;
  }
  
  let kphNum = null;
  if (!noSpeedLimit.value) {
    const kphRaw = String(speedLimitKph.value).trim();
    if (kphRaw === '') {
      errorMsg.value = 'Enter a speed limit or enable "No speed limit".';
      return;
    }
    kphNum = Number(kphRaw);
    if (!Number.isFinite(kphNum) || kphNum <= 0 || kphNum > SPEED_LIMIT_MAX_KPH) {
      errorMsg.value = `Speed limit must be between 1 and ${SPEED_LIMIT_MAX_KPH} km/h.`;
      return;
    }
  }

  loading.value = true;
  errorMsg.value = '';
  successMsg.value = '';

  try {
    // Send ONLY what this screen edits. The API read-modify-writes these onto
    // the live Traccar snapshot, so groupId / uniqueId / phone / model / contact
    // are no longer ours to echo back — sending a stale copy of those is exactly
    // what could clobber live state. `disabled` is owned by /device/enable and
    // /device/disable (see toggleDevice), not by this call.
    const edits = {
      name: name.value.trim(),
      category: category.value ?? null,
      // null clears the limit; the server merges into attributes rather than
      // replacing them, so activity_lock / auto_lock survive untouched.
      speedLimit: noSpeedLimit.value ? null : kphNum * KNOTS_PER_KPH,
    };

    const update = await deviceStore.updateDevice(deviceId, edits);

    if (update) {
      router.push("/")
    } else {
      userStore.error = true
    }

  } catch (err) {
    console.error('Update device error:', err);
    errorMsg.value = err.message || 'Failed to update device settings.';
  } finally {
    loading.value = false;
  }
};

watch(isActive, async (nv, ov) => {
  if(ov === null) {
    //skip
  } else {
    loading.value = true;
    toggleDevice(nv).then( (res) =>{
      //save to tracar
      saveDevice()
    }).catch((e) => {
      //do not save to traccar
      loading.value = false
    })
    

  }
})
</script>

<template>
  <div class="flex flex-col min-h-full bg-surface relative z-10 pointer-events-auto">
    
    <div class="sticky top-0 z-20 bg-white shadow-sm border-b border-gray-200 p-4 flex items-center safe-top">
      <button 
        @click="router.back()" 
        class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors mr-2 outline-none"
      >
        <i class="fa-solid fa-arrow-left text-lg"></i>
      </button>
      <div class="flex items-center gap-2 min-w-0">
        <h1 class="text-lg font-bold text-gray-800 truncate">{{ device?.name ? 'Settings · ' + device.name : 'Device Settings' }}</h1>
        <SharedBadge :device="device" />
      </div>
    </div>

    <div class="p-4 space-y-6 max-w-md mx-auto w-full pb-safe-bottom">
      
      <div v-if="!device" class="text-center text-gray-500 py-10">
        <p v-if="!deviceStore.hasLoadedOnce">Loading…</p>
        <p v-else>Device not found.</p>
      </div>

      <div v-else-if="device.shared" class="text-center text-xs text-gray-500 leading-snug px-6 py-2">
        Only Usage Metrics are available for shared devices. Other settings are reserved for the device owner.
      </div>

      <div v-if="device && !device.shared" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <form @submit.prevent="saveDevice" class="space-y-5">

          <h2 class="text-lg font-bold text-gray-800">Profile</h2>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Device Name</label>
            <div class="relative">
              <i class="fa-solid fa-tag absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input 
                v-model="name"
                type="text" 
                placeholder="e.g. Work Truck, Personal Car" 
                class="w-full pl-11 pr-4 py-3.5 bg-surface border border-gray-200 rounded-xl text-sm font-bold text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Map Icon (Category)</label>
            <div class="grid grid-cols-4 gap-3">
              <div 
                v-for="cat in categoryMapping" 
                :key="cat.server"
                @click="category = cat.server"
                class="flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all active:scale-95"
                :class="category === cat.server ? 'bg-brand-light border-brand text-brand shadow-sm' : 'bg-surface border-gray-200 text-gray-500 hover:bg-gray-100'"
              >
                <i :class="`fa-solid ${cat.icon} text-xl mb-1.5`"></i>
                <span class="text-[9px] font-bold uppercase tracking-wider text-center line-clamp-1">{{ cat.map }}</span>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">Speed Limit</label>

            <div class="p-4 border border-gray-200 rounded-xl mb-3">
              <label class="relative flex items-center justify-between w-full cursor-pointer">
                <input
                  type="checkbox"
                  v-model="noSpeedLimit"
                  class="sr-only peer"
                >
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-light rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                <span class="text-md font-medium text-gray-900">No speed limit</span>
              </label>
            </div>

            <div class="relative" :class="noSpeedLimit ? 'opacity-50 pointer-events-none' : ''">
              <i class="fa-solid fa-gauge-high absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                :value="speedLimitKph"
                @input="onSpeedLimitInput"
                @keydown="onSpeedLimitKeydown"
                @paste="onSpeedLimitPaste"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="3"
                placeholder="e.g. 100"
                :disabled="noSpeedLimit"
                :aria-disabled="noSpeedLimit"
                class="w-full pl-11 pr-16 py-3.5 bg-surface border border-gray-200 rounded-xl text-sm font-bold text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:cursor-not-allowed"
              />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase tracking-wider">km/h</span>
            </div>
          </div>

          <div v-if="errorMsg" class="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2">
            <i class="fa-solid fa-circle-exclamation"></i>
            {{ errorMsg }}
          </div>
          
          <div v-if="successMsg" class="bg-green-50 text-green-600 text-sm p-3 rounded-xl border border-green-100 flex items-center gap-2">
            <i class="fa-solid fa-circle-check"></i>
            {{ successMsg }}
          </div>

          <button
            type="submit"
            :disabled="loading || !isProfileDirty"
            class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-4 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed outline-none mt-4"
          >
            <InlineLoader v-if="loading" />
            {{ loading ? 'Saving…' : 'Save Changes' }}
          </button>
        </form>
      </div>

      <div v-if="device" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <h2 class="text-lg font-bold text-gray-800">Usage Metrics</h2>
        <div class="grid grid-cols-2 gap-3">
          <button
            type="button"
            @click="router.push(`/energy/forms/refuel/${deviceId}`)"
            :disabled="!canLogEnergy"
            class="flex items-center justify-center gap-2 bg-brand-light text-brand py-3 rounded-xl text-sm font-bold hover:bg-brand-light transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-light"
          >
            <i class="fa-solid fa-gas-pump"></i> Log refuel
          </button>
          <button
            type="button"
            @click="router.push(`/energy/forms/recharge/${deviceId}`)"
            :disabled="!canLogEnergy"
            class="flex items-center justify-center gap-2 bg-brand-light text-brand py-3 rounded-xl text-sm font-bold hover:bg-brand-light transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-light"
          >
            <i class="fa-solid fa-bolt"></i> Log charge
          </button>
          <button
            type="button"
            @click="router.push(`/energy/forms/odometer/${deviceId}`)"
            :disabled="!canLogEnergy"
            class="flex items-center justify-center gap-2 bg-surface text-gray-600 py-3 rounded-xl text-sm font-bold hover:bg-gray-100 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface"
          >
            <i class="fa-solid fa-gauge"></i> Odometer
          </button>
          <button
            type="button"
            @click="router.push(`/energy/forms/tank-capacity/${deviceId}`)"
            :disabled="!canLogEnergy"
            class="flex items-center justify-center gap-2 bg-surface text-gray-600 py-3 rounded-xl text-sm font-bold hover:bg-gray-100 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface"
          >
            <i class="fa-solid fa-oil-can"></i> Tank size
          </button>
        </div>
        <button
          type="button"
          @click="router.push(`/energy/logs/${deviceId}`)"
          :disabled="!canReadEnergy"
          class="w-full flex items-center justify-center gap-2 bg-surface text-gray-600 py-3 rounded-xl text-sm font-bold hover:bg-gray-100 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface"
        >
          <i class="fa-solid fa-clock-rotate-left"></i> View log history
        </button>
      </div>

      <div v-if="device && !device.shared" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <h2 class="text-lg font-bold text-gray-800">Status</h2>

        <div class="p-4 border rounded-lg">
          <label
            class="relative flex items-center justify-between w-full"
            :class="device.actionable === false ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
          >
            <input
              type="checkbox"
              v-model="isActive"
              class="sr-only peer"
              :disabled="loading || device.actionable === false"
            >

            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-light rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
            <span class="text-md font-medium text-gray-900">
              {{ isActive ? 'Active' : 'Disabled' }}
            </span>
          </label>
          <p v-if="device.actionable === false" class="text-xs text-gray-500 mt-2">
            This device cannot be toggled at this time.
          </p>
        </div>

        <div class="flex items-center justify-between p-4 border rounded-lg">
          <span class="text-sm text-gray-500">Plan</span>
          <span class="text-sm font-bold text-gray-800 capitalize">{{ device.plan_level || 'N/A' }}</span>
        </div>

        <div class="flex items-center justify-between p-4 border rounded-lg">
          <span class="text-sm text-gray-500">Expiration</span>
          <span class="text-sm font-bold" :class="device.expiration ? 'text-gray-800' : 'text-red-500'">{{ device.expiration ? new Date(device.expiration).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A' }}</span>
        </div>

        <button
          @click="openTopUp"
          class="w-full bg-accent hover:bg-accent/90 text-white font-bold py-3 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <i class="fa-solid fa-bolt"></i>
          Top-Up
        </button>
      </div>

      <PlanPurchaseSheet :show="showPlanSheet" :device="device" @close="showPlanSheet = false" />

      <div v-if="device && !device.shared" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-bold text-gray-800">Activity Lock</h2>
          <div class="relative">
            <button
              type="button"
              tabindex="-1"
              @mouseenter="activityLockInfoOpen = true"
              @mouseleave="activityLockInfoOpen = false"
              aria-label="More info"
              class="w-3 h-3 flex items-center justify-center rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors cursor-help"
            >
              <i class="fa-solid fa-info text-[7px]"></i>
            </button>
            <div
              v-if="activityLockInfoOpen"
              role="tooltip"
              class="absolute top-full left-0 mt-2 w-max max-w-[260px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
            >
              Auto activity lock will engage after we detect that device has stopped.
              <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
            </div>
          </div>
        </div>

        <div class="p-4 border rounded-lg">
          <label class="relative flex items-center justify-between w-full cursor-pointer">
            <input
              type="checkbox"
              :checked="autoLock"
              :disabled="autoLockBusy"
              @change="toggleAutoLock"
              class="sr-only peer"
            >
            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-light rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
            <span class="text-md font-medium text-gray-900 flex items-center gap-2">
              Auto
              <InlineLoader v-if="autoLockBusy" size="xs" class="text-gray-400" />
            </span>
          </label>
        </div>

        <button
          type="button"
          @click="toggleActivityLock"
          :disabled="activityLockBusy"
          :aria-label="activityLock ? 'Activity lock engaged. Tap to unlock.' : 'Activity lock disengaged. Tap to lock.'"
          :aria-pressed="activityLock"
          :class="[
            'w-full py-8 rounded-xl text-white flex items-center justify-center transition-colors shadow-sm active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed',
            activityLock ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-400 hover:bg-gray-500',
          ]"
        >
          <InlineLoader v-if="activityLockBusy" size="4xl" />
          <i v-else :class="activityLock ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'" class="text-4xl"></i>
        </button>

        <p v-if="lockError" class="text-xs text-red-500">{{ lockError }}</p>
      </div>

      <div v-if="device && !device.shared" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-bold text-gray-800">Emergency contact</h2>
            <div class="relative">
              <button
                type="button"
                tabindex="-1"
                @mouseenter="contactInfoOpen = true"
                @mouseleave="contactInfoOpen = false"
                aria-label="More info"
                class="w-3 h-3 flex items-center justify-center rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors cursor-help"
              >
                <i class="fa-solid fa-info text-[7px]"></i>
              </button>
              <div
                v-if="contactInfoOpen"
                role="tooltip"
                class="absolute top-full left-0 mt-2 w-max max-w-[260px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-20 leading-snug pointer-events-none"
              >
                To add your emergency contact he/she must generate their QR code for scanning in their account page.
                <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
              </div>
            </div>
          </div>
          <button
            @click="startAddContact"
            :disabled="addingContact"
            aria-label="Add emergency contact"
            class="w-9 h-9 flex items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark transition-colors shadow-sm active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <InlineLoader v-if="addingContact" />
            <i v-else class="fa-solid fa-plus text-sm"></i>
          </button>
        </div>

        <QrScanner ref="contactScannerRef" @scanned="onContactScanned" @error="onContactScanError" />

        <div v-if="contactsLoading" class="flex items-center justify-center p-3 text-gray-400 text-sm">
          <InlineLoader label="Loading…" />
        </div>

        <div v-else-if="contacts.length === 0" class="text-center text-sm text-gray-500 py-2 leading-snug">
          Add another user's account here and they will be notified if this device registers an impact.
        </div>

        <div v-else>
          <button
            type="button"
            @click="contactsExpanded = !contactsExpanded"
            class="w-full flex items-center justify-between px-1 py-2 cursor-pointer"
          >
            <span class="text-sm font-medium text-gray-800">Total contacts: {{ contacts.length }}</span>
            <i :class="contactsExpanded ? 'fa-chevron-up' : 'fa-chevron-down'" class="fa-solid text-gray-500 text-sm"></i>
          </button>

          <div v-if="contactsExpanded" class="space-y-2 mt-2">
            <div
              v-for="c in contacts"
              :key="c.auth_uid"
              class="flex items-center justify-between p-3 border rounded-lg"
            >
              <div class="flex-1 min-w-0 pr-3">
                <p class="text-sm font-medium text-gray-800 truncate">{{ c.name || 'Unnamed contact' }}</p>
                <p class="text-xs text-gray-500 truncate">{{ c.email_masked }}</p>
              </div>
              <button
                @click="deleteContact(c.auth_uid)"
                :disabled="deletingUids.has(c.auth_uid)"
                aria-label="Delete contact"
                class="w-9 h-9 flex items-center justify-center rounded-full text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <InlineLoader v-if="deletingUids.has(c.auth_uid)" />
                <i v-else class="fa-solid fa-trash text-sm"></i>
              </button>
            </div>
          </div>
        </div>

        <p v-if="contactsError" class="text-xs text-red-500">{{ contactsError }}</p>
      </div>

      <div v-if="device && !device.shared" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 pb-8 mb-8 space-y-4">
        <button
          type="button"
          @click="notificationsExpanded = !notificationsExpanded"
          class="w-full flex items-center justify-between cursor-pointer"
          :aria-expanded="notificationsExpanded"
        >
          <h2 class="text-lg font-bold text-gray-800">Notifications</h2>
          <i :class="notificationsExpanded ? 'fa-chevron-up' : 'fa-chevron-down'" class="fa-solid text-gray-500 text-sm"></i>
        </button>

        <template v-if="notificationsExpanded">
          <div v-if="!notifStore.loaded && notifStore.loading" class="flex items-center justify-center p-6 text-gray-400 text-sm">
            <InlineLoader label="Loading…" />
          </div>

          <div v-else-if="!eventTypesForDevice.length" class="text-center text-gray-500 text-sm py-6">
            No notification types available.
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="ev in eventTypesForDevice"
              :key="ev"
              class="p-4 border rounded-lg"
            >
              <label class="relative flex items-center justify-between w-full cursor-pointer">
                <input
                  type="checkbox"
                  :checked="notifStore.hasRule(deviceImei, ev)"
                  :disabled="ruleBusy.has(ev)"
                  @change="toggleRule(ev)"
                  class="sr-only peer"
                >
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-light rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                <span class="text-md font-medium text-gray-900 flex items-center gap-2">
                  {{ humanizeEvent(ev) }}
                  <InlineLoader v-if="ruleBusy.has(ev)" size="xs" class="text-gray-400" />
                </span>
              </label>
            </div>
          </div>

          <p v-if="ruleError" class="text-xs text-red-500">{{ ruleError }}</p>

          <p v-if="notifStore.loaded && !notifStore.notifications_enabled" class="text-xs text-gray-500 leading-snug">
            Master notifications are off. Rules are saved but no pushes will be delivered until you turn on
            <span class="font-medium">Allow Notifications</span> in account settings.
          </p>
        </template>
      </div>

    </div>
  </div>
</template>