import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { request } from '@/utils/http';
import { baseUrl } from '@/utils/variables';

/**
 * Client version gate.
 *
 * Asks GET /app/config (public, unauthenticated) what to do with THIS build and
 * stores the verdict. App.vue renders a non-dismissible wall on 'block'.
 *
 * THE SERVER DECIDES. We send platform + build and receive an action; there is
 * deliberately no version comparison in here. Anything this file computes is
 * frozen into the binary forever, and the users this gate exists to reach are
 * precisely the ones who can never receive a fix for it. Keeping the rule
 * server-side means a mistake is an sftp upload away from being corrected —
 * see api.navitag.net/v1/src/Controllers/AppConfig.php.
 *
 * FAILS OPEN, on every path. Not native, no build info, request failed,
 * malformed response — all resolve to "no gate". This code can lock a user out
 * of their own app, so every uncertainty must resolve toward letting them in.
 * A gate that hard-fails closed on a network blip bricks every install in the
 * field the moment the API hiccups.
 */
export const useAppGateStore = defineStore('appGate', () => {
  // 'ok' | 'warn' | 'block'. Starts 'ok' so the very first frame is never a
  // wall — the check is async and the app must render normally until it lands.
  const action = ref('ok');
  const message = ref('');
  const storeUrl = ref('');
  const checked = ref(false);

  async function check() {
    try {
      // Web is never gated: the browser always loads the current bundle, so
      // there is no stale build to gate against.
      if (!Capacitor.isNativePlatform()) return;

      // Dev builds are exempt. This is a COMPILE-TIME flag, not a build-number
      // test, on purpose: ios/App/App.xcodeproj carries CURRENT_PROJECT_VERSION
      // = 1 and android/app/build.gradle defaults versionCode to 1 — both are
      // placeholders Codemagic overwrites at build time. A locally built app
      // therefore reports build 1 and would be blocked by any armed threshold.
      // Exempting on import.meta.env.DEV keeps that convenience out of release
      // binaries entirely, where a build-number exemption would have shipped as
      // a permanent bypass.
      if (import.meta.env.DEV) return;

      const info = await App.getInfo();
      const build = String(info?.build ?? '').trim();
      if (!build) return;

      const res = await request.send({
        url: `${baseUrl}/app/config`,
        method: 'GET',
        params: { platform: Capacitor.getPlatform(), build },
      });

      if (!res || typeof res !== 'object') return;
      if (res.action !== 'block' && res.action !== 'warn') return;

      action.value = res.action;
      message.value = res.message || '';
      storeUrl.value = res.store_url || '';
    } catch (error) {
      // Deliberately swallowed. An unreachable or misbehaving gate endpoint
      // must never be the reason a user cannot open the app.
      console.warn('[AppGate] check skipped:', error?.message || error);
    } finally {
      checked.value = true;
    }
  }

  async function openStore() {
    if (!storeUrl.value) return;
    try {
      await Browser.open({ url: storeUrl.value });
    } catch {
      // Browser plugin unavailable for any reason — fall back to the webview's
      // own navigation rather than leaving a dead button.
      window.open(storeUrl.value, '_system');
    }
  }

  function dismissWarn() {
    if (action.value === 'warn') action.value = 'ok';
  }

  return { action, message, storeUrl, checked, check, openStore, dismissWarn };
});
