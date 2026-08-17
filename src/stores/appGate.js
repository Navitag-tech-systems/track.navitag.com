import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { request } from '@/utils/http';
import { baseUrl } from '@/utils/variables';

/**
 * Client version gate.
 *
 * Asks GET /app/config (public, unauthenticated) what to do with THIS build and
 * stores the verdict. App.vue renders a non-dismissible wall on 'block'.
 *
 * THE SERVER DECIDES. We send platform + version and receive an action; there
 * is deliberately no version comparison in here. Anything this file computes is
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
  // App-scheme variant (market:// , itms-apps://) tried before storeUrl so the
  // store app opens without a chooser. Server-supplied; see openStore().
  const storeUrlApp = ref('');
  const checked = ref(false);

  // What this binary IS. Filled in by check() and shown on the wall, because
  // the wall is a dead end where the user's only remaining channel is support —
  // and "Update Required" with nothing else on screen tells support nothing.
  // A screenshot carrying "5.1.0 (17)" identifies the release exactly.
  //
  // currentVersion is also what gets SENT; currentBuild is display-only, since
  // the gate compares marketing versions and ignores build numbers entirely.
  const currentVersion = ref('');
  const currentBuild = ref('');

  async function check() {
    try {
      // Web is never gated: the browser always loads the current bundle, so
      // there is no stale build to gate against.
      if (!Capacitor.isNativePlatform()) return;

      // Dev builds are exempt, and gating on version rather than build number
      // makes this MORE load-bearing, not less. A local build takes its version
      // straight from package.json, so it is indistinguishable from a shipped
      // release of that same version: arm MIN_VERSION at 5.2.0 while developing
      // on 5.1.0 and every developer's own build walls itself off.
      //
      // import.meta.env.DEV is a COMPILE-TIME flag, so the exemption is dead
      // code in a release binary. That is the point — any runtime exemption
      // (a version allow-list, a debug flag) would ship as a permanent bypass
      // of the one mechanism that can reach an unpatchable install.
      if (import.meta.env.DEV) return;

      const info = await App.getInfo();
      const version = String(info?.version ?? '').trim();

      // Build number is read for DISPLAY ONLY (see the wall) and is not sent —
      // the gate compares marketing versions. Its absence must not stop the
      // check, so it is deliberately not part of the guard below.
      currentBuild.value = String(info?.build ?? '').trim();
      currentVersion.value = version;

      // No version, nothing to ask about. The server would answer 'ok' anyway;
      // returning here just skips a pointless round trip.
      if (!version) return;

      // Only platform + version go out, and no comparison happens here. The
      // server holds every rule — anything this file computed would be frozen
      // into the binary for precisely the users who can never receive a fix.
      const res = await request.send({
        url: `${baseUrl}/app/config`,
        method: 'GET',
        params: { platform: Capacitor.getPlatform(), version },
      });

      if (!res || typeof res !== 'object') return;
      if (res.action !== 'block' && res.action !== 'warn') return;

      action.value = res.action;
      message.value = res.message || '';
      storeUrl.value = res.store_url || '';
      storeUrlApp.value = res.store_url_app || '';
    } catch (error) {
      // Deliberately swallowed. An unreachable or misbehaving gate endpoint
      // must never be the reason a user cannot open the app.
      console.warn('[AppGate] check skipped:', error?.message || error);
    } finally {
      checked.value = true;
    }
  }

  /**
   * Sends the user to the store LISTING in the store APP.
   *
   * This used to be Browser.open(), which is an in-app view — a Chrome Custom
   * Tab on Android, SFSafariViewController on iOS. That renders the store's
   * WEB page, so the one action on a non-dismissible wall left the user on a
   * page inside the app they were just told they cannot use, needing another
   * tap to reach the store itself. AppLauncher hands off to the OS instead
   * (Intent.ACTION_VIEW / UIApplication.open), which is what actually resolves
   * these URLs to App Store and Play.
   *
   * Two URLs are tried in order, both supplied by the server so the listing
   * stays fixable without a release:
   *   store_url_app  market:// or itms-apps:// — claimed by exactly one app,
   *                  so it opens the store directly with no chooser dialog
   *   store_url      https — universal fallback; the only one that works on a
   *                  device with no Play Store
   *
   * NOTE the success test is `completed`, NOT a thrown error. AppLauncher's
   * Android openUrl does not reject when nothing handles the intent — its
   * canLaunchIntent() calls startActivity and returns a boolean, so a failed
   * launch resolves with {completed: false}. A try/catch alone would treat that
   * as success and silently strand the user on the wall.
   */
  async function openStore() {
    for (const url of [storeUrlApp.value, storeUrl.value]) {
      if (!url) continue;
      try {
        const res = await AppLauncher.openUrl({ url });
        if (res?.completed !== false) return;
      } catch {
        // Plugin missing or URL malformed — fall through to the next candidate.
      }
    }

    // Everything above failed. Better a web page than a dead button.
    if (storeUrl.value) window.open(storeUrl.value, '_system');
  }

  function dismissWarn() {
    if (action.value === 'warn') action.value = 'ok';
  }

  return {
    action, message, storeUrl, storeUrlApp, checked,
    currentVersion, currentBuild,
    check, openStore, dismissWarn,
  };
});
