// Single source of truth for share-permission scopes.
//
// Two distinct concerns live here:
//
// 1. GATE CHECKING — does the current viewer of a device have permission to
//    perform an action against it? Answered by hasScope(device, scope).
//    Owned devices carry the sentinel OWNER_SENTINEL ('owner:all') instead of
//    an enumerated list, so a new backend scope works automatically for
//    owners without a frontend code change. Shared devices carry the exact
//    scope strings returned by POST /share/tome.
//
// 2. GRANT UI — what scopes can a device owner offer to a grantee via the
//    share screen? GRANTABLE_SCOPES is the catalog the invite + per-grantee
//    editor render from. position:live is the floor scope (always implied
//    server-side) so it's not listed. notification:read is accepted by the
//    backend but not yet end-to-end supported, so it's omitted from the UI
//    catalog while remaining in SCOPE_LABELS so already-granted scopes
//    render with a friendly label.

export const OWNER_SENTINEL = 'owner:all';

/**
 * True when the device carries either the owner sentinel or the exact scope
 * requested. Falsy device / missing scopes array → false.
 */
export function hasScope(device, scope) {
  const scopes = device?.scopes;
  if (!Array.isArray(scopes)) return false;
  return scopes.includes(OWNER_SENTINEL) || scopes.includes(scope);
}

export const GRANTABLE_SCOPES = [
  { key: 'history:read', label: 'History',                 icon: 'fa-clock-rotate-left' },
  { key: 'share:public', label: 'Mint public share links', icon: 'fa-share-nodes' },
  { key: 'energy:read',  label: 'Energy data (read)',      icon: 'fa-gas-pump' },
  { key: 'energy:write', label: 'Energy data (write)',     icon: 'fa-pen' },
];

export const SCOPE_LABELS = {
  'position:live':     'Live position',
  'history:read':      'History',
  'notification:read': 'Notifications',
  'share:public':      'Public share links',
  'energy:read':       'Energy data (read)',
  'energy:write':      'Energy data (write)',
};
