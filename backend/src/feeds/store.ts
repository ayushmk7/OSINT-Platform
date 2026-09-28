import type Database from 'better-sqlite3';
import { parseDurationSeconds } from '../engine/yaml-loader';
import type { IndicatorReading } from './mapper';
import { isSeverity, type FeedItem, type Indicator, type IndicatorPoint } from './types';

/** Newest feed items kept per source. */
export const MAX_FEED_ITEMS_PER_SOURCE = 500;
/** Default for MKOSINT_FEED_MAX_AGE: items published longer ago are dropped. */
export const DEFAULT_FEED_MAX_AGE = '14d';
/** History points kept per indicator. */
export const MAX_INDICATOR_HISTORY = 100;
export const DEFAULT_FEED_PAGE = 100;
export const MAX_FEED_PAGE = 500;

/** MKOSINT_FEED_MAX_AGE ('14d', '36h', seconds) in seconds. */
export function feedMaxAgeSeconds(value: string | undefined = process.env.MKOSINT_FEED_MAX_AGE) {
  const fallback = parseDurationSeconds(DEFAULT_FEED_MAX_AGE, 14 * 86400);
  return value && value.trim() !== '' ? parseDurationSeconds(value, fallback) : fallback;
}

const ready = new WeakSet<Database.Database>();

/** Create the feed_items / indicators tables (idempotent; cheap after the first call). */
export function ensureFeedTables(db: Database.Database): void {
  if (ready.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        summary TEXT,
        published TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        severity TEXT NOT NULL DEFAULT 'info',
        latitude REAL,
        longitude REAL,
        entity_id TEXT,
        first_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feed_items_source_published
        ON feed_items(source_id, published);
    CREATE INDEX IF NOT EXISTS idx_feed_items_published ON feed_items(published);

    CREATE TABLE IF NOT EXISTS indicators (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        indicator_id TEXT NOT NULL,
        label TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        change REAL,
        severity TEXT NOT NULL DEFAULT 'info',
        updated_at TEXT NOT NULL,
        history TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_indicators_source ON indicators(source_id);
  `);
  ready.add(db);
}

type Row = Record<string, unknown>;

function parseArray<T>(value: unknown): T[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function severity(value: unknown) {
  return isSeverity(value) ? value : 'info';
}

export function serializeFeedItem(row: Row): FeedItem {
  return {
    id: String(row.id),
    source_id: String(row.source_id),
    item_id: String(row.item_id),
    title: String(row.title),
    url: (row.url as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    published: String(row.published),
    tags: parseArray<string>(row.tags),
    severity: severity(row.severity),
    latitude: (row.latitude as number | null) ?? null,
    longitude: (row.longitude as number | null) ?? null,
    entity_id: (row.entity_id as string | null) ?? null,
    first_seen: String(row.first_seen)
  };
}

export function serializeIndicator(row: Row): Indicator {
  return {
    id: String(row.id),
    source_id: String(row.source_id),
    indicator_id: String(row.indicator_id),
    label: String(row.label),
    value: Number(row.value),
    unit: (row.unit as string | null) ?? null,
    change: row.change === null || row.change === undefined ? null : Number(row.change),
    severity: severity(row.severity),
    updated_at: String(row.updated_at),
    history: parseArray<IndicatorPoint>(row.history)
  };
}

/**
 * Store a batch of mapped feed items from one source. Items older than the max age are ignored,
 * and only the newest MAX_FEED_ITEMS_PER_SOURCE of the batch are considered, so an item that
 * retention would prune is never re-inserted (and re-announced) on the next poll. Existing items
 * are refreshed in place (title/summary edits) but keep their `first_seen`. Returns the items
 * that are NEW, newest first.
 */
export function upsertFeedItems(
  db: Database.Database,
  items: FeedItem[],
  now: number = Date.now()
): FeedItem[] {
  ensureFeedTables(db);
  const cutoff = new Date(now - feedMaxAgeSeconds() * 1000).toISOString();
  const byId = new Map<string, FeedItem>();
  for (const item of items) if (item.published >= cutoff) byId.set(item.id, item);
  const batch = [...byId.values()]
    .sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0))
    .slice(0, MAX_FEED_ITEMS_PER_SOURCE);

  const exists = db.prepare('SELECT 1 FROM feed_items WHERE id = ?');
  const upsert = db.prepare(`
    INSERT INTO feed_items
      (id, source_id, item_id, title, url, summary, published, tags, severity,
       latitude, longitude, entity_id, first_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, url = excluded.url, summary = excluded.summary,
      published = excluded.published, tags = excluded.tags, severity = excluded.severity,
      latitude = excluded.latitude, longitude = excluded.longitude, entity_id = excluded.entity_id
  `);
  const fresh: FeedItem[] = [];
  const sources = new Set<string>();
  db.transaction(() => {
    for (const item of batch) {
      if (!exists.get(item.id)) fresh.push(item);
      sources.add(item.source_id);
      upsert.run(
        item.id,
        item.source_id,
        item.item_id,
        item.title,
        item.url,
        item.summary,
        item.published,
        JSON.stringify(item.tags),
        item.severity,
        item.latitude,
        item.longitude,
        item.entity_id,
        item.first_seen
      );
    }
    for (const source of sources) pruneSourceFeed(db, source);
  })();
  return fresh;
}

function pruneSourceFeed(db: Database.Database, sourceId: string): number {
  return db
    .prepare(
      `DELETE FROM feed_items WHERE source_id = ? AND id NOT IN (
         SELECT id FROM feed_items WHERE source_id = ? ORDER BY published DESC LIMIT ?
       )`
    )
    .run(sourceId, sourceId, MAX_FEED_ITEMS_PER_SOURCE).changes;
}

/** Retention sweep: drop items past MKOSINT_FEED_MAX_AGE and cap every source. */
export function pruneFeedItems(db: Database.Database, now: number = Date.now()): number {
  ensureFeedTables(db);
  const cutoff = new Date(now - feedMaxAgeSeconds() * 1000).toISOString();
  let removed = db.prepare('DELETE FROM feed_items WHERE published < ?').run(cutoff).changes;
  const sources = db.prepare('SELECT DISTINCT source_id FROM feed_items').all() as Array<{
    source_id: string;
  }>;
  for (const { source_id } of sources) removed += pruneSourceFeed(db, source_id);
  return removed;
}

export interface FeedQuery {
  source?: string;
  limit?: number;
  since?: string;
}

/** Newest first. `since` is exclusive on `published`. */
export function listFeedItems(db: Database.Database, q: FeedQuery = {}): FeedItem[] {
  ensureFeedTables(db);
  let sql = 'SELECT * FROM feed_items WHERE 1=1';
  const params: (string | number)[] = [];
  if (q.source) {
    sql += ' AND source_id = ?';
    params.push(q.source);
  }
  if (q.since) {
    sql += ' AND published > ?';
    params.push(q.since);
  }
  sql += ' ORDER BY published DESC, id ASC LIMIT ?';
  params.push(Math.min(Math.max(q.limit ?? DEFAULT_FEED_PAGE, 1), MAX_FEED_PAGE));
  return (db.prepare(sql).all(params) as Row[]).map(serializeFeedItem);
}

/**
 * Merge readings into the indicators table. Several readings for one indicator (a time series
 * in one response) become history points in time order; the newest one is the current value.
 * A timed reading whose timestamp is already in the history is ignored; an untimed one adds a
 * point per poll. Returns the indicators whose value or timestamp changed.
 */
export function upsertIndicators(db: Database.Database, readings: IndicatorReading[]): Indicator[] {
  ensureFeedTables(db);
  const groups = new Map<string, IndicatorReading[]>();
  for (const r of readings) {
    const list = groups.get(r.id) ?? [];
    list.push(r);
    groups.set(r.id, list);
  }
  const select = db.prepare('SELECT * FROM indicators WHERE id = ?');
  const write = db.prepare(`
    INSERT INTO indicators
      (id, source_id, indicator_id, label, value, unit, change, severity, updated_at, history)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label, value = excluded.value, unit = excluded.unit,
      change = excluded.change, severity = excluded.severity,
      updated_at = excluded.updated_at, history = excluded.history
  `);
  const changed: Indicator[] = [];
  db.transaction(() => {
    for (const list of groups.values()) {
      list.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
      const row = select.get(list[0].id) as Row | undefined;
      const prev = row ? serializeIndicator(row) : null;
      const history = prev ? [...prev.history] : [];
      const seen = new Set(history.map((p) => p.t));
      const floor = history.length >= MAX_INDICATOR_HISTORY ? history[0].t : null;
      let added = false;
      for (const r of list) {
        if (r.timed && seen.has(r.timestamp)) continue;
        // A full history already dropped older points: re-polling a long series must not
        // re-add (and re-announce) them.
        if (r.timed && floor !== null && r.timestamp < floor) continue;
        history.push({ t: r.timestamp, v: r.value });
        seen.add(r.timestamp);
        added = true;
      }
      history.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
      const trimmed = history.slice(-MAX_INDICATOR_HISTORY);
      const latest = list[list.length - 1];
      // The newest point is the current value (a late, older reading never overrides it).
      const current = trimmed[trimmed.length - 1] ?? { t: latest.timestamp, v: latest.value };
      const value = current.v;
      const updatedAt = current.t;
      const next: Indicator = {
        id: latest.id,
        source_id: latest.source_id,
        indicator_id: latest.indicator_id,
        label: latest.label,
        value,
        unit: latest.unit,
        change: latest.change,
        severity: latest.severity,
        updated_at: updatedAt,
        history: trimmed
      };
      write.run(
        next.id,
        next.source_id,
        next.indicator_id,
        next.label,
        next.value,
        next.unit,
        next.change,
        next.severity,
        next.updated_at,
        JSON.stringify(next.history)
      );
      if (
        !prev ||
        added ||
        prev.value !== next.value ||
        prev.label !== next.label ||
        prev.severity !== next.severity
      ) {
        changed.push(next);
      }
    }
  })();
  return changed;
}

export function listIndicators(db: Database.Database, source?: string): Indicator[] {
  ensureFeedTables(db);
  const rows = source
    ? db.prepare('SELECT * FROM indicators WHERE source_id = ? ORDER BY id').all(source)
    : db.prepare('SELECT * FROM indicators ORDER BY source_id, id').all();
  return (rows as Row[]).map(serializeIndicator);
}

/** Start the periodic feed retention sweep (runs once now, then every `intervalMs`). */
export function startFeedRetention(
  db: Database.Database,
  intervalMs = 10 * 60_000
): { stop: () => void } {
  const run = () => {
    try {
      pruneFeedItems(db);
    } catch (err) {
      console.error('[feeds] retention sweep failed:', err);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
