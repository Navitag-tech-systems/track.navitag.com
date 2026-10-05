// Human label for a notification event_type key, shared by the per-device
// toggles (deviceSettings.vue) and the per-event bulk rows (account/index.vue).
//
//   ignitionOn            -> "Ignition On"
//   alarm:powerCut        -> "Power Cut"   (one toggle per alarm subtype)
//   activity_lock_breach  -> "Activity lock breach"
export function humanizeEvent(eventType) {
  if (!eventType) return '';
  if (eventType.startsWith('alarm:')) {
    return humanizeEvent(eventType.slice('alarm:'.length));
  }
  if (eventType.includes(':')) {
    const [prefix, subtype] = eventType.split(':');
    return `${humanizeEvent(prefix)}: ${humanizeEvent(subtype)}`;
  }
  return eventType
    .replace(/[_-]/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
