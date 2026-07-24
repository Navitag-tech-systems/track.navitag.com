import { toRaw } from 'vue';
import { Capacitor } from '@capacitor/core';
import { Purchases, PURCHASES_ERROR_CODE } from '@revenuecat/purchases-capacitor';
import { createTopUpCart } from '@/utils/medusa';

// iOS App Store guideline 3.1.1 remediation: real StoreKit IAP via RevenueCat,
// replacing the external-browser Top Up flow on iOS only. Android/web keep the
// existing Medusa web-checkout Top Up (see deviceSettings.vue).
const REVENUECAT_IOS_API_KEY = 'appl_NGVqKrdizVRFOznCieFzUQjHBNN';

// Real StoreKit IAP runs on iOS only — the RevenueCat Capacitor plugin bridges
// to native StoreKit and is not available in a browser.
export const isIapSupported = () => Capacitor.getPlatform() === 'ios';

// Localhost web REVIEW mode (`npm run dev` in a browser). Lets the entire
// Manage Plan → sheet → tiers → purchase → success flow be clicked through for
// UI/UX review without a device, using a mocked offering + a simulated
// purchase. It is NEVER active in a production build (import.meta.env.DEV is
// false there), so production web / Android behaviour — the external Medusa
// web-checkout Top Up — is completely unchanged.
export const isIapPreview = () => import.meta.env.DEV && Capacitor.getPlatform() === 'web';

// Should the native "Manage Plan" purchase UI be shown at all? Real on iOS,
// simulated in localhost review. Production web/Android => false => external Top Up.
export const isIapUiEnabled = () => isIapSupported() || isIapPreview();

let configured = false;

// Configure once per app lifetime, as early as possible (main.js), before
// Firebase auth state is known — RevenueCat starts anonymous and identity is
// attached later via iapLogIn(). No-ops off a real iOS device.
export async function configureIap() {
  if (!isIapSupported() || configured) return;
  try {
    await Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY });
    configured = true;
  } catch (err) {
    console.error('[IAP] configure failed:', err);
  }
}

export async function iapLogIn(appUserID) {
  if (!isIapSupported() || !configured || !appUserID) return;
  try {
    await Purchases.logIn({ appUserID });
  } catch (err) {
    console.error('[IAP] logIn failed:', err);
  }
}

export async function iapLogOut() {
  if (!isIapSupported() || !configured) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    // Rejects if the current user is already anonymous (e.g. logout right
    // after a failed login) — harmless, nothing to clear.
    console.warn('[IAP] logOut skipped:', err?.message || err);
  }
}

// --- Localhost review: mock offering ---------------------------------------
// Mirrors the RevenueCat "Navitag Data Plans" offering: 6 consumable packages
// with the identifiers the sheet parses ($rc_custom_<tier>_<months>month) and
// the real App Store PH prices that were pushed to App Store Connect.
const PREVIEW_PRICE_STRINGS = {
  '$rc_custom_basic_3month': '₱720.00',
  '$rc_custom_basic_6month': '₱1,380.00',
  '$rc_custom_basic_12month': '₱2,650.00',
  '$rc_custom_pro_3month': '₱1,320.00',
  '$rc_custom_pro_6month': '₱2,590.00',
  '$rc_custom_pro_12month': '₱5,050.00',
};

function buildPreviewOffering() {
  const availablePackages = Object.entries(PREVIEW_PRICE_STRINGS).map(([identifier, priceString]) => ({
    identifier,
    packageType: 'CUSTOM',
    product: { identifier, priceString, title: identifier },
  }));
  return { identifier: 'default', serverDescription: 'Navitag Data Plans (preview)', availablePackages };
}

// Returns the RevenueCat "current" offering (the "Navitag Data Plans" offering),
// a mock offering in localhost review, or null if unavailable/unsupported.
export async function getPlanOffering() {
  if (isIapPreview()) return buildPreviewOffering();
  if (!isIapSupported()) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current;
  } catch (err) {
    console.error('[IAP] getOfferings failed:', err);
    return null;
  }
}

/**
 * Purchase a data-plan package for a device.
 *
 * Order of operations matters: we create the Medusa cart FIRST (so the
 * `pending_cart_id` subscriber attribute is set before RevenueCat fires the
 * fulfilment webhook), then charge via StoreKit. If cart creation fails we
 * abort before any charge; if the user cancels the StoreKit sheet the orphan
 * open cart is harmless (the webhook only ever completes it on a real purchase).
 *
 * @param {object}  args
 * @param {object}  args.device  device row (needs .uniqueId (IMEI) + .model)
 * @param {string}  args.tier    'basic' | 'pro'
 * @param {number}  args.months  3 | 6 | 12
 * @param {object}  args.pkg     the RevenueCat package to purchase
 * @returns {Promise<{ok:boolean, cancelled?:boolean, error?:string, preview?:boolean}>}
 */
export async function purchasePlan({ device, tier, months, pkg }) {
  // Localhost review: simulate a successful StoreKit purchase (no charge, no
  // cart, no RevenueCat call).
  if (isIapPreview()) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { ok: true, preview: true };
  }

  if (!isIapSupported()) {
    return { ok: false, error: 'In-app purchases are not available on this platform.' };
  }

  try {
    // 1. Build the cart the webhook will complete (Hidden channel + device_imei
    //    metadata + Digital Delivery), identical to the web top-up flow.
    const cartId = await createTopUpCart({ device, tier, months });

    // 2. Carry the cart id as the subscriber attribute the webhook reads.
    await Purchases.setAttributes({ pending_cart_id: cartId });

    // 3. Charge via StoreKit. Fulfilment lands later via the RevenueCat webhook.
    //    toRaw: callers hold the package inside Vue state, and a reactive Proxy
    //    does not serialize across the Capacitor bridge — native would receive
    //    no dictionary and reject with "must provide aPackage parameter".
    //    Harmless on an already-plain object (preview mock, raw plugin object).
    const result = await Purchases.purchasePackage({ aPackage: toRaw(pkg) });
    return { ok: true, customerInfo: result.customerInfo, cartId };
  } catch (err) {
    if (err?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { ok: false, cancelled: true };
    }
    console.error('[IAP] purchasePlan failed:', err);
    return { ok: false, error: err?.message || 'Purchase failed. Please try again.' };
  }
}
