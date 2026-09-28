import * as satellite from 'satellite.js';

/** Parser formats whose records are orbital element sets that must be propagated. */
export const ORBITAL_FORMATS = ['tle', 'omm_json'] as const;

export function isOrbitalFormat(format: unknown): boolean {
  return (ORBITAL_FORMATS as readonly unknown[]).includes(format);
}

/** Output fields added to every propagated record. */
export interface PropagatedFields {
  /** Geodetic latitude, degrees. */
  lat: number;
  /** Geodetic longitude, degrees (-180..180). */
  lon: number;
  /** Height above the WGS-72 ellipsoid, metres. */
  alt: number;
  /** Inertial (ECI) speed, metres per second. */
  speed: number;
  /** Ground-track heading, degrees clockwise from true north. */
  heading: number;
  /** Instant the position was computed for (ISO-8601). */
  timestamp: string;
}

// satrec construction parses the TLE and runs SGP4 init; cache it per element record object
// so re-propagation ticks only pay for the propagation itself.
const satrecCache = new WeakMap<object, satellite.SatRec | null>();

function satrecFor(rec: Record<string, unknown>): satellite.SatRec | null {
  const cached = satrecCache.get(rec);
  if (cached !== undefined) return cached;
  let satrec: satellite.SatRec | null = null;
  if (typeof rec.line1 === 'string' && typeof rec.line2 === 'string') {
    try {
      satrec = satellite.twoline2satrec(rec.line1, rec.line2);
      if ((satrec as unknown as { error?: number }).error) satrec = null;
    } catch {
      satrec = null;
    }
  }
  satrecCache.set(rec, satrec);
  return satrec;
}

function geodeticAt(
  satrec: satellite.SatRec,
  date: Date
): { lat: number; lon: number; alt: number; speed: number } | null {
  const pv = satellite.propagate(satrec, date);
  const pos = pv.position;
  const vel = pv.velocity;
  if (!pos || typeof pos === 'boolean' || !vel || typeof vel === 'boolean') return null;
  const gd = satellite.eciToGeodetic(pos, satellite.gstime(date));
  const lat = satellite.degreesLat(gd.latitude);
  const lon = satellite.degreesLong(gd.longitude);
  const alt = gd.height * 1000;
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) * 1000;
  if (![lat, lon, alt, speed].every(Number.isFinite)) return null;
  return { lat, lon, alt, speed };
}

/** Initial great-circle bearing from point 1 to point 2, degrees 0..360. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (((Math.atan2(y, x) / toRad) % 360) + 360) % 360;
}

/**
 * Propagate one element record (with `line1`/`line2`) to `date`. Returns null when the set
 * cannot be parsed or SGP4 fails (decayed object, bad elements).
 */
export function propagateRecord(
  rec: Record<string, unknown>,
  date: Date
): (Record<string, unknown> & PropagatedFields) | null {
  const satrec = satrecFor(rec);
  if (!satrec) return null;
  const now = geodeticAt(satrec, date);
  if (!now) return null;
  const next = geodeticAt(satrec, new Date(date.getTime() + 1000));
  const heading = next ? bearingDeg(now.lat, now.lon, next.lat, next.lon) : 0;
  return { ...rec, ...now, heading, timestamp: date.toISOString() };
}

/** Propagate every element record to `date`, silently dropping the ones SGP4 rejects. */
export function propagateRecords(records: unknown[], date: Date = new Date()): unknown[] {
  const out: unknown[] = [];
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const p = propagateRecord(rec as Record<string, unknown>, date);
    if (p) out.push(p);
  }
  return out;
}
