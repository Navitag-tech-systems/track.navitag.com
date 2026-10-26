<script setup>
// /install — put the PWA on the home screen (public; reached after a join and
// from the account page).
//
// iOS has no install API, so the iOS path is a guided Share -> Add to Home
// Screen with an arrow at the real Safari button, and in-app browsers are sent
// to Safari first. Android gets the one-tap prompt when Chrome offers it.
// See utils/installEnv.js for the detection rules.
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import QRCode from 'qrcode';
import { useUserStore } from '@/stores/user.js';
import { useInstallStore } from '@/stores/install.js';
import { lastJoin, isStandalone } from '@/utils/join';
import { detectInstallEnv, usesMoreMenu, safariUrl, chromeIntentUrl } from '@/utils/installEnv';

const router = useRouter();
const userStore = useUserStore();
const installStore = useInstallStore();

if (Capacitor.isNativePlatform()) router.replace('/');

const env = detectInstallEnv(navigator.userAgent || '', {
  standalone: isStandalone(),
  maxTouchPoints: navigator.maxTouchPoints || 0,
});
const moreMenu = usesMoreMenu(env);
const pageUrl = 'https://track.navitag.com/install';
const joined = lastJoin.value;
const signedInEmail = computed(() => userStore.email || userStore.user?.email || '');

const showGuide = ref(false);
const copied = ref(false);
const androidResult = ref('');   // '' | 'accepted' | 'dismissed'
const qrDataUrl = ref('');

const iosSteps = computed(() => {
  const steps = [];
  if (env.isIPad) {
    steps.push({ icon: 'fa-arrow-up-from-bracket', text: 'Tap the Share button at the top right of Safari.' });
  } else if (moreMenu) {
    steps.push({ icon: 'fa-ellipsis', text: 'Tap ••• at the bottom right of Safari, then tap Share.' });
  } else {
    steps.push({ icon: 'fa-arrow-up-from-bracket', text: 'Tap the Share button at the bottom of Safari.' });
  }
  steps.push({ icon: 'fa-square-plus', text: 'Scroll down and tap "Add to Home Screen". If you don\'t see it, tap "View More" or "Edit Actions" first.' });
  if (moreMenu) steps.push({ icon: 'fa-toggle-on', text: 'Leave "Open as Web App" turned on.' });
  steps.push({ icon: 'fa-check', text: 'Tap Add. Navitag appears on your home screen.' });
  return steps;
});

// Arrow position for the guide overlay: where the button the first step names
// actually sits in each Safari layout.
const arrowClass = computed(() => {
  if (env.isIPad) return 'top-4 right-6 rotate-180';
  if (moreMenu) return 'bottom-4 right-5';
  return 'bottom-4 left-1/2 -translate-x-1/2';
});

onMounted(async () => {
  if (env.kind === 'desktop') {
    try {
      qrDataUrl.value = await QRCode.toDataURL(pageUrl, { width: 220, margin: 1 });
    } catch {}
  }
});

async function androidInstall() {
  const evt = installStore.deferred;
  if (!evt) return;
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    androidResult.value = choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    androidResult.value = 'dismissed';
  }
  installStore.setDeferred(null);
  installStore.markResolved();
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
  <div class="flex flex-col items-center flex-1 p-4 bg-surface overflow-y-auto">
    <div class="w-full max-w-sm py-4">
      <div v-if="joined" class="mb-4 p-4 rounded-lg bg-green-50 border border-green-200 text-sm text-green-900 leading-snug">
        <p class="font-semibold"><i class="fa-solid fa-circle-check mr-1"></i>You joined {{ joined.business_name }}</p>
        <p>
          {{ joined.device_count }} vehicle{{ joined.device_count === 1 ? ' is' : 's are' }} now shared with you.
        </p>
      </div>

      <div class="bg-white p-6 rounded-lg shadow-md">
        <h1 class="text-xl font-bold text-gray-800 mb-1">Install Navitag</h1>
        <p class="text-sm text-gray-500 mb-5">Put Navitag on your home screen to open it like an app and get alerts.</p>

        <!-- Already the installed app -->
        <template v-if="env.kind === 'installed'">
          <p class="text-sm text-gray-700 mb-4"><i class="fa-solid fa-circle-check text-green-600 mr-1"></i>Navitag is installed and you are using it.</p>
          <button type="button" @click="router.replace('/')" class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded cursor-pointer">Open the map</button>
        </template>

        <!-- iOS in-app browser / other iOS browser: go to Safari -->
        <template v-else-if="env.kind === 'ios-inapp' || env.kind === 'ios-browser'">
          <p class="text-sm text-gray-700 mb-4 leading-snug">
            <template v-if="env.kind === 'ios-inapp'">This page is open inside another app. Navitag can only be installed from <strong>Safari</strong>.</template>
            <template v-else>Installing works best from <strong>Safari</strong>.</template>
          </p>
          <a :href="safariUrl(pageUrl)" class="block w-full text-center bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded mb-3">
            <i class="fa-brands fa-safari mr-2"></i>Open in Safari
          </a>
          <button type="button" @click="copyLink" class="w-full border border-gray-300 text-gray-700 font-semibold py-3 rounded cursor-pointer">
            {{ copied ? 'Link copied — paste it in Safari' : 'Copy link' }}
          </button>
          <div class="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-700 leading-relaxed border border-gray-200">
            <p class="font-semibold mb-1">If "Open in Safari" does nothing:</p>
            <ol class="list-decimal list-inside space-y-1">
              <li v-if="env.kind === 'ios-inapp'">Tap <strong>•••</strong> or the <i class="fa-solid fa-compass"></i> icon in this app and choose <strong>Open in Safari</strong> (or "Open in browser").</li>
              <li v-else>Tap <strong>Copy link</strong>, open <strong>Safari</strong>, and paste it into the address bar.</li>
              <li>In Safari, follow the steps on this page again.</li>
            </ol>
            <p v-if="env.kind === 'ios-browser'" class="mt-2 text-gray-500">In Chrome you can also tap the Share icon in the address bar, then <strong>Add to Home Screen</strong>.</p>
          </div>
        </template>

        <!-- iOS Safari: guided Add to Home Screen -->
        <template v-else-if="env.kind === 'ios-safari'">
          <ol class="space-y-3 mb-5">
            <li v-for="(s, i) in iosSteps" :key="i" class="flex gap-3 items-start">
              <span class="shrink-0 w-7 h-7 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center">{{ i + 1 }}</span>
              <span class="text-sm text-gray-700 leading-snug pt-1"><i class="fa-solid mr-1 text-gray-500" :class="s.icon"></i>{{ s.text }}</span>
            </li>
          </ol>
          <button type="button" @click="showGuide = true" class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded cursor-pointer shadow active:scale-[0.98]">
            <i class="fa-solid fa-hand-pointer mr-2"></i>Show me where to tap
          </button>
        </template>

        <!-- Android in-app browser -->
        <template v-else-if="env.kind === 'android-inapp'">
          <p class="text-sm text-gray-700 mb-4 leading-snug">This page is open inside another app. Open it in <strong>Chrome</strong> to install Navitag.</p>
          <a :href="chromeIntentUrl(pageUrl)" class="block w-full text-center bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded mb-3">
            <i class="fa-brands fa-chrome mr-2"></i>Open in Chrome
          </a>
          <button type="button" @click="copyLink" class="w-full border border-gray-300 text-gray-700 font-semibold py-3 rounded cursor-pointer">
            {{ copied ? 'Link copied — paste it in Chrome' : 'Copy link' }}
          </button>
        </template>

        <!-- Android browser -->
        <template v-else-if="env.kind === 'android'">
          <template v-if="androidResult === 'accepted' || installStore.installed">
            <p class="text-sm text-gray-700"><i class="fa-solid fa-circle-check text-green-600 mr-1"></i>Installing. Open <strong>Navitag</strong> from your home screen.</p>
          </template>
          <template v-else>
            <button
              v-if="installStore.deferred"
              type="button"
              @click="androidInstall"
              class="w-full bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded cursor-pointer shadow active:scale-[0.98] mb-4"
            >
              <i class="fa-solid fa-download mr-2"></i>Install Navitag
            </button>
            <div class="p-3 bg-gray-50 rounded-lg text-xs text-gray-700 leading-relaxed border border-gray-200">
              <p class="font-semibold mb-1">{{ installStore.deferred ? 'Or install from the menu:' : 'Install from the Chrome menu:' }}</p>
              <ol class="list-decimal list-inside space-y-1">
                <li>Tap <strong><i class="fa-solid fa-ellipsis-vertical"></i></strong> at the top right of Chrome.</li>
                <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
                <li>Tap <strong>Install</strong>.</li>
              </ol>
              <p class="mt-2 text-gray-500">Not available in incognito tabs.</p>
            </div>
          </template>
        </template>

        <!-- Desktop -->
        <template v-else>
          <p class="text-sm text-gray-700 mb-4">Scan this with your phone's camera to install Navitag on your phone.</p>
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR code for track.navitag.com/install" class="mx-auto w-[220px] h-[220px]" />
          <p class="text-xs text-gray-500 text-center mt-2 break-all">{{ pageUrl }}</p>
        </template>

        <div v-if="env.isIOS && env.kind !== 'installed'" class="mt-5 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-snug">
          <p class="font-semibold mb-1">After installing</p>
          <p>
            Open Navitag from your home screen and sign in again<template v-if="signedInEmail"> with <strong>{{ signedInEmail }}</strong></template>.
            The home-screen app keeps its own sign-in, separate from Safari. Allow notifications when it asks.
          </p>
        </div>
      </div>

      <button v-if="env.kind !== 'installed'" type="button" @click="router.replace(userStore.isLoggedIn ? '/' : '/login')" class="w-full text-sm text-gray-500 py-4 cursor-pointer">
        Continue in the browser
      </button>
    </div>

    <!-- iOS Safari guide overlay: dims the page and points at the real button. -->
    <div v-if="showGuide" class="fixed inset-0 z-[60] bg-black/70" @click="showGuide = false">
      <div class="absolute left-4 right-4 top-1/3 bg-white rounded-xl p-5 text-center shadow-xl">
        <p class="text-base font-bold text-gray-800 mb-2">{{ iosSteps[0].text }}</p>
        <p class="text-sm text-gray-600">Then choose <strong>Add to Home Screen</strong> and tap <strong>Add</strong>.</p>
        <p class="text-xs text-gray-400 mt-4">Tap anywhere to close</p>
      </div>
      <div class="absolute text-white text-5xl animate-bounce" :class="arrowClass">
        <i class="fa-solid fa-arrow-down"></i>
      </div>
    </div>
  </div>
</template>
