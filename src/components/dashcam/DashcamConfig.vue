<script setup>
// Dashcam settings: hub WiFi (for parked LAN sync) + cloud upload policy.
//
// Persistence split on purpose:
//   Save            -> PUT /api/devices/{id} with attributes.dashcam (no
//                      password — Traccar attributes are readable by every
//                      account the device is shared with).
//   Send to dashcam -> applyHubWifi(): the SSID + password go to the device
//                      over a command and are never written anywhere. The
//                      password lives only in this component's memory.
// The upload policy is enforced by the backend hub-sync job, so Save alone
// is enough for it; no device command.
import { ref, computed, watch } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import { useToastStore } from '@/stores/toast.js';
import InlineLoader from '@/components/InlineLoader.vue';
import {
  readDashcamSettings, saveDashcamSettings, applyHubWifi, validateHubWifi,
  UPLOAD_POLICIES,
} from '@/utils/dashcam';

const props = defineProps({
  device: { type: Object, required: true },
});

const userStore = useUserStore();
const deviceStore = useDevicesStore();
const toast = useToastStore();
const server = computed(() => userStore.server_url);

const hubSsid = ref('');
const hubPassword = ref('');
const hubSecurity = ref('wpa2-psk');
const uploadPolicy = ref('events');
const uploadNetwork = ref('wifi-only');
const updatedAt = ref(null);
const showPassword = ref(false);

const saving = ref(false);
const sending = ref(false);
const touched = ref(false);

function load() {
  const s = readDashcamSettings(props.device);
  hubSsid.value = s.hubSsid;
  hubSecurity.value = s.hubSecurity;
  uploadPolicy.value = s.uploadPolicy;
  uploadNetwork.value = s.uploadNetwork;
  updatedAt.value = s.updatedAt;
}
watch(() => props.device?.id, load, { immediate: true });

const errors = computed(() => validateHubWifi({
  ssid: hubSsid.value,
  password: hubPassword.value,
  security: hubSecurity.value,
}));
// Save only needs a sane SSID (or none); the password is only checked for Send.
const ssidError = computed(() => (hubSsid.value ? errors.value.ssid : null));
const canSave = computed(() => !saving.value && !ssidError.value);
const canSend = computed(() => !sending.value && Object.keys(errors.value).length === 0 && !!server.value);

async function save() {
  if (!canSave.value || !server.value) return;
  saving.value = true;
  try {
    const updated = await saveDashcamSettings(server.value, props.device, {
      hubSsid: hubSsid.value,
      hubSecurity: hubSecurity.value,
      uploadPolicy: uploadPolicy.value,
      uploadNetwork: uploadNetwork.value,
    });
    if (updated && typeof updated === 'object' && deviceStore.devices[props.device.id]) {
      Object.assign(deviceStore.devices[props.device.id], updated);
    }
    updatedAt.value = new Date().toISOString();
    touched.value = false;
    toast.show('Dashcam settings saved.', { variant: 'success' });
  } catch (err) {
    if (err?.status === 403) {
      toast.show('You can view this dashcam but not change its settings (no write permission on the device).', { variant: 'error', durationMs: 6000 });
    } else {
      toast.show(err?.message || 'Saving failed.', { variant: 'error' });
    }
  } finally {
    saving.value = false;
  }
}

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  try {
    await applyHubWifi(server.value, props.device.id, {
      ssid: hubSsid.value,
      password: hubPassword.value,
      security: hubSecurity.value,
    });
    toast.show('WiFi settings sent to the dashcam.', { variant: 'success' });
  } catch (err) {
    toast.show(err?.status === 403
      ? 'You do not have permission to control this dashcam.'
      : (err?.message || 'Sending failed.'), { variant: 'error' });
  } finally {
    sending.value = false;
  }
}

const updatedLabel = computed(() => updatedAt.value
  ? new Date(updatedAt.value).toLocaleString(undefined, { hour12: false })
  : null);
</script>

<template>
  <div class="space-y-4">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div class="bg-surface px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">Hub WiFi</div>
      <div class="p-4 space-y-4">
        <p class="text-xs text-gray-500 leading-snug">
          The network the dashcam joins when parked, so clips sync over the LAN instead of cellular.
        </p>

        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5">SSID</label>
          <input
            v-model.trim="hubSsid"
            @input="touched = true"
            type="text"
            maxlength="32"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="Network name"
            class="w-full px-4 py-3 bg-surface border rounded-xl text-sm font-bold text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light outline-none"
            :class="ssidError ? 'border-red-300' : 'border-gray-200'"
          />
          <p class="text-[11px] mt-1" :class="ssidError ? 'text-red-500' : 'text-gray-400'">
            {{ ssidError || 'Case-sensitive — must match the hub exactly.' }}
          </p>
        </div>

        <div>
          <label class="block text-sm font-bold text-gray-700 mb-1.5">Security</label>
          <select
            v-model="hubSecurity"
            @change="touched = true"
            class="w-full px-4 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-bold text-gray-700 focus:bg-white focus:border-brand outline-none"
          >
            <option value="wpa2-psk">WPA2-PSK</option>
            <option value="wpa3">WPA3</option>
            <option value="open">Open (no password)</option>
          </select>
        </div>

        <div v-if="hubSecurity !== 'open'">
          <label class="block text-sm font-bold text-gray-700 mb-1.5">Password</label>
          <div class="relative">
            <input
              v-model="hubPassword"
              :type="showPassword ? 'text' : 'password'"
              maxlength="63"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              autocomplete="off"
              placeholder="8–63 characters"
              class="w-full pl-4 pr-12 py-3 bg-surface border rounded-xl text-sm font-bold text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light outline-none"
              :class="hubPassword && errors.password ? 'border-red-300' : 'border-gray-200'"
            />
            <button
              type="button"
              @click="showPassword = !showPassword"
              class="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
            >
              <i class="fa-solid" :class="showPassword ? 'fa-eye-slash' : 'fa-eye'"></i>
            </button>
          </div>
          <p class="text-[11px] mt-1" :class="hubPassword && errors.password ? 'text-red-500' : 'text-gray-400'">
            {{ (hubPassword && errors.password) || 'Sent to the dashcam, not stored. You will need to re-enter it to send again.' }}
          </p>
        </div>

        <button
          type="button"
          @click="send"
          :disabled="!canSend"
          class="w-full bg-surface hover:bg-gray-100 text-gray-700 font-bold py-3 rounded-xl border border-gray-200 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <InlineLoader v-if="sending" />
          <i v-else class="fa-solid fa-paper-plane"></i>
          {{ sending ? 'Sending…' : 'Send to dashcam' }}
        </button>
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div class="bg-surface px-4 py-3 border-b border-gray-100 font-bold text-sm text-gray-700">Cloud upload</div>
      <div class="p-4 space-y-3">
        <label
          v-for="p in UPLOAD_POLICIES"
          :key="p.value"
          class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
          :class="uploadPolicy === p.value ? 'border-brand bg-brand-light' : 'border-gray-200 hover:bg-gray-50'"
        >
          <input
            type="radio"
            name="uploadPolicy"
            :value="p.value"
            v-model="uploadPolicy"
            @change="touched = true"
            class="mt-1 accent-brand"
          />
          <span class="min-w-0">
            <span class="block text-sm font-bold text-gray-800">{{ p.label }}</span>
            <span class="block text-[11px] text-gray-500 leading-snug mt-0.5">{{ p.hint }}</span>
          </span>
        </label>

        <div v-if="uploadPolicy !== 'none'" class="flex items-center justify-between pt-2 border-t border-gray-100">
          <div class="min-w-0 pr-3">
            <p class="text-sm font-bold text-gray-800">Upload over cellular</p>
            <p class="text-[11px] text-gray-500 leading-snug">Off = wait for the hub WiFi.</p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="uploadNetwork === 'cellular'"
            @click="uploadNetwork = uploadNetwork === 'cellular' ? 'wifi-only' : 'cellular'; touched = true"
            class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors"
            :class="uploadNetwork === 'cellular' ? 'bg-brand' : 'bg-gray-300'"
          >
            <span
              class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
              :class="uploadNetwork === 'cellular' ? 'translate-x-6' : 'translate-x-1'"
            ></span>
          </button>
        </div>
      </div>
    </div>

    <button
      type="button"
      @click="save"
      :disabled="!canSave"
      class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3.5 rounded-xl shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <InlineLoader v-if="saving" class="text-white" />
      <i v-else class="fa-solid fa-floppy-disk"></i>
      {{ saving ? 'Saving…' : 'Save' }}
    </button>
    <p class="text-[11px] text-gray-400 text-center">
      <template v-if="updatedLabel">Last saved {{ updatedLabel }}.</template>
      <template v-else>Not saved yet.</template>
      Saving stores the SSID and upload policy only.
    </p>
  </div>
</template>
