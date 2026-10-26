import { describe, it, expect } from 'vitest';
import { detectInstallEnv, usesMoreMenu, safariUrl, chromeIntentUrl } from './installEnv';

const UA = {
  iosSafari18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iosSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iosMessenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0.0.40.109;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]',
  iosFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/485.0.0.39.106;FBBV/1;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/18.5]',
  iosBareWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iPadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/486.0.0.66.70;]',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('detectInstallEnv', () => {
  it('iOS Safari, with the Safari major version', () => {
    expect(detectInstallEnv(UA.iosSafari18)).toMatchObject({ kind: 'ios-safari', safariMajor: 18, isIPad: false });
    expect(detectInstallEnv(UA.iosSafari26)).toMatchObject({ kind: 'ios-safari', safariMajor: 26 });
  });
  it('iOS Chrome is a browser, not in-app', () => {
    expect(detectInstallEnv(UA.iosChrome).kind).toBe('ios-browser');
  });
  it('Messenger, Facebook and an unnamed web view are in-app', () => {
    expect(detectInstallEnv(UA.iosMessenger).kind).toBe('ios-inapp');
    expect(detectInstallEnv(UA.iosFacebook).kind).toBe('ios-inapp');
    expect(detectInstallEnv(UA.iosBareWebView).kind).toBe('ios-inapp');
  });
  it('iPad in desktop mode is iOS only with touch points', () => {
    expect(detectInstallEnv(UA.iPadDesktopMode, { maxTouchPoints: 5 })).toMatchObject({ kind: 'ios-safari', isIPad: true });
    expect(detectInstallEnv(UA.iPadDesktopMode, { maxTouchPoints: 0 }).kind).toBe('desktop');
  });
  it('Android Chrome vs the Facebook web view', () => {
    expect(detectInstallEnv(UA.androidChrome).kind).toBe('android');
    expect(detectInstallEnv(UA.androidFacebook).kind).toBe('android-inapp');
  });
  it('desktop and installed', () => {
    expect(detectInstallEnv(UA.desktopChrome).kind).toBe('desktop');
    expect(detectInstallEnv(UA.iosSafari18, { standalone: true }).kind).toBe('installed');
  });
});

describe('helpers', () => {
  it('usesMoreMenu only from Safari 26', () => {
    expect(usesMoreMenu(detectInstallEnv(UA.iosSafari26))).toBe(true);
    expect(usesMoreMenu(detectInstallEnv(UA.iosSafari18))).toBe(false);
    expect(usesMoreMenu(detectInstallEnv(UA.iosChrome))).toBe(false);
  });
  it('builds the escape URLs', () => {
    expect(safariUrl('https://track.navitag.com/install')).toBe('x-safari-https://track.navitag.com/install');
    expect(chromeIntentUrl('https://track.navitag.com/install')).toBe(
      'intent://track.navitag.com/install#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Ftrack.navitag.com%2Finstall;end'
    );
  });
});
