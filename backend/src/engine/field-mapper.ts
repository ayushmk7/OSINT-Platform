import { SourceConfig } from './yaml-loader';

export interface EntityRecord {
  id: string;
  source_id: string;
  category: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface ObservationRecord {
  id: string;
  entity_id: string;
  source_id: string;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  heading: number;
  timestamp: string;
  raw_payload: Record<string, unknown>;
}

/** Resolve a dot/bracket path (`geometry.coordinates[1]`) against the raw record. */
export function resolvePath(obj: unknown, pathStr?: string): unknown {
  if (!pathStr || obj == null) return undefined;
  const normalized = pathStr.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalized.split('.');
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr == null || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

/**
 * Resolve a mapping expression: try it as a path first; if it does not resolve but is a
 * numeric string (e.g. "0"), treat it as a LITERAL constant. This is why `altitude: "0"`
 * yields 0 instead of looking up a field named "0".
 */
export function resolveValue(obj: unknown, expr?: string): unknown {
  if (expr === undefined || expr === null) return undefined;
  const viaPath = resolvePath(obj, expr);
  if (viaPath !== undefined) return viaPath;
  if (typeof expr === 'string' && expr.trim() !== '' && !Number.isNaN(Number(expr))) {
    return Number(expr); // literal number
  }
  return undefined;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
}

function toNumberOrZero(v: unknown): number {
  const n = toNumber(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize a source timestamp (epoch sec/ms or ISO) to { ms, iso, fromSource }.
 * fromSource=false means the source provided nothing usable and we fell back to ingest time.
 */
function normalizeTimestamp(rawTs: unknown): { ms: number; iso: string; fromSource: boolean } {
  if (rawTs !== undefined && rawTs !== null && rawTs !== '') {
    let ms: number | null = null;
    if (typeof rawTs === 'number') {
      ms = rawTs > 1e11 ? rawTs : rawTs * 1000; // heuristic: seconds vs milliseconds
    } else {
      const asNumber = Number(rawTs);
      if (!Number.isNaN(asNumber) && String(rawTs).trim() !== '') {
        ms = asNumber > 1e11 ? asNumber : asNumber * 1000;
      } else {
        const parsed = Date.parse(String(rawTs));
        if (!Number.isNaN(parsed)) ms = parsed;
      }
    }
    if (ms !== null && Number.isFinite(ms)) {
      return { ms, iso: new Date(ms).toISOString(), fromSource: true };
    }
  }
  const now = Date.now();
  return { ms: now, iso: new Date(now).toISOString(), fromSource: false };
}

/**
 * Returns null when the record cannot be plotted (no id or no valid coordinates) — the
 * scheduler skips nulls. We NEVER coerce a missing coordinate to 0 and plot it at (0,0).
 */
export function mapRecord(
  raw: unknown,
  config: SourceConfig,
  sourceId: string
): { entity: EntityRecord; observation: ObservationRecord } | null {
  const extIdRaw = resolveValue(raw, config.entity.external_id);
  if (extIdRaw === undefined || extIdRaw === null || String(extIdRaw) === '') {
    return null; // no stable identity -> skip (do not invent a random id)
  }
  const extId = String(extIdRaw);
  const name = String(resolveValue(raw, config.entity.name) ?? extId);
  const category = config.entity.category || config.layer_type || 'general';

  const lat = toNumber(resolveValue(raw, config.observation.latitude));
  const lon = toNumber(resolveValue(raw, config.observation.longitude));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null; // missing/invalid position -> skip (never plot at 0,0)
  }

  const alt = toNumberOrZero(resolveValue(raw, config.observation.altitude));
  const speed = toNumberOrZero(resolveValue(raw, config.observation.speed));
  const heading = toNumberOrZero(resolveValue(raw, config.observation.heading));

  const {
    ms: tsMs,
    iso: isoTimestamp,
    fromSource: tsFromSource
  } = normalizeTimestamp(resolveValue(raw, config.observation.timestamp));

  const metadata: Record<string, unknown> = {};
  if (config.entity.metadata) {
    for (const [key, expr] of Object.entries(config.entity.metadata)) {
      metadata[key] = resolveValue(raw, expr);
    }
  }

  const entity: EntityRecord = {
    id: extId,
    source_id: sourceId,
    category,
    name,
    latitude: lat,
    longitude: lon,
    altitude: alt,
    timestamp: isoTimestamp,
    metadata
  };

  // Deterministic, mode-aware observation id — the core of deduplication.
  //  - upsert: one row per entity.
  //  - append with a real source timestamp: one row per (entity, instant).
  //  - append WITHOUT a source timestamp (e.g. ADSB): key on rounded position, so a
  //    stationary target does not create a new row every poll (movement still does).
  const mode = config.recording?.mode ?? 'append';
  let obsId: string;
  if (mode === 'upsert') {
    obsId = `obs_${extId}`;
  } else if (tsFromSource) {
    obsId = `obs_${extId}_${tsMs}`;
  } else {
    obsId = `obs_${extId}_${lat.toFixed(4)}_${lon.toFixed(4)}`;
  }

  const observation: ObservationRecord = {
    id: obsId,
    entity_id: extId,
    source_id: sourceId,
    latitude: lat,
    longitude: lon,
    altitude: alt,
    speed,
    heading,
    timestamp: isoTimestamp,
    raw_payload:
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : { data: raw }
  };

  return { entity, observation };
}
