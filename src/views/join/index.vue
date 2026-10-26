<script setup>
// /join/:code — business join link landing page (public).
//
// Signed out: stores the code and sends the visitor straight to /login, or to
// /signup when the link's `landing` is signup (the URL's ?start=login|signup
// overrides it); the session start claims it right after /user/sync
// (utils/join.js) and lands on /install. In-app browsers stay on this page so
// the "open in Safari/Chrome" banner is seen first. Signed in with a running session: a "Join" button claims directly,
// then reloads so the device list and live subscriptions pick the fleet up.
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { useUserStore } from '@/stores/user.js';
import { useDevicesStore } from '@/stores/devices.js';
import {
  normalizeCode, setPendingJoin, clearPendingJoin, lookupJoin, claimJoin, isStandalone, resolveLanding,
} from '@/utils/join';
import { detectInstallEnv, safariUrl, chromeIntentUrl } from '@/utils/installEnv';
import InlineLoader from '@/components/InlineLoader.vue';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const deviceStore = useDevicesStore();

const code = normalizeCode(route.params.code);
const info = ref(null);           // { business_name, device_count, state, landing }
const lookupError = ref('');
const loading = ref(true);
const joining = ref(false);
const joinError = ref('');

const env = detectInstallEnv(navigator.userAgent || '', {
  standalone: isStandalone(),
  maxTouchPoints: navigator.maxTouchPoints || 0,
});
const inApp = env.kind === 'ios-inapp' || env.kind === 'android-inapp';
const pageUrl = `https://track.navitag.com/join/${code}`;
const escapeUrl = env.kind === 'ios-inapp' ? safariUrl(pageUrl) : chromeIntentUrl(pageUrl);
const copied = ref(false);

// Session already up (warm): claim from here. Cold start with a stored code:
// the session start claims it, so this page only shows progress.
const sessionReady = computed(() => userStore.isLoggedIn && deviceStore.hasLoadedOnce);
const sessionStarting = computed(() => userStore.isLoggedIn && !deviceStore.hasLoadedOnce);

// Stored synchronously, before the lookup resolves: on a cold start with a
// signed-in user the session start may reach its claim step first. Not stored
// when the session is already up — that user joins with the button or not at all.
if (!deviceStore.hasLoadedOnce) setPendingJoin(code);

const landing = computed(() => resolveLanding(route.query.start, info.value?.landing));

// Signed out (user === false; null is "auth not resolved yet") and the link is
// good: go to the landing screen. The banner there names the business.
watch(
  () => [info.value, userStore.user],
  () => {
    if (inApp || lookupError.value || !info.value || userStore.user !== false) return;
    router.replace(landing.value === 'signup' ? '/signup' : '/login');
  },
);

onMounted(async () => {
  if (!code) {
    lookupError.value = 'This join link is not valid.';
    loading.value = false;
    return;
  }
  try {
    const res = await lookupJoin(code);
    if (!deviceStore.hasLoadedOnce) setPendingJoin(code, res.business_name);
    info.value = res;
  } catch (err) {
    if (err?.status === 410) {
      info.value = err.body || null;
      lookupError.value = err.body?.state === 'full'
        ? 'This join link has reached its member limit. Ask the business for a new link.'
        : 'This join link has expired. Ask the business for a new link.';
    } else if (err?.status === 404) {
      lookupError.value = 'This join link is not valid or was turned off.';
    } else {
      lookupError.value = 'Could not load this join link. Check your connection and try again.';
    }
    clearPendingJoin();
  } finally {
    loading.value = false;
  }
});

async function joinNow() {
  joining.value = true;
  joinError.value = '';
  try {
    await claimJoin(code, userStore.idToken);
    clearPendingJoin();
    const next = Capacitor.isNativePlatform() || isStandalone() ? '/' : '/install?joined=1';
    window.location.replace(next);
  } catch (err) {
    if (err?.status === 400) joinError.value = 'This is your own business link.';
    else if (err?.status === 403) joinError.value = 'You were removed from this business. Contact them to be added again.';
    else if (err?.status === 410) joinError.value = 'This join link is no longer accepting members.';
    else joinError.value = 'Joining failed. Please try again.';
    joining.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(pageUrl);
    copied.value = true;
  } catch {
    window.prompt('Copy this link:', pageUrl);
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center flex-1 p-4 bg-surface overflow-y-auto">
    <div class="w-full max-w-sm">
      <div
        v-if="inApp && !loading && !lookupError"
        class="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-snug"
      >
        <p class="font-semibold mb-1">
          Open this page in {{ env.kind === 'ios-inapp' ? 'Safari' : 'Chrome' }} first
        </p>
        <p class="mb-2">
          The app can't be installed from inside {{ env.kind === 'ios-inapp' ? 'Messenger or Facebook' : 'this app' }},
          and Google sign-in is blocked here.
        </p>
        <div class="flex gap-2">
          <a :href="escapeUrl" class="flex-1 text-center bg-amber-600 text-white font-semibold py-2 rounded">
            Open in {{ env.kind === 'ios-inapp' ? 'Safari' : 'Chrome' }}
          </a>
          <button type="button" @click="copyLink" class="flex-1 bg-white border border-amber-300 font-semibold py-2 rounded cursor-pointer">
            {{ copied ? 'Link copied' : 'Copy link' }}
          </button>
        </div>
      </div>

      <div class="bg-white p-6 rounded-lg shadow-md text-center">
        <div v-if="loading" class="py-8 flex justify-center"><InlineLoader /></div>

        <template v-else-if="lookupError">
          <i class="fa-solid fa-link-slash text-3xl text-gray-400 mb-3"></i>
          <h1 class="text-xl font-bold text-gray-800 mb-2">{{ info?.business_name || 'Join link' }}</h1>
          <p class="text-sm text-gray-600 mb-5">{{ lookupError }}</p>
          <button type="button" @click="router.replace('/')" class="w-full border border-gray-300 text-gray-700 font-semibold py-3 rounded cursor-pointer">
            Go to Navitag
          </button>
        </template>

        <template v-else>
          <i class="fa-solid fa-building text-3xl text-brand mb-3"></i>
          <p class="text-sm text-gray-500">You're invited to join</p>
          <h1 class="text-2xl font-bold text-gray-800 mb-3">{{ info.business_name }}</h1>
          <p class="text-sm text-gray-600 mb-5 leading-snug">
            {{ info.device_count }} vehicle{{ info.device_count === 1 ? '' : 's' }} will be shared with you:
            live location, trip history, alerts and dashcam video.
          </p>

          <template v-if="sessionReady">
            <button
              type="button"
              :disabled="joining"
              @click="joinNow"
              class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 px-4 rounded transition cursor-pointer shadow active:scale-[0.98] disabled:opacity-60"
            >
              <InlineLoader v-if="joining" /><span v-else>Join {{ info.business_name }}</span>
            </button>
            <p class="text-xs text-gray-500 mt-3">Signed in as {{ userStore.email || userStore.user?.email }}</p>
          </template>

          <div v-else-if="sessionStarting" class="py-2 text-sm text-gray-600 flex items-center justify-center gap-2">
            <InlineLoader /> Joining…
          </div>

          <!-- Reached signed out only in an in-app browser (otherwise the watch
               redirects); the landing screen is the primary button. -->
          <div v-else class="flex gap-3" :class="landing === 'signup' ? 'flex-col' : 'flex-col-reverse'">
            <button
              type="button"
              @click="router.push('/signup')"
              class="w-full font-bold py-3 px-4 rounded transition cursor-pointer active:scale-[0.98]"
              :class="landing === 'signup' ? 'bg-brand hover:bg-brand-dark text-white shadow' : 'border border-gray-300 text-gray-700'"
            >
              Create account
            </button>
            <button
              type="button"
              @click="router.push('/login')"
              class="w-full font-bold py-3 px-4 rounded transition cursor-pointer active:scale-[0.98]"
              :class="landing === 'login' ? 'bg-brand hover:bg-brand-dark text-white shadow' : 'border border-gray-300 text-gray-700'"
            >
              I already have an account
            </button>
          </div>
          <template v-if="!sessionReady && !sessionStarting">
            <p class="text-xs text-gray-500 mt-4 leading-snug">
              You join {{ info.business_name }} as soon as you sign in. Next, we'll show you how to put Navitag on your home screen.
            </p>
          </template>

          <p v-if="joinError" class="text-red-600 text-sm mt-3">{{ joinError }}</p>
        </template>
      </div>
    </div>
  </div>
</template>
