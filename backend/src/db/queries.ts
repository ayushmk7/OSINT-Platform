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

export function getAllSources(): unknown[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sources ORDER BY id ASC').all();
}

/**
 * Entity query with category / source / spatial bounding-box filters.
 * Every filter is bound as a prepared-statement parameter — never string-interpolated.
 */
export function getEntities(options: EntityFilterOptions = {}): unknown[] {
  const db = getDatabase();
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);

  let query = 'SELECT * FROM entities WHERE 1=1';
  const params: (string | number)[] = [];

  if (options.category) {
    query += ' AND category = ?';
    params.push(options.category);
  }
  if (options.source_id) {
    query += ' AND source_id = ?';
    params.push(options.source_id);
  }
  if (options.min_lat !== undefined) {
    query += ' AND latitude >= ?';
    params.push(options.min_lat);
  }
  if (options.max_lat !== undefined) {
    query += ' AND latitude <= ?';
    params.push(options.max_lat);
  }
  if (options.min_lon !== undefined) {
    query += ' AND longitude >= ?';
    params.push(options.min_lon);
  }
  if (options.max_lon !== undefined) {
    query += ' AND longitude <= ?';
    params.push(options.max_lon);
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(params);
}

export function getObservations(options: ObservationFilterOptions = {}): unknown[] {
  const db = getDatabase();
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);

  let query = 'SELECT * FROM observations WHERE 1=1';
  const params: (string | number)[] = [];

  if (options.entity_id) {
    query += ' AND entity_id = ?';
    params.push(options.entity_id);
  }
  if (options.source_id) {
    query += ' AND source_id = ?';
    params.push(options.source_id);
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(params);
}

/**
 * Category-BALANCED snapshot for the WebSocket `initial_state` frame.
 *
 * A global `ORDER BY timestamp DESC LIMIT 500` lets one high-frequency category (aircraft,
 * which always carry the freshest timestamps) crowd out every other category, so the globe
 * paints nothing but planes on first load. Taking the newest `perCategory` rows *per
 * category* guarantees every category present in the DB appears in the snapshot.
 */
export function getInitialSnapshot(perCategory = 300): unknown[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY timestamp DESC) AS rn
         FROM entities
       )
       WHERE rn <= ?`
    )
    .all(perCategory);
}
