// Protocol-aware reading of a Traccar position's telemetry.
//
// The app was written against iStartek VT100/VT120 ("startek") positions, which
// always carry `ignition`, `power`, `battery`, `sat` and a numeric iStartek
// `event` code. Other protocols on tserver1 report the same facts differently
// (profiled from a day of real history, 2026-11-06):
//
//   navtelecom (FUJI trucks)  no `ignition`; ignition is wired to `in1` (true on
//                             995 of 997 moving fixes). `event` is Navtelecom's own
//                             4-digit numbering (5899, 5893, ...), NOT iStartek's.
//   jt808 (V5N dashcams)      `ignition` present; no `power`/`battery`; `rssi` on
//                             the 3GPP CSQ 0..31 scale; alarms only in `alarm`.
//   h02                       `ignition` present; alarms only in `alarm`; no
//                             `sat`/`power`/`battery`.
//
// Every reader takes the whole position (it needs `protocol`) and returns
// undefined/null when the protocol simply does not report that value, so the
// UI shows N/A rather than a wrong number.

// Protocols whose `attributes.event` is an iStartek event code. `osmand` is
// included because posbroker forwards VT100 attributes (event, input, ...) as
// OsmAnd fields; a missing protocol keeps the historical behaviour.
export function usesStartekEventCodes(protocol) {
  return !protocol || protocol === 'startek' || protocol === 'osmand';
}

/**
 * @returns {boolean|null} null when the position carries no ignition signal
 */
export function readIgnition(position) {
  const a = position?.attributes || {};
  if (typeof a.ignition === 'boolean') return a.ignition;
  const protocol = position?.protocol;
  // Navtelecom never sends `ignition`; Traccar exposes the digital inputs as
  // in1..in8 and the ignition line is in1 on our installs.
  if (protocol === 'navtelecom' && typeof a.in1 === 'boolean') return a.in1;
  // VT100 carries ignition on input bit 1 when Traccar did not decode it.
  if (usesStartekEventCodes(protocol) && a.input !== undefined && a.input !== null) {
    return (Number(a.input) & 2) > 0;
  }
  return null;
}

/**
 * Cellular signal in dBm. Prefers the cell-tower reading (unchanged behaviour),
 * then `attributes.rssi`: a negative value is already dBm, 0..31 is the CSQ
 * scale (dBm = 2*CSQ - 113), and 99 means "unknown" on that scale.
 * @returns {number|undefined}
 */
export function readSignalDbm(position) {
  const tower = position?.network?.cellTowers?.[0]?.signalStrength;
  if (typeof tower === 'number' && Number.isFinite(tower)) return tower;
  const raw = position?.attributes?.rssi;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n < 0) return n;
  if (n > 31) return undefined;
  return 2 * n - 113;
}

const toNumber = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** External (vehicle) supply in volts, or undefined when not reported. */
export const readPower = (position) => toNumber(position?.attributes?.power);

/** Internal backup battery in volts, or undefined when not reported. */
export const readBattery = (position) => toNumber(position?.attributes?.battery);

/**
 * iStartek event code, only for protocols that use iStartek numbering.
 * Navtelecom's 4-digit codes would otherwise collide with nothing today but
 * could be misread the moment one lands on 18/19/20/27/28.
 * @returns {number|undefined}
 */
export function readStartekEvent(position) {
  if (!usesStartekEventCodes(position?.protocol)) return undefined;
  return toNumber(position?.attributes?.event);
}

/**
 * Traccar's normalised alarm keys. Traccar joins simultaneous alarms with ",".
 * @returns {string[]}
 */
export function readAlarms(position) {
  const raw = position?.attributes?.alarm;
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
