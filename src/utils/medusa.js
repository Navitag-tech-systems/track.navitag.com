// Minimal Medusa Store client for the native In-App Purchase flow.
//
// WHY THIS EXISTS
// The RevenueCat webhook that fulfils an Apple IAP does NOT look up the device
// by IMEI. It completes a Medusa cart the app must have created *before* the
// purchase, keyed by the `pending_cart_id` RevenueCat subscriber attribute
// (see broker-medusa/src/api/hooks/revenuecat/route.ts). So the native app has
// to build the exact same cart the web top-up builds — Hidden sales channel,
// `metadata.device_imei`, Digital Delivery shipping method — and hand its id to
// RevenueCat. This module is that cart builder.
//
// It is a faithful port of www-v3/app/pages/top-up/[imei].vue `buyPlan()` +
// `fetchProducts()`, using the same constants (www-v3/app/variables.ts) and the
// same Firebase→Medusa JWT exchange (www-v3/app/composables/useMedusa.ts).
//
// ⚠️ VERIFICATION STATUS: this path only runs on a real iOS device (it is fully
// bypassed in the localhost web review — see utils/iap.js isIapPreview()). It
// has NOT yet been exercised against live shopapi.navitag.com from the app.
// The two spots most worth confirming on-device / in TestFlight are
// resolveRegionId() and resolveVariantId() (see notes on each).

import { CapacitorHttp } from '@capacitor/core';
import { useUserStore } from '@/stores/user';

// --- Storefront constants (mirror www-v3/app/variables.ts) ---
const MEDUSA_BACKEND_URL = 'https://shopapi.navitag.com';
const MEDUSA_PUBLISHABLE_KEY = 'pk_acd1689997df608660c9753f37ae30f24a0b503e7de1bacba7e12e3acaf7216d';
// Web top-up cart-create bodies use MEDUSA_PUBLISHABLE_KEY together with this
// Hidden sales channel so renewal plans never surface on the public storefront.
const MEDUSA_HIDDEN_SALES_CHANNEL_ID = 'sc_01KNBNYT4XAB2QZGD1AS6R0HT0';
const MEDUSA_DIGITAL_DELIVERY_OPTION_ID = 'so_01KNNDCWCEWGBC8BA71HG92T10';

let cachedJwt = null;
let regionsCache = null;

// --- Firebase ID token -> Medusa customer JWT (mirrors useMedusa.ts) ---
async function exchangeToken(force = false) {
  const userStore = useUserStore();
  const idToken = force
    ? await userStore.getFreshToken()
    : (userStore.idToken || await userStore.getFreshToken());
  if (!idToken) throw new Error('No Firebase session for Medusa token exchange.');

  const res = await CapacitorHttp.request({
    url: `${MEDUSA_BACKEND_URL}/auth/customer/firebase`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    data: { id_token: idToken },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Medusa token exchange failed (${res.status}).`);
  }
  cachedJwt = res.data?.token;
  if (!cachedJwt) throw new Error('Medusa token exchange returned no token.');
  return cachedJwt;
}

async function ensureJwt() {
  return cachedJwt || exchangeToken(false);
}

// Thin request helper with a single 401 refresh-and-retry, matching the app's
// existing http.js convention. `auth: false` for public store reads that only
// need the publishable key (regions, categories, products).
async function medusaRequest(path, { method = 'GET', data = null, params = null, auth = true } = {}) {
  const buildHeaders = (jwt) => {
    const h = { 'x-publishable-api-key': MEDUSA_PUBLISHABLE_KEY, Accept: 'application/json' };
    if (data) h['Content-Type'] = 'application/json';
    if (auth && jwt) h.Authorization = `Bearer ${jwt}`;
    return h;
  };

  const doRequest = (jwt) => CapacitorHttp.request({
    url: `${MEDUSA_BACKEND_URL}${path}`,
    method: method.toUpperCase(),
    headers: buildHeaders(jwt),
    params: params || {},
    data: data || undefined,
  });

  let jwt = auth ? await ensureJwt() : null;
  let res = await doRequest(jwt);

  if (res.status === 401 && auth) {
    cachedJwt = null;
    jwt = await exchangeToken(true);
    res = await doRequest(jwt);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Medusa ${method} ${path} failed (${res.status}).`);
  }
  return res.data;
}

// Region: match the user's country to a Medusa region; fall back to PH (the
// launch region) then the first available. NOTE: the web resolves this from a
// preloaded region map (basicStore.getRegionId). Confirm the /store/regions
// response actually carries `countries[].iso_2` on-device.
async function resolveRegionId(countryCode) {
  if (!regionsCache) {
    const data = await medusaRequest('/store/regions', { auth: false, params: { fields: 'id,*countries' } });
    regionsCache = data?.regions || [];
  }
  const cc = (countryCode || '').toLowerCase();
  const hasCountry = (r, code) => (r.countries || []).some((c) => (c.iso_2 || '').toLowerCase() === code);
  const match = cc && regionsCache.find((r) => hasCountry(r, cc));
  const ph = regionsCache.find((r) => hasCountry(r, 'ph'));
  const region = match || ph || regionsCache[0];
  if (!region) throw new Error('No Medusa region available.');
  return region.id;
}

// Resolve the Medusa variant for this device model + tier + months, exactly as
// the web top-up does: {model}-data-plan category -> products -> tier-tagged
// product -> variant whose title contains the month count.
// NOTE: RevenueCat has one flat 6-SKU catalog, but Medusa plans are per device
// model, so the variant is model-specific. Confirm `tags` come back with this
// fields selection on-device (the web reads product.tags similarly).
async function resolveVariantId({ model, tier, months, regionId }) {
  if (!model) throw new Error('Device has no model; cannot resolve a data plan.');
  const handle = `${String(model).toLowerCase()}-data-plan`;

  const catData = await medusaRequest('/store/product-categories', {
    auth: false,
    params: { handle },
  });
  const categoryId = catData?.product_categories?.[0]?.id;
  if (!categoryId) throw new Error(`No data-plan category for model "${model}".`);

  const prodData = await medusaRequest('/store/products', {
    auth: false,
    params: { category_id: categoryId, region_id: regionId, fields: '*variants.calculated_price,*tags' },
  });
  const products = prodData?.products || [];
  const tierRe = new RegExp(`^${tier}$`, 'i');
  const product =
    products.find((p) => (p.tags || []).some((t) => tierRe.test(t.value || ''))) || products[0];
  if (!product) throw new Error(`No ${tier} data plan for model "${model}".`);

  const monthStr = String(months);
  const variant = (product.variants || []).find((v) => (v.title || '').includes(monthStr));
  if (!variant) throw new Error(`No ${months}-month ${tier} variant for model "${model}".`);
  return variant.id;
}

/**
 * Create (but do NOT complete) the Medusa cart the RevenueCat webhook will
 * complete after Apple confirms the charge. Returns the cart id to stash as the
 * `pending_cart_id` RevenueCat subscriber attribute.
 *
 * Steps mirror web buyPlan(): resolve customer email -> create cart (Hidden
 * channel + device_imei metadata) -> add line item -> add Digital Delivery.
 */
export async function createTopUpCart({ device, tier, months }) {
  const userStore = useUserStore();
  const firebaseUser = userStore.user;
  if (!firebaseUser?.uid) throw new Error('You must be signed in to purchase a plan.');

  const imei = device?.uniqueId;
  if (!imei) throw new Error('Device is missing its unique ID.');

  const countryCode = userStore.countryCode || null;
  const regionId = await resolveRegionId(countryCode);
  const variantId = await resolveVariantId({ model: device.model, tier, months, regionId });

  // Canonical customer email (JWT attaches the customer; email is still required
  // in the cart body per storefront contract).
  const meRes = await medusaRequest('/store/customers/me');
  const customerEmail = meRes?.customer?.email || firebaseUser.email;
  if (!customerEmail) throw new Error('Unable to resolve your account email for checkout.');

  const cartMeta = { firebase_uid: firebaseUser.uid, device_imei: imei };
  if (countryCode) cartMeta.country_code = countryCode;

  const cartRes = await medusaRequest('/store/carts', {
    method: 'POST',
    data: {
      region_id: regionId,
      sales_channel_id: MEDUSA_HIDDEN_SALES_CHANNEL_ID,
      email: customerEmail,
      metadata: cartMeta,
    },
  });
  const cartId = cartRes?.cart?.id;
  if (!cartId) throw new Error('Failed to create cart.');

  await medusaRequest(`/store/carts/${cartId}/line-items`, {
    method: 'POST',
    data: { variant_id: variantId, quantity: 1, metadata: { imei } },
  });

  await medusaRequest(`/store/carts/${cartId}/shipping-methods`, {
    method: 'POST',
    data: { option_id: MEDUSA_DIGITAL_DELIVERY_OPTION_ID },
  });

  return cartId;
}

// Drop the cached Medusa JWT (e.g. on logout).
export function clearMedusaSession() {
  cachedJwt = null;
}
