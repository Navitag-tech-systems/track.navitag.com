import { describe, it, expect } from 'vitest';
import {
  readIgnition, readSignalDbm, readPower, readBattery, readStartekEvent, readAlarms, usesStartekEventCodes,
} from './telemetry.js';
import VT100MapProcessor from './reportProcessor.js';

// Attribute shapes copied from real tserver1/track4 history (2026-11-06).
const startek = (o = {}) => ({ protocol: 'startek', valid: true, attributes: { ignition: true, power: 12.6, battery: 4.1, sat: 12, event: 0, input: 2, ...o } });
const navtelecom = (o = {}) => ({ protocol: 'navtelecom', valid: true, attributes: { in1: true, in2: false, power: 27.7, battery: 4.2, sat: 17, event: 5899, ...o } });
const jt808 = (o = {}) => ({ protocol: 'jt808', valid: true, attributes: { ignition: true, rssi: 31, sat: 24, charge: false, input: 0, ...o } });
const h02 = (o = {}) => ({ protocol: 'h02', valid: true, attributes: { ignition: true, status: 4294942719, ...o } });

describe('readIgnition', () => {
  it('uses attributes.ignition when present (startek, jt808, h02)', () => {
    expect(readIgnition(startek({ ignition: false }))).toBe(false);
    expect(readIgnition(jt808())).toBe(true);
    expect(readIgnition(h02({ ignition: false }))).toBe(false);
  });
  it('reads navtelecom ignition from in1', () => {
    expect(readIgnition(navtelecom())).toBe(true);
    expect(readIgnition(navtelecom({ in1: false }))).toBe(false);
  });
  it('falls back to the VT100 input bit only for startek-numbered protocols', () => {
    expect(readIgnition({ protocol: 'startek', attributes: { input: 2 } })).toBe(true);
    expect(readIgnition({ attributes: { input: 0 } })).toBe(false);
    // jt808 `input` is a different bitfield: no ignition guess from it
    expect(readIgnition({ protocol: 'jt808', attributes: { input: 2 } })).toBe(null);
  });
  it('returns null when nothing reports ignition', () => {
    expect(readIgnition({ protocol: 'h02', attributes: {} })).toBe(null);
  });
});

describe('readSignalDbm', () => {
  it('prefers the cell tower reading', () => {
    expect(readSignalDbm({ network: { cellTowers: [{ signalStrength: -71 }] }, attributes: { rssi: 5 } })).toBe(-71);
  });
  it('converts CSQ 0..31 to dBm and ignores 99', () => {
    expect(readSignalDbm(jt808({ rssi: 31 }))).toBe(-51);
    expect(readSignalDbm(jt808({ rssi: 9 }))).toBe(-95);
    expect(readSignalDbm(jt808({ rssi: 99 }))).toBeUndefined();
  });
  it('passes a negative rssi through as dBm', () => {
    expect(readSignalDbm({ attributes: { rssi: -88 } })).toBe(-88);
  });
});

describe('power, battery, events, alarms', () => {
  it('reads volts or undefined', () => {
    expect(readPower(navtelecom())).toBe(27.7);
    expect(readBattery(navtelecom())).toBe(4.2);
    expect(readPower(jt808())).toBeUndefined();
    expect(readBattery(h02())).toBeUndefined();
  });
  it('only treats event as an iStartek code on startek/osmand/unknown', () => {
    expect(usesStartekEventCodes('osmand')).toBe(true);
    expect(readStartekEvent(startek({ event: 18 }))).toBe(18);
    expect(readStartekEvent(navtelecom({ event: 18 }))).toBeUndefined();
  });
  it('splits Traccar multi-alarms', () => {
    expect(readAlarms(h02({ alarm: 'powerCut,sos' }))).toEqual(['powerCut', 'sos']);
    expect(readAlarms(h02())).toEqual([]);
  });
});

describe('VT100MapProcessor across protocols', () => {
  const at = (i) => `2026-11-06T0${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}:00.000+00:00`;
  const route = (make, overrides) =>
    overrides.map((o, i) => ({ id: i + 1, latitude: 14.6 + i * 0.0001, longitude: 121, fixTime: at(i), ...make(o) }));
  const types = (r) => new VT100MapProcessor().generateMapData(r).events.map((e) => e.type);

  it('navtelecom: ignition events from in1, no fake events from its 4-digit codes', () => {
    const r = route(navtelecom, [{ in1: false }, { in1: true }, { in1: true, event: 18 }, { in1: false }, {}]);
    expect(types(r)).toEqual(['Ignition On', 'Ignition Off', 'Ignition On']);
  });
  it('h02: power cut / restore and SOS from Traccar alarm keys', () => {
    const r = route(h02, [{}, { alarm: 'powerCut' }, { alarm: 'powerRestored' }, { alarm: 'sos' }, {}]);
    expect(types(r)).toEqual(['Power Cut', 'Power Restored', 'SOS']);
  });
  it('jt808: weak CSQ signal raises GSM events; unknown alarms keep their name', () => {
    const r = route(jt808, [{ rssi: 31 }, { rssi: 5 }, { rssi: 20 }, { alarm: 'tampering' }]);
    expect(types(r)).toEqual(['GSM Signal Low', 'GSM Signal Recovery', 'Tampering']);
  });
  it('startek: unchanged (event codes, alarm attribute not double-counted)', () => {
    const r = route(startek, [{}, { event: 18, alarm: 'powerCut', power: 0 }, { event: 19, power: 12.5 }, { event: 1, alarm: 'sos' }]);
    expect(types(r)).toEqual(['Power Cut', 'Power Restored', 'SOS']);
  });
});
