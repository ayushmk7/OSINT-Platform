import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../db/database';
import {
  dbMaxBytesFromEnv,
  dbUsedBytes,
  enforceDbSizeLimit,
  expireEntities,
  runRetention
} from '../engine/retention';
import { SourceConfig } from '../engine/yaml-loader';

function cfg(name: string, ttlSeconds: number | null): SourceConfig {
  return { name, display: { ttl_seconds: ttlSeconds } } as unknown as SourceConfig;
}

function seed(db: Database.Database, source: string, id: string, iso: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO sources (id, name, type, transport, url) VALUES (?, ?, 't', 'http', 'u')`
  ).run(source, source);
  db.prepare(
    `INSERT INTO entities (id, source_id, category, name, latitude, longitude, timestamp)
     VALUES (?, ?, 'c', ?, 0, 0, ?)`
  ).run(id, source, id, iso);
  db.prepare(
    `INSERT INTO observations (id, entity_id, source_id, latitude, longitude, timestamp)
     VALUES (?, ?, ?, 0, 0, ?)`
  ).run(`obs_${id}`, id, source, iso);
}

describe('retention', () => {
  let db: Database.Database;
  const now = Date.parse('2026-09-28T12:00:00Z');
  const ago = (sec: number) => new Date(now - sec * 1000).toISOString();

  beforeEach(() => {
    db = initDatabase(':memory:');
  });
  afterEach(() => closeDatabase(db));

  it('deletes entities (and their observations) older than their source ttl', () => {
    seed(db, 'planes', 'planes:old', ago(600));
    seed(db, 'planes', 'planes:fresh', ago(60));
    seed(db, 'iss', 'iss:old', ago(99999));

    const removed = expireEntities(db, [cfg('planes', 300), cfg('iss', null)], now);

    expect(removed).toEqual(['planes:old']);
    const ids = (db.prepare('SELECT id FROM entities ORDER BY id').all() as { id: string }[]).map(
      (r) => r.id
    );
    expect(ids).toEqual(['iss:old', 'planes:fresh']);
    const orphans = db
      .prepare("SELECT COUNT(*) AS n FROM observations WHERE entity_id = 'planes:old'")
      .get() as { n: number };
    expect(orphans.n).toBe(0);
  });

  it('reports removed ids to onRemove (the entity_remove broadcast)', () => {
    seed(db, 'planes', 'planes:old', new Date(Date.now() - 3600_000).toISOString());
    const onRemove = jest.fn();
    runRetention(db, { getConfigs: () => [cfg('planes', 60)], onRemove, maxBytes: 0 });
    expect(onRemove).toHaveBeenCalledWith(['planes:old']);
  });

  it('does not call onRemove when nothing expired', () => {
    const onRemove = jest.fn();
    runRetention(db, { getConfigs: () => [cfg('planes', 60)], onRemove, maxBytes: 0 });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('prunes the oldest observations when the database is over its size limit', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = 'x'.repeat(2000);
    db.prepare(
      `INSERT INTO sources (id, name, type, transport, url) VALUES ('s', 's', 't', 'http', 'u')`
    ).run();
    db.prepare(
      `INSERT INTO entities (id, source_id, category, name, latitude, longitude, timestamp)
       VALUES ('e', 's', 'c', 'e', 0, 0, ?)`
    ).run(ago(0));
    const insert = db.prepare(
      `INSERT INTO observations (id, entity_id, source_id, latitude, longitude, timestamp, raw_payload)
       VALUES (?, 'e', 's', 0, 0, ?, ?)`
    );
    db.transaction(() => {
      for (let i = 0; i < 2000; i++) insert.run(`o${i}`, ago(2000 - i), payload);
    })();
    const limit = Math.floor(dbUsedBytes(db) / 2);

    const deleted = enforceDbSizeLimit(db, limit);

    expect(deleted).toBeGreaterThan(0);
    expect(dbUsedBytes(db)).toBeLessThanOrEqual(limit * 0.9);
    // Oldest first: the newest row survives, the oldest is gone.
    expect(db.prepare("SELECT id FROM observations WHERE id = 'o1999'").get()).toBeDefined();
    expect(db.prepare("SELECT id FROM observations WHERE id = 'o0'").get()).toBeUndefined();
    warn.mockRestore();
  });

  it('leaves a database under its limit alone', () => {
    seed(db, 'planes', 'p', ago(1));
    expect(enforceDbSizeLimit(db, 1024 * 1024 * 1024)).toBe(0);
  });

  it('reads MKOSINT_DB_MAX_MB with a 500 MB default (0 disables the guard)', () => {
    expect(dbMaxBytesFromEnv(undefined)).toBe(500 * 1024 * 1024);
    expect(dbMaxBytesFromEnv('10')).toBe(10 * 1024 * 1024);
    expect(dbMaxBytesFromEnv('nope')).toBe(500 * 1024 * 1024);
    expect(dbMaxBytesFromEnv('0')).toBe(0);
  });
});
