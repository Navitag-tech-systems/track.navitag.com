/**
 * CSV export for a day of history positions.
 *
 * Kept out of dailyRoute.vue so the column decisions and the escaping are
 * testable without mounting a view.
 *
 * WHY A FIXED COLUMN SET. Traccar position rows carry a nested `attributes`
 * object whose keys vary per fix -- ignition, power, battery, sat, event, rssi,
 * and a dozen protocol-specific extras that appear only when the tracker sends
 * them. Flattening whatever happens to be present produces a ragged file whose
 * columns change between one day and the next, which is useless to anything
 * downstream. The set below is the one every VT100 fix can populate, and a
 * missing value is an empty cell rather than a missing column.
 */

// Traccar reports speed in knots; the app shows km/h everywhere else. Exporting
// the raw number under a bare "speed" header is how a spreadsheet ends up
// quietly disagreeing with the screen it was exported from.
const KNOTS_TO_KPH = 1.852;

const COLUMNS = [
  'fix_time',
  'latitude',
  'longitude',
  'speed_kph',
  'course_deg',
  'ignition',
  'address',
  'external_power_v',
  'battery_v',
  'satellites',
  'valid_fix',
  'event_code',
];

/**
 * RFC 4180 escaping. Addresses routinely contain commas, and device-reported
 * text can contain quotes, so this is not optional.
 */
function cell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// VT100 carries ignition on input bit 1. Traccar usually decodes it into
// attributes.ignition, but not on every protocol/firmware pair -- so fall back
// to the raw mask rather than exporting a blank column for a vehicle that was
// plainly running.
function readIgnition(attrs) {
  if (typeof attrs.ignition === 'boolean') return attrs.ignition;
  if (attrs.input !== undefined) return (Number(attrs.input) & 2) > 0;
  return null;
}

/**
 * @param {Array} positions raw Traccar position objects, any order
 * @returns {string} CSV text with a header row, oldest fix first
 */
export function buildPositionsCsv(positions) {
  const rows = (Array.isArray(positions) ? positions : [])
    .filter((p) => p && p.fixTime)
    .sort((a, b) => new Date(a.fixTime) - new Date(b.fixTime))
    .map((p) => {
      const attrs = p.attributes || {};
      const ignition = readIgnition(attrs);
      return [
        p.fixTime,
        p.latitude,
        p.longitude,
        Math.round(Number(p.speed || 0) * KNOTS_TO_KPH * 10) / 10,
        p.course ?? '',
        ignition === null ? '' : ignition ? 'on' : 'off',
        p.address || '',
        attrs.power ?? '',
        attrs.battery ?? '',
        attrs.sat ?? '',
        p.valid === undefined ? '' : p.valid ? 'yes' : 'no',
        attrs.event ?? '',
      ].map(cell).join(',');
    });

  return [COLUMNS.join(','), ...rows].join('\r\n');
}

/**
 * `865395075676245_FUJI-AWA5326_2026-08-19.csv`
 *
 * Device names are free text and routinely carry spaces and punctuation
 * ("FUJI AWA5326"); a slash or colon in one produces a download the browser
 * rejects or silently renames, so everything outside a safe set collapses to a
 * hyphen. The IMEI leads because it is the stable identifier -- a device can be
 * renamed, and two can share a name.
 */
export function csvFilename({ imei, name, date }) {
  const safeName = String(name || '')
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return [imei || 'device', safeName, date].filter(Boolean).join('_') + '.csv';
}

/**
 * Hand the file to the browser.
 *
 * Web only. Inside the Capacitor shell an object-URL download has nowhere to
 * land -- native needs @capacitor/filesystem plus a share sheet, which is a
 * different feature, so the caller gates on platform rather than this failing
 * quietly on a phone.
 */
export function downloadCsv(filename, csvText) {
  // A UTF-8 BOM, because Excel assumes the ANSI codepage otherwise and mangles
  // every non-ASCII character in an address.
  const blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
