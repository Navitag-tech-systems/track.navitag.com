<script setup>
// "Business emails" on /account. Rendered only when GET /business/settings
// returns at least one account, i.e. the caller owns business units of an
// ACTIVE business account (rule lives in api Services/BusinessEmailSettings).
// A failed fetch hides the section too: it is an owner-only extra, and showing
// an empty or broken card to every other user would be worse than nothing.
import { ref, reactive, onMounted } from 'vue';
import { useUserStore } from '@/stores/user.js';
import { baseUrl } from '@/utils/variables';
import { request } from '@/utils/http';
import InlineLoader from '@/components/InlineLoader.vue';
import { addError, formError, isDirty, normalizeEmail, toForm, toPayload } from '@/utils/businessEmails';

const userStore = useUserStore();

const accounts = ref([]);   // server copies
const forms = ref([]);      // editable copies, same order
const drafts = reactive({}); // `${accountId}:${list}` -> input text
const inputErrors = reactive({});
const saving = ref(null);
const saveMessage = reactive({});
const saveError = reactive({});

const LISTS = [
  { key: 'billing', label: 'Billing emails', help: 'Invoices and payment reminders. The first address is the main recipient, the rest are copied.' },
  { key: 'daily', label: 'Daily report', help: 'Daily fleet report email.' },
  { key: 'weekly', label: 'Weekly report', help: 'Weekly fleet report email.' },
];

function listOf(form, key) {
  return key === 'billing' ? form.billing_emails : form[`${key}_report`].emails;
}

function draftKey(form, key) {
  return `${form.id}:${key}`;
}

function addEmail(form, key) {
  const k = draftKey(form, key);
  const list = listOf(form, key);
  const err = addError(list, drafts[k]);
  inputErrors[k] = err || '';
  if (err) return;
  list.push(normalizeEmail(drafts[k]));
  drafts[k] = '';
  saveMessage[form.id] = '';
}

function removeEmail(form, key, email) {
  const list = listOf(form, key);
  const i = list.indexOf(email);
  if (i >= 0) list.splice(i, 1);
  saveMessage[form.id] = '';
}

function toggleReport(form, r) {
  form[`${r}_report`].enabled = !form[`${r}_report`].enabled;
  saveMessage[form.id] = '';
}

async function load() {
  try {
    const res = await request.send({ url: `${baseUrl}/business/settings`, token: userStore.idToken });
    const list = Array.isArray(res?.accounts) ? res.accounts : [];
    accounts.value = list;
    forms.value = list.map(toForm);
  } catch (err) {
    console.warn('[BusinessEmails] settings fetch failed, section hidden:', err?.message || err);
    accounts.value = [];
    forms.value = [];
  }
}

async function save(index) {
  const form = forms.value[index];
  saveMessage[form.id] = '';
  saveError[form.id] = formError(form) || '';
  if (saveError[form.id]) return;
  saving.value = form.id;
  try {
    const res = await request.send({
      url: `${baseUrl}/business/settings/${form.id}`,
      method: 'PUT',
      data: toPayload(form),
      token: userStore.idToken,
    });
    if (!res?.account) throw new Error('Unexpected response from the server.');
    accounts.value[index] = res.account;
    forms.value[index] = toForm(res.account);
    saveMessage[form.id] = 'Saved.';
  } catch (err) {
    saveError[form.id] = err?.message || 'Failed to save.';
  } finally {
    saving.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div
    v-for="(form, index) in forms"
    :key="form.id"
    class="bg-white p-5 rounded-xl shadow-sm border border-gray-100"
  >
    <h2 class="text-lg font-bold text-gray-800">Business emails</h2>
    <p class="text-xs text-gray-500 mt-1 mb-4 leading-snug">
      {{ form.company_name }} · {{ form.unit_count }} business {{ form.unit_count === 1 ? 'unit' : 'units' }}
    </p>

    <div
      v-for="(list, li) in LISTS"
      :key="list.key"
      :class="li > 0 ? 'mt-5 pt-5 border-t border-gray-100' : ''"
    >
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="text-sm font-medium text-gray-800">{{ list.label }}</p>
          <p class="text-xs text-gray-500 mt-1 leading-snug">{{ list.help }}</p>
        </div>
        <button
          v-if="list.key !== 'billing'"
          type="button"
          @click="toggleReport(form, list.key)"
          :aria-pressed="form[`${list.key}_report`].enabled"
          :aria-label="`${list.label} ${form[`${list.key}_report`].enabled ? 'on' : 'off'}`"
          :class="[
            'relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 cursor-pointer',
            form[`${list.key}_report`].enabled ? 'bg-brand' : 'bg-gray-300'
          ]"
        >
          <span
            :class="[
              'inline-block h-4 w-4 transform rounded-full bg-white transition shadow',
              form[`${list.key}_report`].enabled ? 'translate-x-6' : 'translate-x-1'
            ]"
          />
        </button>
      </div>

      <ul v-if="listOf(form, list.key).length" class="mt-3 space-y-1.5">
        <li
          v-for="(email, ei) in listOf(form, list.key)"
          :key="email"
          class="flex items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded px-2 py-1.5"
        >
          <span class="text-sm text-gray-800 truncate min-w-0">
            {{ email }}
            <span v-if="list.key === 'billing' && ei === 0" class="ml-1 text-[10px] uppercase tracking-wide text-gray-400">main</span>
          </span>
          <button
            type="button"
            @click="removeEmail(form, list.key, email)"
            :aria-label="`Remove ${email}`"
            class="text-gray-400 hover:text-red-500 cursor-pointer shrink-0 px-1"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </li>
      </ul>

      <form class="mt-2 flex gap-2" @submit.prevent="addEmail(form, list.key)">
        <input
          v-model="drafts[draftKey(form, list.key)]"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="name@company.com"
          class="flex-1 min-w-0 border p-1 rounded focus:ring-2 focus:ring-brand outline-none text-sm"
        />
        <button
          type="submit"
          class="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer shrink-0"
        >Add</button>
      </form>
      <p v-if="inputErrors[draftKey(form, list.key)]" class="text-red-500 text-xs mt-1">{{ inputErrors[draftKey(form, list.key)] }}</p>
    </div>

    <p v-if="saveMessage[form.id]" class="text-green-600 text-sm mt-4"><i class="fa-solid fa-check mr-1"></i>{{ saveMessage[form.id] }}</p>
    <p v-if="saveError[form.id]" class="text-red-500 text-sm mt-4">{{ saveError[form.id] }}</p>

    <button
      type="button"
      @click="save(index)"
      :disabled="saving === form.id || !isDirty(form, accounts[index])"
      class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 px-4 rounded transition cursor-pointer text-sm shadow active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-4"
    >
      <InlineLoader v-if="saving === form.id" class="mr-2" />
      {{ saving === form.id ? 'Saving…' : 'Save Business Emails' }}
    </button>
  </div>
</template>
