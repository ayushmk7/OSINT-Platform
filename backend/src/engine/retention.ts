import Database from 'better-sqlite3';
import { SourceConfig } from './yaml-loader';

/** How often the retention sweep runs. */
export const RETENTION_INTERVAL_MS = 60_000;
/** Default database size ceiling (MB), overridable with MKOSINT_DB_MAX_MB. */
export const DEFAULT_DB_MAX_MB = 500;
/** When over the ceiling, prune down to this fraction of it. */
export const DB_PRUNE_TARGET = 0.9;
/** Bounds on the observations deleted per pruning step while shrinking the database. */
const PRUNE_BATCH_MIN = 100;
const PRUNE_BATCH_MAX = 50_000;
/** Keep bound-parameter lists well under SQLite's variable limit. */
const ID_CHUNK = 500;

/** Parse MKOSINT_DB_MAX_MB; unset/garbage falls back to the default, `0` disables the guard. */
export function dbMaxBytesFromEnv(
  value: string | undefined = process.env.MKOSINT_DB_MAX_MB
): number {
  if (value === undefined || value.trim() === '') return DEFAULT_DB_MAX_MB * 1024 * 1024;
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb < 0) return DEFAULT_DB_MAX_MB * 1024 * 1024;
  return mb * 1024 * 1024;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Delete every entity (and its observations) whose timestamp is older than its source's
 * `display.ttl`. Sources without a ttl are untouched. Returns the removed entity ids.
 */
export function expireEntities(
  db: Database.Database,
  configs: SourceConfig[],
  now: number = Date.now()
): string[] {
  const selectStmt = db.prepare('SELECT id FROM entities WHERE source_id = ? AND timestamp < ?');
  const removed: string[] = [];

  const tx = db.transaction(() => {
    for (const config of configs) {
      const ttl = config.display?.ttl_seconds;
      if (!ttl) continue;
      const cutoff = new Date(now - ttl * 1000).toISOString();
      const ids = (selectStmt.all(config.name, cutoff) as Array<{ id: string }>).map((r) => r.id);
      for (const batch of chunks(ids, ID_CHUNK)) {
        const marks = batch.map(() => '?').join(',');
        // Children first, explicitly: correct whether or not foreign_keys (CASCADE) is on.
        db.prepare(`DELETE FROM observations WHERE entity_id IN (${marks})`).run(batch);
        db.prepare(`DELETE FROM entities WHERE id IN (${marks})`).run(batch);
      }
      removed.push(...ids);
    }
  });
  tx();
  return removed;
}

/** Bytes actually in use (page_count minus free pages, times page size). */
export function dbUsedBytes(db: Database.Database): number {
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  const pageCount = db.pragma('page_count', { simple: true }) as number;
  const freePages = db.pragma('freelist_count', { simple: true }) as number;
  return (pageCount - freePages) * pageSize;
}

/**
 * Size guard: while the database is over `maxBytes`, delete the oldest observations until it is
 * under DB_PRUNE_TARGET of the ceiling, then return the freed pages with `incremental_vacuum`
 * (effective on databases created with auto_vacuum=INCREMENTAL). Returns rows deleted.
 */
export function enforceDbSizeLimit(db: Database.Database, maxBytes: number): number {
  if (!(maxBytes > 0) || dbUsedBytes(db) <= maxBytes) return 0;
  const target = maxBytes * DB_PRUNE_TARGET;
  const pruneStmt = db.prepare(
    `DELETE FROM observations WHERE id IN (
       SELECT id FROM observations ORDER BY timestamp ASC LIMIT ?
     )`
  );
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM observations');
  let deleted = 0;
  for (let used = dbUsedBytes(db); used > target; used = dbUsedBytes(db)) {
    // Size each step by the fraction of the file that has to go, so a small database is not
    // wiped in one oversized batch and a huge one does not take thousands of steps.
    const { n } = countStmt.get() as { n: number };
    const share = Math.ceil(n * ((used - target) / used) * 1.05);
    const batch = Math.min(PRUNE_BATCH_MAX, Math.max(PRUNE_BATCH_MIN, share));
    const { changes } = pruneStmt.run(batch);
    if (changes === 0) break; // nothing left to prune; the rest is entities/sources
    deleted += changes;
  }
  db.pragma('incremental_vacuum');
  console.warn(
    `[retention] database over ${Math.round(maxBytes / 1048576)} MB: pruned ${deleted} oldest observation(s)`
  );
  return deleted;
}

export interface RetentionOptions {
  /** Current source configs (read on every sweep, so reloads are picked up). */
  getConfigs: () => SourceConfig[];
  /** Called with the ids removed by ttl expiry (e.g. to broadcast `entity_remove`). */
  onRemove?: (ids: string[]) => void;
  intervalMs?: number;
  maxBytes?: number;
}

/** One ttl + size sweep. Errors are logged, never thrown, so the timer keeps running. */
export function runRetention(db: Database.Database, options: RetentionOptions): string[] {
  try {
    const removed = expireEntities(db, options.getConfigs());
    if (removed.length > 0) options.onRemove?.(removed);
    enforceDbSizeLimit(db, options.maxBytes ?? dbMaxBytesFromEnv());
    return removed;
  } catch (err) {
    console.error('[retention] sweep failed:', err);
    return [];
  }
}

/** Start the periodic retention job. Runs once immediately, then every `intervalMs`. */
export function startRetention(
  db: Database.Database,
  options: RetentionOptions
): { stop: () => void } {
  runRetention(db, options);
  const timer = setInterval(
    () => runRetention(db, options),
    options.intervalMs ?? RETENTION_INTERVAL_MS
  );
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
