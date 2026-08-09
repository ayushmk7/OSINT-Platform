import Database from 'better-sqlite3';
import { fetchUrl } from './http-fetcher';
import { EntityRecord, mapRecord } from './field-mapper';
import { parsePayload } from './parsers';
import { SourceConfig, loadSourcesFromDir, parseDurationSeconds } from './yaml-loader';

/** Retention cap for `append` sources: newest N observations kept per entity. */
export const MAX_OBS_PER_ENTITY = 200;

export class IngestionScheduler {
  private db: Database.Database;
  private sourcesDir: string;
  private timers: NodeJS.Timeout[] = [];
  private configs: SourceConfig[] = [];
  private lastPositions = new Map<string, string>();

  // Optional hook: called ONLY when an entity is new or its position changed.
  // Step 3 sets this to broadcaster.broadcastEntityUpdate so the WS stream is not a
  // per-record flood.
  public onEntityUpdate?: (entity: EntityRecord) => void;

  constructor(db: Database.Database, sourcesDir: string) {
    this.db = db;
    this.sourcesDir = sourcesDir;
  }

  public getConfigs(): SourceConfig[] {
    return this.configs;
  }

  /** Load every source definition and register/refresh its row in `sources`. */
  public initSources(): SourceConfig[] {
    this.configs = loadSourcesFromDir(this.sourcesDir);

    const stmt = this.db.prepare(`
      INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        transport = excluded.transport,
        url = excluded.url,
        update_interval_sec = excluded.update_interval_sec,
        enabled = excluded.enabled
    `);

    for (const config of this.configs) {
      stmt.run(
        config.name,
        config.display_name || config.name,
        config.source_type,
        config.transport.type,
        config.transport.url,
        parseDurationSeconds(config.transport.interval, 60),
        config.enabled !== false ? 1 : 0
      );
    }

    return this.configs;
  }

  /**
   * One fetch -> parse -> map -> persist cycle. Returns the number of records written.
   * A failure is logged with the source name and swallowed only at this boundary so the
   * scheduler keeps running; it is never silently dropped.
   */
  public async pollSource(config: SourceConfig): Promise<number> {
    try {
      const rawContent = await fetchUrl({
        url: config.transport.url,
        method: config.transport.method || 'GET',
        headers: config.transport.headers,
        timeoutMs: parseDurationSeconds(config.transport.timeout, 10) * 1000,
        maxAttempts: config.transport.retry?.max_attempts ?? 3,
        initialDelayMs: parseDurationSeconds(config.transport.retry?.initial_delay, 1) * 1000,
        maxDelayMs: parseDurationSeconds(config.transport.retry?.max_delay, 15) * 1000
      });

      const rawRecords = parsePayload(
        rawContent,
        config.parser.format,
        config.parser.records_path,
        config.parser.max_records
      );

      const upsertEntityStmt = this.db.prepare(`
        INSERT INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          name = excluded.name,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          altitude = excluded.altitude,
          timestamp = excluded.timestamp,
          metadata = excluded.metadata
      `);

      // recording.mode drives observation persistence. This is the dedup fix.
      const mode = config.recording?.mode ?? 'append';

      // append: distinct (entity, instant) rows; repeat polls are no-ops (INSERT OR IGNORE
      // against ux_observations_entity_timestamp + the deterministic obs id).
      const appendObsStmt = this.db.prepare(`
        INSERT OR IGNORE INTO observations
          (id, entity_id, source_id, latitude, longitude, altitude, speed, heading, timestamp, raw_payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // upsert: exactly one observation row per entity (id = obs_<entity_id>), updated in place.
      const upsertObsStmt = this.db.prepare(`
        INSERT INTO observations
          (id, entity_id, source_id, latitude, longitude, altitude, speed, heading, timestamp, raw_payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          latitude = excluded.latitude, longitude = excluded.longitude, altitude = excluded.altitude,
          speed = excluded.speed, heading = excluded.heading, timestamp = excluded.timestamp,
          raw_payload = excluded.raw_payload
      `);

      // Retention for append tracks: keep only the newest N observations per entity.
      const pruneStmt = this.db.prepare(`
        DELETE FROM observations
        WHERE entity_id = ?
          AND id NOT IN (
            SELECT id FROM observations WHERE entity_id = ? ORDER BY timestamp DESC LIMIT ?
          )
      `);

      let written = 0;
      let skipped = 0;
      const touchedEntities = new Set<string>();
      const changedEntities: EntityRecord[] = []; // new or moved -> broadcast after commit

      const transaction = this.db.transaction(() => {
        for (const raw of rawRecords) {
          const mapped = mapRecord(raw, config, config.name);
          if (!mapped) {
            skipped++; // no identity or no valid coordinates — never plotted at (0,0)
            continue;
          }
          const { entity, observation } = mapped;

          upsertEntityStmt.run(
            entity.id,
            entity.source_id,
            entity.category,
            entity.name,
            entity.latitude,
            entity.longitude,
            entity.altitude,
            entity.timestamp,
            JSON.stringify(entity.metadata)
          );

          const obsStmt = mode === 'upsert' ? upsertObsStmt : appendObsStmt;
          obsStmt.run(
            observation.id,
            observation.entity_id,
            observation.source_id,
            observation.latitude,
            observation.longitude,
            observation.altitude,
            observation.speed,
            observation.heading,
            observation.timestamp,
            JSON.stringify(observation.raw_payload)
          );

          // Broadcast only when new or the position actually changed (no per-record flood).
          const posKey = `${entity.latitude},${entity.longitude},${entity.altitude}`;
          if (this.lastPositions.get(entity.id) !== posKey) {
            this.lastPositions.set(entity.id, posKey);
            changedEntities.push(entity);
          }

          touchedEntities.add(entity.id);
          written++;
        }

        if (mode === 'append') {
          for (const entityId of touchedEntities) {
            pruneStmt.run(entityId, entityId, MAX_OBS_PER_ENTITY);
          }
        }
      });

      transaction();

      // Emit AFTER the DB commit, and only for changed entities.
      if (this.onEntityUpdate) {
        for (const entity of changedEntities) {
          this.onEntityUpdate(entity);
        }
      }

      if (skipped > 0) {
        console.warn(
          `Source ${config.name}: skipped ${skipped} record(s) with missing id/coordinates`
        );
      }
      return written;
    } catch (err) {
      console.error(`Error polling source ${config.name}:`, err);
      return 0;
    }
  }

  /** Register sources, poll each enabled one immediately, then on its own interval. */
  public start(): void {
    this.initSources();

    for (const config of this.configs) {
      if (config.enabled === false) continue;
      const intervalSec = parseDurationSeconds(config.transport.interval, 60);

      void this.pollSource(config);

      const timer = setInterval(() => {
        void this.pollSource(config);
      }, intervalSec * 1000);

      this.timers.push(timer);
    }
  }

  public stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }
}
