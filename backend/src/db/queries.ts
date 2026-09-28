import { getDatabase } from './database';

/** Hard ceiling on rows any single REST query may return. */
export const MAX_PAGE_SIZE = 1000;
export const DEFAULT_PAGE_SIZE = 100;

export interface EntityFilterOptions {
  category?: string;
  source_id?: string;
  min_lat?: number;
  max_lat?: number;
  min_lon?: number;
  max_lon?: number;
  limit?: number;
  offset?: number;
}

export interface ObservationFilterOptions {
  entity_id?: string;
  source_id?: string;
  limit?: number;
  offset?: number;
}

function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit) || limit <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

function clampOffset(offset?: number): number {
  if (offset === undefined || Number.isNaN(offset) || offset < 0) return 0;
  return offset;
}

/**
 * Wire-format normalisation. SQLite stores `metadata` / `raw_payload` as JSON TEXT and
 * `enabled` as INTEGER 0/1; every REST response and WS frame exposes them as a parsed object
 * and a boolean instead, so clients never have to JSON.parse a field.
 */
export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {}; // a malformed blob must never fail the whole response
  }
}

type Row = Record<string, unknown>;

/** `layer` / `display` are JSON TEXT; null when the row predates them. */
function parseJsonOrNull(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const parsed = parseJsonObject(value);
  return Object.keys(parsed).length > 0 ? parsed : null;
}

export function serializeSource(row: Row): Row {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    kind: typeof row.kind === 'string' && row.kind !== '' ? row.kind : 'geo',
    layer: parseJsonOrNull(row.layer),
    display: parseJsonOrNull(row.display)
  };
}

export function serializeEntity(row: Row): Row {
  return { ...row, metadata: parseJsonObject(row.metadata) };
}

export function serializeObservation(row: Row): Row {
  return { ...row, raw_payload: parseJsonObject(row.raw_payload) };
}

export interface Page {
  rows: Row[];
  /** Rows matching the filters, independent of limit/offset. */
  total: number;
}

export function getAllSources(): Row[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM sources ORDER BY id ASC').all() as Row[]).map(serializeSource);
}

function entityWhere(options: EntityFilterOptions): { where: string; params: (string | number)[] } {
  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (options.category) {
    where += ' AND category = ?';
    params.push(options.category);
  }
  if (options.source_id) {
    where += ' AND source_id = ?';
    params.push(options.source_id);
  }
  if (options.min_lat !== undefined) {
    where += ' AND latitude >= ?';
    params.push(options.min_lat);
  }
  if (options.max_lat !== undefined) {
    where += ' AND latitude <= ?';
    params.push(options.max_lat);
  }
  if (options.min_lon !== undefined) {
    where += ' AND longitude >= ?';
    params.push(options.min_lon);
  }
  if (options.max_lon !== undefined) {
    where += ' AND longitude <= ?';
    params.push(options.max_lon);
  }
  return { where, params };
}

function observationWhere(options: ObservationFilterOptions): {
  where: string;
  params: (string | number)[];
} {
  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (options.entity_id) {
    where += ' AND entity_id = ?';
    params.push(options.entity_id);
  }
  if (options.source_id) {
    where += ' AND source_id = ?';
    params.push(options.source_id);
  }
  return { where, params };
}

/**
 * One page of rows plus the COUNT(*) over the same WHERE clause. Every filter is bound as a
 * prepared-statement parameter — never string-interpolated (`table` / `where` are internal).
 */
function paginate(
  table: 'entities' | 'observations',
  where: string,
  params: (string | number)[],
  limit: number,
  offset: number
): { rows: Row[]; total: number } {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT * FROM ${table} ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all([...params, limit, offset]) as Row[];
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${table} ${where}`).get(params) as {
    total: number;
  };
  return { rows, total };
}

/** Entity query with category / source / spatial bounding-box filters. */
export function getEntities(options: EntityFilterOptions = {}): Page {
  const { where, params } = entityWhere(options);
  const page = paginate(
    'entities',
    where,
    params,
    clampLimit(options.limit),
    clampOffset(options.offset)
  );
  return { rows: page.rows.map(serializeEntity), total: page.total };
}

export function getObservations(options: ObservationFilterOptions = {}): Page {
  const { where, params } = observationWhere(options);
  const page = paginate(
    'observations',
    where,
    params,
    clampLimit(options.limit),
    clampOffset(options.offset)
  );
  return { rows: page.rows.map(serializeObservation), total: page.total };
}

/**
 * Category-BALANCED snapshot for the WebSocket `initial_state` frame.
 *
 * A global `ORDER BY timestamp DESC LIMIT 500` lets one high-frequency category (aircraft,
 * which always carry the freshest timestamps) crowd out every other category, so the globe
 * paints nothing but planes on first load. Taking the newest `perCategory` rows *per
 * category* guarantees every category present in the DB appears in the snapshot.
 */
export function getInitialSnapshot(perCategory = 300): Row[] {
  const db = getDatabase();
  return (
    db
      .prepare(
        `SELECT id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata,
         (SELECT o.heading FROM observations o WHERE o.entity_id = ranked.id
            ORDER BY o.timestamp DESC LIMIT 1) AS heading,
         (SELECT o.speed FROM observations o WHERE o.entity_id = ranked.id
            ORDER BY o.timestamp DESC LIMIT 1) AS speed
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY timestamp DESC) AS rn
         FROM entities
       ) AS ranked
       WHERE rn <= ?`
      )
      .all(perCategory) as Row[]
  ).map(serializeEntity);
}
