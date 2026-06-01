// Prints the next Android versionCode to stdout (just the number).
//
// Why this exists instead of `google-play get-latest-build-number`:
// that CLI returns the max versionCode across ACTIVE track releases only. When a
// draft release is discarded in Play Console, its build no longer appears in any
// track, so the CLI's number drops back down — but Google Play PERMANENTLY reserves
// every versionCode that was ever uploaded (you can never reuse one). Re-using a
// reserved code fails publishing with "Version code N has already been used."
//
// This queries edits.bundles + edits.apks (the full upload library, which retains
// discarded-draft uploads) plus all track release codes, and returns max + 1.
//
// Needs GCLOUD_SERVICE_ACCOUNT_CREDENTIALS (raw service-account JSON) in the env,
// and optionally PACKAGE_NAME (defaults to com.navitag.track). All diagnostics go
// to stderr so stdout is just the number for `BUILD_NUMBER=$(node ...)`.
import crypto from 'node:crypto';

const credsRaw =
  process.env.GCLOUD_SERVICE_ACCOUNT_CREDENTIALS ||
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS;
if (!credsRaw) {
  console.error('next-build-number: missing GCLOUD_SERVICE_ACCOUNT_CREDENTIALS');
  process.exit(1);
}
const pkg = process.env.PACKAGE_NAME || 'com.navitag.track';
const sa = JSON.parse(credsRaw);

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned =
  b64({ alg: 'RS256', typ: 'JWT' }) + '.' +
  b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  });
const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');

const tj = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: unsigned + '.' + sig,
  }),
})).json();
if (!tj.access_token) {
  console.error('next-build-number: token exchange failed:', JSON.stringify(tj).slice(0, 300));
  process.exit(1);
}
const H = { Authorization: `Bearer ${tj.access_token}` };
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}`;

const edit = await (await fetch(`${base}/edits`, { method: 'POST', headers: H })).json();
if (!edit.id) {
  console.error('next-build-number: edits.insert failed:', JSON.stringify(edit).slice(0, 300));
  process.exit(1);
}

const codes = [];
for (const kind of ['bundles', 'apks']) {
  const r = await fetch(`${base}/edits/${edit.id}/${kind}`, { headers: H });
  if (r.ok) {
    const j = await r.json();
    for (const it of (j[kind] || [])) if (it.versionCode) codes.push(Number(it.versionCode));
  }
}
const tr = await fetch(`${base}/edits/${edit.id}/tracks`, { headers: H });
if (tr.ok) {
  const tj2 = await tr.json();
  for (const t of (tj2.tracks || []))
    for (const rel of (t.releases || []))
      for (const vc of (rel.versionCodes || [])) codes.push(Number(vc));
}

// Discard the throwaway edit (read-only intent — nothing committed).
await fetch(`${base}/edits/${edit.id}`, { method: 'DELETE', headers: H }).catch(() => {});

const max = codes.length ? Math.max(...codes) : 0;
console.error(`next-build-number: seen codes [${[...new Set(codes)].sort((a, b) => a - b).join(', ')}] -> next ${max + 1}`);
console.log(max + 1);
