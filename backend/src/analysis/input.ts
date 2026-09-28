import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { parseJsonObject } from '../db/queries';
import { runReadOnlyQuery } from './sql-guard';
import type { AnalysisDefinition, InputFilter, LayersInput } from './types';

/** Rows scanned before the in-memory filter narrows a layer input down to `max_records`. */
const LAYER_SCAN_LIMIT = 5000;
const MAX_METADATA_KEYS = 25;
const MAX_STRING_CHARS = 160;

export type InputRecord = Record<string, unknown>;

export interface InputStats {
  total: number;
  truncated: boolean;
  by_layer: Record<string, number>;
  oldest: string | null;
  newest: string | null;
  lookback_hours: number;
}

export interface AnalysisInput {
  records: InputRecord[];
  stats: InputStats;
  /** Entity ids present in the input — the only ids an insight may reference. */
  entityIds: Set<string>;
  /** sha256 of the records; identical input => identical hash => run skipped. */
  hash: string;
}

function round(n: unknown, dp: number): unknown {
  return typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(dp)) : n;
}

/** Keeps prompts small: long strings clipped, nested objects summarised, key count capped. */
function compactValue(v: unknown): unknown {
  if (typeof v === 'string')
    return v.length > MAX_STRING_CHARS ? `${v.slice(0, MAX_STRING_CHARS)}…` : v;
  if (typeof v === 'number') return round(v, 5);
  if (v === null || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length <= 5 ? v.map(compactValue) : `[${v.length} items]`;
  return '[object]';
}

function compactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta).slice(0, MAX_METADATA_KEYS)) {
    if (v === undefined || v === '') continue;
    out[k] = compactValue(v);
  }
  return out;
}

function fieldValue(row: Record<string, unknown>, field: string): unknown {
  if (field.startsWith('metadata.')) {
    let cur: unknown = row.metadata;
    for (const part of field.slice('metadata.'.length).split('.')) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }
  return row[field];
}

export function matchesFilter(row: Record<string, unknown>, filter: InputFilter): boolean {
  const v = fieldValue(row, filter.field);
  const target = filter.value;
  const num = (x: unknown) =>
    typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
  switch (filter.op) {
    case 'exists':
      return v !== undefined && v !== null && v !== '';
    case '==':
      return v === target || (v != null && String(v) === String(target));
    case '!=':
      return !(v === target || (v != null && String(v) === String(target)));
    case 'in':
      return (
        Array.isArray(target) &&
        target.some((t) => v === t || (v != null && String(v) === String(t)))
      );
    case 'contains':
      return typeof v === 'string' && v.toLowerCase().includes(String(target).toLowerCase());
    default: {
      const a = num(v);
      const b = num(target);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (filter.op === '>') return a > b;
      if (filter.op === '>=') return a >= b;
      if (filter.op === '<') return a < b;
      return a <= b;
    }
  }
}

function shapeEntity(row: Record<string, unknown>): InputRecord {
  return {
    id: row.id,
    layer: row.category,
    name: compactValue(row.name),
    lat: round(row.latitude, 4),
    lon: round(row.longitude, 4),
    alt: round(row.altitude, 0),
    ts: row.timestamp,
    meta: compactMetadata(parseJsonObject(row.metadata))
  };
}

function queryLayers(db: Database.Database, input: LayersInput, since: string): InputRecord[] {
  const rows = db
    .prepare(
      `SELECT id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata
       FROM entities
       WHERE category IN (${input.layers.map(() => '?').join(',')}) AND timestamp >= ?
       ORDER BY timestamp DESC LIMIT ?`
    )
    .all(...input.layers, since, LAYER_SCAN_LIMIT) as Record<string, unknown>[];
  const out: InputRecord[] = [];
  for (const row of rows) {
    const withMeta = { ...row, metadata: parseJsonObject(row.metadata) };
    if (input.filter.every((f) => matchesFilter(withMeta, f))) out.push(row);
  }
  return out;
}

function buildStats(
  records: InputRecord[],
  truncated: boolean,
  lookbackMs: number,
  layerKey: string,
  tsKey: string
): InputStats {
  const byLayer: Record<string, number> = {};
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const r of records) {
    const layer = typeof r[layerKey] === 'string' ? (r[layerKey] as string) : 'rows';
    byLayer[layer] = (byLayer[layer] ?? 0) + 1;
    const ts = r[tsKey];
    if (typeof ts === 'string') {
      if (!oldest || ts < oldest) oldest = ts;
      if (!newest || ts > newest) newest = ts;
    }
  }
  return {
    total: records.length,
    truncated,
    by_layer: byLayer,
    oldest,
    newest,
    lookback_hours: Number((lookbackMs / 3_600_000).toFixed(2))
  };
}

export function hashRecords(records: InputRecord[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

/** Builds the input for one run of `analysis` at `now`. */
export async function collectInput(
  db: Database.Database,
  analysis: AnalysisDefinition,
  now: Date
): Promise<AnalysisInput> {
  const since = new Date(now.getTime() - analysis.input.lookbackMs).toISOString();
  const input = analysis.input;
  let records: InputRecord[];
  let truncated: boolean;
  let stats: InputStats;

  if (input.kind === 'layers') {
    const rows = queryLayers(db, input, since);
    truncated = rows.length > input.maxRecords;
    records = rows.slice(0, input.maxRecords).map(shapeEntity);
    stats = buildStats(records, truncated, input.lookbackMs, 'layer', 'ts');
  } else {
    const result = await runReadOnlyQuery(
      db,
      input.sql,
      { since, now: now.toISOString() },
      { rowCap: input.maxRecords }
    );
    records = result.rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, compactValue(v)]))
    );
    truncated = result.truncated;
    stats = buildStats(records, truncated, input.lookbackMs, 'layer', 'timestamp');
  }

  // Any string `id` / `*_id` column may point at an entity; the engine checks existence.
  const entityIds = new Set<string>();
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if ((k === 'id' || k.endsWith('_id')) && typeof v === 'string') entityIds.add(v);
    }
  }
  return { records, stats, entityIds, hash: hashRecords(records) };
}

/** `{{records}}` / `{{stats}}` / `{{now}}` substitution. Records render as JSON lines. */
export function renderPrompt(template: string, input: AnalysisInput, now: Date): string {
  const records = input.records.map((r) => JSON.stringify(r)).join('\n') || '(no records)';
  const stats = JSON.stringify(input.stats);
  let usedRecords = false;
  const out = template.replace(/\{\{\s*(records|stats|now)\s*\}\}/g, (_m, key: string) => {
    if (key === 'records') {
      usedRecords = true;
      return records;
    }
    return key === 'stats' ? stats : now.toISOString();
  });
  // A template that forgot {{records}} still gets the data, appended at the end.
  return usedRecords ? out : `${out}\n\nRecords (JSON lines):\n${records}`;
}
