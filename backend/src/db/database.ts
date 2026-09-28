import Database from 'better-sqlite3';

let dbSingleton: Database.Database | null = null;

export function initDatabase(dbPath: string = 'mk-osint.db'): Database.Database {
  const db = new Database(dbPath);
  // Must precede the first CREATE TABLE: on a brand-new file this lets the retention job hand
  // pruned pages back to the OS with `PRAGMA incremental_vacuum`. A no-op on existing files.
  db.pragma('auto_vacuum = INCREMENTAL');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        transport TEXT NOT NULL,
        url TEXT NOT NULL,
        update_interval_sec INTEGER NOT NULL DEFAULT 60,
        enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude REAL NOT NULL DEFAULT 0.0,
        timestamp TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);
    CREATE INDEX IF NOT EXISTS idx_entities_source_id ON entities(source_id);

    CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude REAL NOT NULL DEFAULT 0.0,
        speed REAL NOT NULL DEFAULT 0.0,
        heading REAL NOT NULL DEFAULT 0.0,
        timestamp TEXT NOT NULL,
        raw_payload TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_observations_entity_id ON observations(entity_id);
    CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp);

    -- Natural key: one observation per (entity, instant). With a deterministic
    -- observation id + INSERT OR IGNORE (step 2) this is what prevents the
    -- 372k-row duplication. REQUIRED.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_observations_entity_timestamp
        ON observations(entity_id, timestamp);
  `);

  // Additive migration: per-source legend layer + display config (JSON), written by the
  // scheduler from the YAML `layer:` / `display:` blocks.
  const sourceColumns = new Set(
    (db.prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>).map((c) => c.name)
  );
  // `kind`: geo | feed | indicator (src/feeds), so clients can tell non-geo sources apart.
  for (const column of ['layer', 'display', 'kind']) {
    if (!sourceColumns.has(column)) db.exec(`ALTER TABLE sources ADD COLUMN ${column} TEXT`);
  }

  dbSingleton = db;
  return db;
}

export function getDatabase(): Database.Database {
  if (!dbSingleton) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbSingleton;
}

export function closeDatabase(db: Database.Database = dbSingleton as Database.Database): void {
  if (db && db.open) {
    db.close();
  }
  if (db === dbSingleton) {
    dbSingleton = null;
  }
}
