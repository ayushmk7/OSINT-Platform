import * as satellite from 'satellite.js';
import { bearingDeg, isOrbitalFormat, propagateRecords } from '../engine/orbit';
import { parsePayload } from '../engine/parsers';
import { ISS_OMM, ISS_TLE } from './fixtures/orbital';

type Rec = Record<string, number | string>;
const AT = new Date('2008-09-20T13:00:00Z');

describe('orbit propagation', () => {
  it('flags orbital formats', () => {
    expect(isOrbitalFormat('tle')).toBe(true);
    expect(isOrbitalFormat('omm_json')).toBe(true);
    expect(isOrbitalFormat('json')).toBe(false);
  });

  it('propagates a TLE to lat/lon/alt(m)/speed(m/s)/heading at the given instant', () => {
    const [iss] = propagateRecords(parsePayload(ISS_TLE.join('\n'), 'tle'), AT) as Rec[];

    // Independent reference computed straight from satellite.js.
    const satrec = satellite.twoline2satrec(ISS_TLE[1], ISS_TLE[2]);
    const pv = satellite.propagate(satrec, AT);
    const gd = satellite.eciToGeodetic(
      pv.position as satellite.EciVec3<number>,
      satellite.gstime(AT)
    );

    expect(iss.lat).toBeCloseTo(satellite.degreesLat(gd.latitude), 6);
    expect(iss.lon).toBeCloseTo(satellite.degreesLong(gd.longitude), 6);
    expect(iss.alt).toBeCloseTo(gd.height * 1000, 0);
    expect(iss.alt).toBeGreaterThan(300_000);
    expect(iss.alt).toBeLessThan(450_000);
    expect(iss.speed).toBeGreaterThan(7_000);
    expect(iss.speed).toBeLessThan(8_000);
    expect(iss.heading).toBeGreaterThanOrEqual(0);
    expect(iss.heading).toBeLessThan(360);
    expect(iss.timestamp).toBe(AT.toISOString());
    expect(iss.name).toBe('ISS (ZARYA)');
    expect(Math.abs(Number(iss.lat))).toBeLessThanOrEqual(51.7); // bounded by inclination
  });

  it('gives the same position for the equivalent OMM record', () => {
    const [fromTle] = propagateRecords(parsePayload(ISS_TLE.join('\n'), 'tle'), AT) as Rec[];
    const [fromOmm] = propagateRecords(
      parsePayload(JSON.stringify([ISS_OMM]), 'omm_json'),
      AT
    ) as Rec[];
    expect(fromOmm.lat).toBeCloseTo(Number(fromTle.lat), 6);
    expect(fromOmm.lon).toBeCloseTo(Number(fromTle.lon), 6);
  });

  it('moves satellites between instants (re-propagation of cached elements)', () => {
    const elements = parsePayload(ISS_TLE.join('\n'), 'tle');
    const [a] = propagateRecords(elements, AT) as Rec[];
    const [b] = propagateRecords(elements, new Date(AT.getTime() + 10_000)) as Rec[];
    expect(a.lon).not.toBeCloseTo(Number(b.lon), 3);
  });

  it('drops element sets SGP4 cannot use', () => {
    const bad = [{ name: 'x', line1: '1 garbage', line2: '2 garbage' }, { name: 'no lines' }, null];
    expect(propagateRecords(bad, AT)).toEqual([]);
  });

  it('computes great-circle bearings', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0);
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90);
    expect(bearingDeg(0, 0, -1, 0)).toBeCloseTo(180);
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270);
  });
});
