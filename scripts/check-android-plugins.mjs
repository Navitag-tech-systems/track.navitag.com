/**
 * Guards the Android plugin allow-list in capacitor.config.json.
 *
 * WHY THIS EXISTS
 * ---------------
 * `android.includePlugins` keeps RevenueCat/IAP out of the Android build —
 * Android has no IAP and is meant to stay that way, so the Play Billing library
 * should not be compiled into the AAB at all.
 *
 * But read @capacitor/cli/dist/plugin.js getPlugins(): includePlugins REPLACES
 * the package.json dependency scan, it does not filter it. It is an allow-list,
 * not a deny-list. So the moment someone runs `npm i @capacitor/something` and
 * forgets this file, that plugin is silently missing from Android only. The AAB
 * still compiles; the app throws "not implemented on android" at runtime, on a
 * device, in a code path nobody tested. That is a genuinely awful failure to
 * debug, and a comment in a JSON file cannot prevent it (JSON has no comments).
 *
 * So this runs in CI before `cap sync android` and fails the build instead.
 *
 *   node scripts/check-android-plugins.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

// Plugins deliberately kept OFF Android. Adding a name here is a decision;
// leaving one out by accident is what the check below is for.
const INTENTIONAL_EXCLUSIONS = {
  '@revenuecat/purchases-capacitor':
    'Android has no IAP — keeps Play Billing out of the AAB entirely',
};

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const cfg = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
const allow = cfg.android?.includePlugins;

if (!Array.isArray(allow)) {
  console.error(
    'FAIL: capacitor.config.json has no android.includePlugins array.\n' +
    '      Without it, `cap sync android` pulls in EVERY plugin — including\n' +
    '      RevenueCat, which must not ship on Android.'
  );
  process.exit(1);
}

// Mirror the CLI: a dependency is a plugin iff its package.json has a
// `capacitor` key, and it supports Android iff that key has an `android` entry.
const androidCapable = [];
for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const f = path.join('node_modules', dep, 'package.json');
  if (!fs.existsSync(f)) continue;
  const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (meta.capacitor?.android) androidCapable.push(dep);
}

const allowSet = new Set(allow);
const errors = [];

// 1. A plugin exists, works on Android, and is neither allowed nor knowingly excluded.
for (const p of androidCapable) {
  if (allowSet.has(p) || p in INTENTIONAL_EXCLUSIONS) continue;
  errors.push(
    `NEW PLUGIN NOT LISTED: ${p}\n` +
    `    It supports Android but is absent from android.includePlugins, so it\n` +
    `    would be silently omitted from the AAB and throw "not implemented on\n` +
    `    android" at runtime. Add it to the list, or add it to\n` +
    `    INTENTIONAL_EXCLUSIONS in this script if it is meant to be iOS-only.`
  );
}

// 2. The list names something that is not an installed Android-capable plugin.
const capableSet = new Set(androidCapable);
for (const p of allow) {
  if (!capableSet.has(p)) {
    errors.push(
      `STALE ENTRY: ${p}\n` +
      `    Listed in android.includePlugins but is not an installed plugin with\n` +
      `    Android support. cap sync will fail to resolve it ("Unable to find\n` +
      `    node_modules/${p}"). Remove it.`
    );
  }
}

// 3. An exclusion that is no longer a dependency — the reason for it is gone.
for (const p of Object.keys(INTENTIONAL_EXCLUSIONS)) {
  if (!capableSet.has(p)) {
    console.warn(
      `note: '${p}' is listed as an intentional exclusion but is no longer an\n` +
      `      Android-capable dependency. Harmless, but the entry is now dead.`
    );
  }
}

if (errors.length) {
  console.error('\nAndroid plugin allow-list is out of sync:\n');
  for (const e of errors) console.error('  ' + e + '\n');
  process.exit(1);
}

console.log(`Android plugin allow-list OK — ${allow.length} included, ` +
  `${Object.keys(INTENTIONAL_EXCLUSIONS).filter(p => capableSet.has(p)).length} deliberately excluded:`);
for (const p of allow) console.log(`  + ${p}`);
for (const [p, why] of Object.entries(INTENTIONAL_EXCLUSIONS)) {
  if (capableSet.has(p)) console.log(`  - ${p}  (${why})`);
}
