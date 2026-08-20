import { describe, it, expect } from 'vitest';
import { buildPositionsCsv, csvFilename } from './positionsCsv.js';

const at = (h, m) => `2026-08-19T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000+00:00`;

describe('buildPositionsCsv', () => {
  it('emits a header even with no rows', () => {
    const csv = buildPositionsCsv([]);
    expect(csv.split('\r\n')).toHaveLength(1);
    expect(csv).toContain('fix_time,latitude,longitude,speed_kph');
  });

  it('converts speed from knots to km/h', () => {
    // 21.6 kn = 40.0 km/h. Exporting the raw knots under a "speed" header is how
    // a spreadsheet ends up disagreeing with the screen it came from.
    const csv = buildPositionsCsv([
      { fixTime: at(6, 0), latitude: 14.5, longitude: 121, speed: 21.6, attributes: {} },
    ]);
    expect(csv.split('\r\n')[1]).toContain(',40,');
  });

  it('sorts oldest first regardless of input order', () => {
    const csv = buildPositionsCsv([
      { fixTime: at(9, 0), latitude: 1, longitude: 1, attributes: {} },
      { fixTime: at(7, 0), latitude: 2, longitude: 2, attributes: {} },
    ]);
    const [, first, second] = csv.split('\r\n');
    expect(first).toContain('T07:00');
    expect(second).toContain('T09:00');
  });

  it('escapes commas and quotes in addresses', () => {
    const csv = buildPositionsCsv([
      { fixTime: at(6, 0), latitude: 1, longitude: 1, address: 'Katipunan Ave, Quezon City', attributes: {} },
      { fixTime: at(6, 1), latitude: 1, longitude: 1, address: 'The "Old" Depot', attributes: {} },
    ]);
    expect(csv).toContain('"Katipunan Ave, Quezon City"');
    expect(csv).toContain('"The ""Old"" Depot"');
  });

  it('reads ignition from the boolean when present', () => {
    const csv = buildPositionsCsv([
      { fixTime: at(6, 0), latitude: 1, longitude: 1, attributes: { ignition: true } },
    ]);
    expect(csv.split('\r\n')[1]).toContain(',on,');
  });

  it('falls back to the VT100 input mask when ignition is absent', () => {
    const on = buildPositionsCsv([{ fixTime: at(6, 0), latitude: 1, longitude: 1, attributes: { input: 2 } }]);
    const off = buildPositionsCsv([{ fixTime: at(6, 0), latitude: 1, longitude: 1, attributes: { input: 0 } }]);
    expect(on.split('\r\n')[1]).toContain(',on,');
    expect(off.split('\r\n')[1]).toContain(',off,');
  });

  it('leaves a missing attribute as an empty cell, not a missing column', () => {
    const csv = buildPositionsCsv([
      { fixTime: at(6, 0), latitude: 1, longitude: 1, attributes: {} },
    ]);
    const header = csv.split('\r\n')[0].split(',');
    const row = csv.split('\r\n')[1].split(',');
    expect(row).toHaveLength(header.length);
  });

  it('skips rows with no fixTime rather than emitting an invalid date', () => {
    const csv = buildPositionsCsv([
      { latitude: 1, longitude: 1, attributes: {} },
      { fixTime: at(6, 0), latitude: 1, longitude: 1, attributes: {} },
    ]);
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('tolerates a non-array', () => {
    expect(buildPositionsCsv(null).split('\r\n')).toHaveLength(1);
  });
});

describe('csvFilename', () => {
  it('joins imei, name and date', () => {
    expect(csvFilename({ imei: '865395075676245', name: 'Civic', date: '2026-08-19' }))
      .toBe('865395075676245_Civic_2026-08-19.csv');
  });

  it('collapses spaces and punctuation that break a download', () => {
    expect(csvFilename({ imei: '123', name: 'FUJI AWA5326', date: '2026-08-19' }))
      .toBe('123_FUJI-AWA5326_2026-08-19.csv');
    expect(csvFilename({ imei: '123', name: 'a/b:c*d?', date: '2026-08-19' }))
      .toBe('123_a-b-c-d_2026-08-19.csv');
  });

  it('survives a device with no name', () => {
    expect(csvFilename({ imei: '123', name: null, date: '2026-08-19' }))
      .toBe('123_2026-08-19.csv');
  });

  it('caps a pathological name', () => {
    const name = 'x'.repeat(200);
    expect(csvFilename({ imei: '123', name, date: '2026-08-19' }).length).toBeLessThan(70);
  });
});
