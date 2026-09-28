import { DerivedField, FilterRule, ScalableObservationField, SourceConfig } from './yaml-loader';
import { computeDedupeKey } from './dedupe';
import { ExpressionContext, evaluateExpression } from './expressions';

/** Expression context (lookup tables) for one source. */
export function expressionContext(config: Pick<SourceConfig, 'lookups'>): ExpressionContext {
  return { lookups: (config.lookups ?? {}) as Record<string, unknown> };
}

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
export function resolveValue(obj: unknown, expr?: string, ctx?: ExpressionContext): unknown {
  if (expr === undefined || expr === null) return undefined;
  // `=expr` values are evaluated by the sandboxed expression engine (see expressions.ts).
  if (expr.startsWith('=')) return evaluateExpression(expr.slice(1), obj, ctx);
  const viaPath = resolvePath(obj, expr);
  if (viaPath !== undefined) return viaPath;
  if (typeof expr === 'string' && expr.trim() !== '' && !Number.isNaN(Number(expr))) {
    return Number(expr); // literal number
  }
  return undefined;
}

/** A value counts as "present" when it is not null/undefined and not a blank string. */
function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  return String(v).trim() !== '';
}

/**
 * Record-level predicate gate. Returns true when EVERY rule holds (an absent/empty rule list
 * accepts everything). Applied by the scheduler BEFORE `mapRecord`, so records a source
 * deliberately excludes are never confused with malformed ones.
 */
export function passesFilter(raw: unknown, rules?: FilterRule[], ctx?: ExpressionContext): boolean {
  if (!rules || rules.length === 0) return true;

  for (const rule of rules) {
    if (rule.expr !== undefined) {
      const src = rule.expr.startsWith('=') ? rule.expr.slice(1) : rule.expr;
      if (!evaluateExpression(src, raw, ctx)) return false;
      if (rule.field === undefined) continue;
    }

    const value = resolvePath(raw, rule.field);

    if (rule.not_empty === true && !isPresent(value)) return false;

    if (rule.in) {
      if (!isPresent(value)) return false;
      const asString = String(value).trim();
      if (!rule.in.some((candidate) => String(candidate) === asString)) return false;
    }
  }

  return true;
}

/**
 * Expand `{path}` / `{path|lower}` / `{path|upper}` placeholders against the raw record.
 * Returns undefined if ANY placeholder is missing/blank, so a half-built value (e.g. a URL
 * with a hole where the ICAO code should be) is never emitted.
 */
export function applyTemplate(raw: unknown, template: string): string | undefined {
  let missing = false;

  const out = template.replace(
    /\{([^{}|]+)(?:\|(lower|upper))?\}/g,
    (_match, pathStr, modifier) => {
      const value = resolvePath(raw, String(pathStr).trim());
      if (!isPresent(value)) {
        missing = true;
        return '';
      }
      const text = String(value).trim();
      if (modifier === 'lower') return text.toLowerCase();
      if (modifier === 'upper') return text.toUpperCase();
      return text;
    }
  );

  return missing ? undefined : out;
}

/**
 * Compute the `entity.derived` metadata block. Each field is either a `map` lookup keyed on
 * `from` (falling back to `default`) or a `template` string. A field that cannot be resolved
 * is OMITTED rather than written as null, so consumers can test presence.
 */
export function computeDerived(
  raw: unknown,
  derived?: Record<string, DerivedField>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!derived) return out;

  for (const [key, spec] of Object.entries(derived)) {
    if (!spec) continue;

    if (spec.map) {
      const lookup = resolvePath(raw, spec.from);
      const hit = isPresent(lookup) ? spec.map[String(lookup).trim()] : undefined;
      const value = hit !== undefined ? hit : spec.default;
      if (value !== undefined) out[key] = value;
      continue;
    }

    if (spec.template !== undefined) {
      const value = applyTemplate(raw, spec.template);
      if (value !== undefined) out[key] = value;
      else if (spec.default !== undefined) out[key] = spec.default;
      continue;
    }

    // No `map` and no `template`: a plain copy of `from`, with an optional default.
    const copied = resolvePath(raw, spec.from);
    if (isPresent(copied)) out[key] = copied;
    else if (spec.default !== undefined) out[key] = spec.default;
  }

  return out;
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
 * True when the record's latitude/longitude do not resolve to finite numbers. The scheduler
 * uses it with `observation.optional: true` to drop non-geo records silently (counted).
 */
export function isUnlocated(raw: unknown, config: SourceConfig): boolean {
  const ctx = expressionContext(config);
  const lat = toNumber(resolveValue(raw, config.observation.latitude, ctx));
  const lon = toNumber(resolveValue(raw, config.observation.longitude, ctx));
  return !Number.isFinite(lat) || !Number.isFinite(lon);
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
  const ctx = expressionContext(config);
  const extIdRaw = resolveValue(raw, config.entity.external_id, ctx);
  if (extIdRaw === undefined || extIdRaw === null || String(extIdRaw) === '') {
    return null; // no stable identity -> skip (do not invent a random id)
  }
  const extId = String(extIdRaw);
  // Stored ids are namespaced by source so two feeds that reuse an external id (e.g. "1")
  // never overwrite each other's entity or observation rows.
  const entityId = `${sourceId}:${extId}`;
  const name = String(resolveValue(raw, config.entity.name, ctx) ?? extId);
  const scale = config.observation.scale ?? {};
  const scaled = (field: ScalableObservationField, n: number): number => {
    const factor = scale[field];
    return typeof factor === 'number' && Number.isFinite(factor) ? n * factor : n;
  };
  const category = config.entity.category || config.layer_type || 'general';

  const lat = scaled('latitude', toNumber(resolveValue(raw, config.observation.latitude, ctx)));
  const lon = scaled('longitude', toNumber(resolveValue(raw, config.observation.longitude, ctx)));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null; // missing/invalid position -> skip (never plot at 0,0)
  }

  // Altitude is always stored in metres; use `observation.scale.altitude` to convert.
  const alt = scaled(
    'altitude',
    toNumberOrZero(resolveValue(raw, config.observation.altitude, ctx))
  );
  const speed = scaled('speed', toNumberOrZero(resolveValue(raw, config.observation.speed, ctx)));
  const heading = scaled(
    'heading',
    toNumberOrZero(resolveValue(raw, config.observation.heading, ctx))
  );

  const {
    ms: tsMs,
    iso: isoTimestamp,
    fromSource: tsFromSource
  } = normalizeTimestamp(resolveValue(raw, config.observation.timestamp, ctx));

  const metadata: Record<string, unknown> = {};
  if (config.entity.metadata) {
    for (const [key, expr] of Object.entries(config.entity.metadata)) {
      metadata[key] = resolveValue(raw, expr, ctx);
    }
  }
  // Derived fields are computed from the raw record and win over a 1:1 copy of the same key.
  Object.assign(metadata, computeDerived(raw, config.entity.derived));

  const entity: EntityRecord = {
    id: entityId,
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
    obsId = `obs_${entityId}`;
  } else if (mode === 'dedupe') {
    // Content identity: a record already seen (same hash) is ignored by the scheduler.
    const { timestamp: _ingestTs, ...stable } = entity;
    const fallback = tsFromSource ? entity : stable;
    obsId = `obs_${entityId}_${computeDedupeKey(raw, config.recording?.dedupe_fields, fallback, ctx)}`;
  } else if (tsFromSource) {
    obsId = `obs_${entityId}_${tsMs}`;
  } else {
    obsId = `obs_${entityId}_${lat.toFixed(4)}_${lon.toFixed(4)}`;
  }

  const observation: ObservationRecord = {
    id: obsId,
    entity_id: entityId,
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
