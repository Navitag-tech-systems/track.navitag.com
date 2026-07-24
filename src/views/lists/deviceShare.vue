<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevicesStore } from '@/stores/devices.js';
import { useUserStore } from '@/stores/user.js';
import { useToastStore } from '@/stores/toast.js';
import { request } from '@/utils/http.js';
import { baseUrl } from '@/utils/variables';
import { GRANTABLE_SCOPES, SCOPE_LABELS } from '@/utils/scopes';

const route = useRoute();
const router = useRouter();
const deviceStore = useDevicesStore();
const userStore = useUserStore();
const toast = useToastStore();

const deviceId = route.params.id;
const device = computed(() => deviceStore.devices[deviceId]);
const deviceImei = computed(() => device.value?.uniqueId || '');

// ---- Invite form state ----
const inviteScopes = ref(new Set());
const inviteEmail = ref('');
const inviteSending = ref(false);
const shareInfoOpen = ref(false);

function hasInviteScope(scope) {
  return inviteScopes.value.has(scope);
}
function toggleInviteScope(scope) {
  const next = new Set(inviteScopes.value);
  if (next.has(scope)) next.delete(scope);
  else next.add(scope);
  inviteScopes.value = next;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmailValid = computed(() => EMAIL_RE.test(inviteEmail.value.trim()));
const canSendInvite = computed(
  () => !inviteSending.value && !!deviceImei.value && isEmailValid.value
);

async function sendInvite() {
  if (!canSendInvite.value) return;
  inviteSending.value = true;
  try {
    const scopes = ['position:live', ...inviteScopes.value];
    await request.send({
      url: `${baseUrl}/share/invite`,
      method: 'POST',
      data: {
        devices: [deviceImei.value],
        scopes,
        target_email: inviteEmail.value.trim(),
      },
      token: userStore.idToken,
    });
    toast.show('Invite sent.', { variant: 'success' });
    inviteEmail.value = '';
    inviteScopes.value = new Set();
    fetchPendingInvites();
  } catch (err) {
    console.error('Failed to send invite:', err);
    toast.show('Failed to send invite.', { variant: 'error' });
  } finally {
    inviteSending.value = false;
  }
}

// ---- Shared With state ----
const grants = ref([]);
const loading = ref(false);
const errorMsg = ref('');

// ---- Pending invites state ----
const pendingInvites = ref([]);
const pendingLoading = ref(false);
const pendingError = ref('');

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
}

async function fetchPendingInvites() {
  const imei = deviceImei.value;
  if (!imei) return;
  pendingLoading.value = true;
  pendingError.value = '';
  try {
    const data = await request.send({
      url: `${baseUrl}/share/invites/pending`,
      method: 'POST',
      data: { device_imei: imei },
      token: userStore.idToken,
    });
    pendingInvites.value = data?.invites || data?.pending || [];
  } catch (err) {
    console.error('Failed to fetch /share/invites/pending:', err);
    pendingError.value = 'Failed to load pending invitations.';
  } finally {
    pendingLoading.value = false;
  }
}

const pendingScopes = ref({});
const savingUids = ref(new Set());
const revokingUids = ref(new Set());
const expandedUids = ref(new Set());

function isExpanded(uid) {
  return expandedUids.value.has(uid);
}

function toggleExpanded(uid) {
  const next = new Set(expandedUids.value);
  if (next.has(uid)) next.delete(uid);
  else next.add(uid);
  expandedUids.value = next;
}

function formatScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  if (!list.length) return 'No access';
  return list.map((s) => SCOPE_LABELS[s] || s).join(', ');
}

function normalizeScopes(scopes) {
  const set = new Set(Array.isArray(scopes) ? scopes : []);
  set.add('position:live');
  return Array.from(set);
}

function seedPending(rows) {
  const next = {};
  for (const g of rows) {
    next[g.grantee_auth_uid] = normalizeScopes(g.scopes);
  }
  pendingScopes.value = next;
}

function hasScope(uid, scope) {
  return (pendingScopes.value[uid] || []).includes(scope);
}

function toggleScope(uid, scope) {
  const current = pendingScopes.value[uid] || [];
  const set = new Set(current);
  if (set.has(scope)) set.delete(scope);
  else set.add(scope);
  set.add('position:live');
  pendingScopes.value = { ...pendingScopes.value, [uid]: Array.from(set) };
}

function originalScopes(uid) {
  const g = grants.value.find((x) => x.grantee_auth_uid === uid);
  return g ? normalizeScopes(g.scopes) : [];
}

function isDirty(uid) {
  const orig = new Set(originalScopes(uid));
  const pend = new Set(pendingScopes.value[uid] || []);
  if (orig.size !== pend.size) return true;
  for (const s of orig) if (!pend.has(s)) return true;
  return false;
}

async function fetchGrants() {
  const imei = deviceImei.value;
  if (!imei) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    const data = await request.send({
      url: `${baseUrl}/share/byme`,
      method: 'POST',
      data: { device_imei: imei },
      token: userStore.idToken,
    });
    grants.value = data?.granted || [];
    seedPending(grants.value);
  } catch (err) {
    console.error('Failed to fetch /share/byme:', err);
    errorMsg.value = 'Failed to load sharing list.';
  } finally {
    loading.value = false;
  }
}

async function revokeShare(uid) {
  if (!uid || revokingUids.value.has(uid)) return;
  const imei = deviceImei.value;
  if (!imei) return;

  revokingUids.value = new Set(revokingUids.value).add(uid);
  try {
    await request.send({
      url: `${baseUrl}/share/revoke`,
      method: 'POST',
      data: { target_firebase_uid: uid, devices: [imei] },
      token: userStore.idToken,
    });
    grants.value = grants.value.filter((g) => g.grantee_auth_uid !== uid);
    const nextPending = { ...pendingScopes.value };
    delete nextPending[uid];
    pendingScopes.value = nextPending;
    const nextExpanded = new Set(expandedUids.value);
    nextExpanded.delete(uid);
    expandedUids.value = nextExpanded;
    toast.show('Access revoked.', { variant: 'success' });
  } catch (err) {
    console.error('Failed to revoke share:', err);
    toast.show('Failed to revoke access.', { variant: 'error' });
  } finally {
    const next = new Set(revokingUids.value);
    next.delete(uid);
    revokingUids.value = next;
  }
}

async function savePermissions(uid) {
  if (!uid || savingUids.value.has(uid) || !isDirty(uid)) return;
  const imei = deviceImei.value;
  if (!imei) return;

  savingUids.value = new Set(savingUids.value).add(uid);
  try {
    const nextScopes = normalizeScopes(pendingScopes.value[uid] || []);
    await request.send({
      url: `${baseUrl}/share/update`,
      method: 'POST',
      data: {
        target_firebase_uid: uid,
        device_imei: imei,
        scopes: nextScopes,
      },
      token: userStore.idToken,
    });
    grants.value = grants.value.map((g) =>
      g.grantee_auth_uid === uid ? { ...g, scopes: nextScopes } : g
    );
    toast.show('Permissions updated.', { variant: 'success' });
  } catch (err) {
    console.error('Failed to update share permissions:', err);
    toast.show('Failed to update permissions.', { variant: 'error' });
  } finally {
    const next = new Set(savingUids.value);
    next.delete(uid);
    savingUids.value = next;
  }
}

watch(deviceImei, (imei) => {
  if (imei) {
    fetchGrants();
    fetchPendingInvites();
  }
}, { immediate: true });

onMounted(() => {
  if (!device.value) {
    errorMsg.value = 'Device not found.';
  }
});
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
      <h1 class="text-lg font-bold text-gray-800 truncate">Share {{ device?.name || 'Device' }}</h1>
    </div>

    <div class="p-4 space-y-6 max-w-md mx-auto w-full pb-safe-bottom">

      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-bold text-gray-800">Share This Device</h2>
          <div class="relative">
            <button
              type="button"
              tabindex="-1"
              @mouseenter="shareInfoOpen = true"
              @mouseleave="shareInfoOpen = false"
              aria-label="More info"
              class="w-3 h-3 flex items-center justify-center rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors cursor-help"
            >
              <i class="fa-solid fa-info text-[7px]"></i>
            </button>
            <div
              v-if="shareInfoOpen"
              role="tooltip"
              class="absolute top-full left-0 mt-2 w-max max-w-[260px] p-2 text-xs text-white bg-gray-900 rounded-md shadow-lg z-30 leading-snug pointer-events-none"
            >
              Give other users access to this device until you revoke it.
              <div class="absolute -top-1 left-2 w-2 h-2 bg-gray-900 rotate-45"></div>
            </div>
          </div>
        </div>

        <div>
          <label class="block text-sm font-bold text-gray-700 mb-2">Permissions</label>
          <div class="space-y-2 p-3 border border-gray-200 rounded-xl bg-surface">
            <label class="flex items-center gap-2 text-sm text-gray-400 cursor-not-allowed">
              <input
                type="checkbox"
                :checked="true"
                disabled
                class="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand-light"
              />
              <span>Live position</span>
              <span class="text-[10px] uppercase tracking-wider text-gray-400">required</span>
              <i class="fa-solid fa-eye text-gray-400 ml-auto"></i>
            </label>
            <label
              v-for="opt in GRANTABLE_SCOPES"
              :key="opt.key"
              class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
            >
              <input
                type="checkbox"
                :checked="hasInviteScope(opt.key)"
                :disabled="inviteSending"
                @change="toggleInviteScope(opt.key)"
                class="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand-light"
              />
              <span>{{ opt.label }}</span>
              <i :class="['fa-solid', opt.icon]" class="text-gray-400 ml-auto"></i>
            </label>
          </div>
        </div>

        <div>
          <label class="block text-sm font-bold text-gray-700 mb-2">Email Address</label>
          <div class="relative">
            <i class="fa-solid fa-envelope absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input
              v-model="inviteEmail"
              type="email"
              autocomplete="email"
              placeholder="friend@example.com"
              :disabled="inviteSending"
              class="w-full pl-11 pr-4 py-3 bg-surface border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:bg-white focus:border-brand focus:ring-2 focus:ring-brand-light transition-all outline-none disabled:opacity-60"
            />
          </div>
          <p v-if="inviteEmail && !isEmailValid" class="text-xs text-red-500 mt-1.5">
            Please enter a valid email address.
          </p>
        </div>

        <button
          type="button"
          @click="sendInvite"
          :disabled="!canSendInvite"
          class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i v-if="inviteSending" class="fa-solid fa-circle-notch fa-spin"></i>
          <i v-else class="fa-solid fa-paper-plane"></i>
          {{ inviteSending ? 'Sending…' : 'Send Invite' }}
        </button>
      </div>

      <div v-if="!device" class="text-center text-gray-500 py-10">
        <p>Loading device data...</p>
      </div>

      <div v-if="device" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-gray-800">Shared With</h2>
          <span v-if="!loading" class="text-xs font-bold text-gray-400">
            {{ grants.length }}
          </span>
        </div>

        <div v-if="loading" class="flex items-center justify-center p-6 text-gray-400 text-sm">
          <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>
          Loading…
        </div>

        <div v-else-if="errorMsg" class="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2">
          <i class="fa-solid fa-circle-exclamation"></i>
          {{ errorMsg }}
        </div>

        <div v-else-if="grants.length === 0" class="text-center text-sm text-gray-500 py-4 leading-snug">
          This device is not shared to anyone.
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="g in grants"
            :key="g.grantee_auth_uid"
            class="p-3 border rounded-lg space-y-3"
          >
            <button
              type="button"
              @click="toggleExpanded(g.grantee_auth_uid)"
              class="w-full flex items-center justify-between gap-3 cursor-pointer"
              :aria-expanded="isExpanded(g.grantee_auth_uid)"
            >
              <div class="flex-1 min-w-0 text-left">
                <p class="text-sm font-medium text-gray-800 truncate">
                  {{ g.grantee_name || g.grantee_email || 'Unknown user' }}
                </p>
                <p v-if="g.grantee_name && g.grantee_email" class="text-xs text-gray-500 truncate">
                  {{ g.grantee_email }}
                </p>
              </div>
              <i :class="isExpanded(g.grantee_auth_uid) ? 'fa-chevron-up' : 'fa-chevron-down'" class="fa-solid text-gray-500 text-sm shrink-0"></i>
            </button>

            <div v-if="isExpanded(g.grantee_auth_uid)" class="pl-1 space-y-3">
              <div class="space-y-2">
                <label class="flex items-center gap-2 text-sm text-gray-400 cursor-not-allowed">
                  <input
                    type="checkbox"
                    :checked="true"
                    disabled
                    class="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand-light"
                  />
                  <span>Live position</span>
                  <span class="text-[10px] uppercase tracking-wider text-gray-400">required</span>
                  <i class="fa-solid fa-eye text-gray-400 ml-auto"></i>
                </label>

                <label
                  v-for="opt in GRANTABLE_SCOPES"
                  :key="opt.key"
                  class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    :checked="hasScope(g.grantee_auth_uid, opt.key)"
                    :disabled="savingUids.has(g.grantee_auth_uid) || revokingUids.has(g.grantee_auth_uid)"
                    @change="toggleScope(g.grantee_auth_uid, opt.key)"
                    class="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand-light"
                  />
                  <span>{{ opt.label }}</span>
                  <i :class="['fa-solid', opt.icon]" class="text-gray-400 ml-auto"></i>
                </label>
              </div>

              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  @click="savePermissions(g.grantee_auth_uid)"
                  :disabled="!isDirty(g.grantee_auth_uid) || savingUids.has(g.grantee_auth_uid) || revokingUids.has(g.grantee_auth_uid)"
                  class="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-bold flex items-center gap-1.5 hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i v-if="savingUids.has(g.grantee_auth_uid)" class="fa-solid fa-circle-notch fa-spin"></i>
                  {{ savingUids.has(g.grantee_auth_uid) ? 'Saving…' : 'Save' }}
                </button>
                <button
                  type="button"
                  @click="revokeShare(g.grantee_auth_uid)"
                  :disabled="savingUids.has(g.grantee_auth_uid) || revokingUids.has(g.grantee_auth_uid)"
                  class="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i v-if="revokingUids.has(g.grantee_auth_uid)" class="fa-solid fa-circle-notch fa-spin"></i>
                  <i v-else class="fa-solid fa-trash"></i>
                  {{ revokingUids.has(g.grantee_auth_uid) ? 'Revoking…' : 'Revoke' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="device" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-gray-800">Pending Invitations</h2>
          <span v-if="!pendingLoading" class="text-xs font-bold text-gray-400">
            {{ pendingInvites.length }}
          </span>
        </div>

        <div v-if="pendingLoading" class="flex items-center justify-center p-6 text-gray-400 text-sm">
          <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>
          Loading…
        </div>

        <div v-else-if="pendingError" class="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100 flex items-center gap-2">
          <i class="fa-solid fa-circle-exclamation"></i>
          {{ pendingError }}
        </div>

        <div v-else-if="pendingInvites.length === 0" class="text-center text-sm text-gray-500 py-4 leading-snug">
          No pending invitations.
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="inv in pendingInvites"
            :key="inv.id"
            class="p-3 border rounded-lg"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-800 truncate">
                  {{ inv.target_email || 'Pending invite' }}
                </p>
                <p class="text-xs text-gray-400 truncate mt-0.5">{{ formatScopes(inv.scopes) }}</p>
              </div>
              <i class="fa-solid fa-envelope text-gray-300"></i>
            </div>
            <div class="mt-2 flex items-center justify-between text-[11px] text-gray-400">
              <span>Sent {{ formatDate(inv.created_at) }}</span>
              <span>Expires {{ formatDate(inv.expires_at) }}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
