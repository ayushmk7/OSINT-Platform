import type Database from 'better-sqlite3';

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in km. Returns null when any input is not a finite number. */
export function haversineKm(
  lat1: unknown,
  lon1: unknown,
  lat2: unknown,
  lon2: unknown
): number | null {
  const nums = [lat1, lon1, lat2, lon2].map((v) => (typeof v === 'number' ? v : Number(v)));
  if (nums.some((n) => !Number.isFinite(n)) || [lat1, lon1, lat2, lon2].some((v) => v === null)) {
    return null;
  }
  const [a1, o1, a2, o2] = nums.map((d) => (d * Math.PI) / 180);
  const h =
    Math.sin((a2 - a1) / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin((o2 - o1) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Same function as source text, for the read-only query worker (a separate isolate cannot
 * share the closure above). Keep the two in sync; sql-guard tests exercise both.
 */
export const HAVERSINE_JS = `function (lat1, lon1, lat2, lon2) {
  var vals = [lat1, lon1, lat2, lon2];
  for (var i = 0; i < 4; i++) { if (vals[i] === null) return null; vals[i] = Number(vals[i]); if (!isFinite(vals[i])) return null; }
  var r = Math.PI / 180, a1 = vals[0] * r, o1 = vals[1] * r, a2 = vals[2] * r, o2 = vals[3] * r;
  var h = Math.pow(Math.sin((a2 - a1) / 2), 2) + Math.cos(a1) * Math.cos(a2) * Math.pow(Math.sin((o2 - o1) / 2), 2);
  return 2 * ${EARTH_RADIUS_KM} * Math.asin(Math.min(1, Math.sqrt(h)));
}`;

/** Registers `haversine_km(lat1, lon1, lat2, lon2)` on a connection. Idempotent per connection. */
export function registerSqlFunctions(db: Database.Database): void {
  db.function('haversine_km', { deterministic: true }, (lat1, lon1, lat2, lon2) =>
    haversineKm(lat1, lon1, lat2, lon2)
  );
}
