import Database from 'better-sqlite3';
import { EntityRecord, mapRecord, passesFilter } from './field-mapper';
import { parsePayload } from './parsers';
import { SourceConfig, loadSourcesFromDir, parseDurationSeconds } from './yaml-loader';
import { isStreamTransport } from './transport-config';
import { StreamHandle, fetchHttpRecords, startStream } from './transports';

/** Retention cap for `append` sources: newest N observations kept per entity. */
export const MAX_OBS_PER_ENTITY = 200;

export class IngestionScheduler {
  private db: Database.Database;
  private sourcesDir: string;
  private timers: NodeJS.Timeout[] = [];
  private streams: StreamHandle[] = [];
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

  /**
   * Load every source definition and register/refresh its row in `sources`. A source whose
   * row cannot be written is logged and dropped (never polled) instead of aborting startup.
   */
  public initSources(): SourceConfig[] {
    const loaded = loadSourcesFromDir(this.sourcesDir);
    const registered: SourceConfig[] = [];

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

    for (const config of loaded) {
      try {
        stmt.run(
          config.name,
          config.display_name || config.name,
          config.source_type,
          config.transport.type,
          config.transport.url,
          parseDurationSeconds(config.transport.interval, 60),
          config.enabled !== false ? 1 : 0
        );
        registered.push(config);
      } catch (err) {
        console.error(`Failed to register source ${config.name}; it will not be polled:`, err);
      }
    }

    this.configs = registered;
    return this.configs;
  }

  /**
   * Turn one response body (or one stream message) into raw records using the source's
   * parser settings. Shared by polls (called once per page) and streams (once per message).
   */
  public parseContent(config: SourceConfig, content: string): unknown[] {
    return parsePayload(
      content,
      config.parser.format,
      config.parser.records_path,
      config.parser.max_records
    );
  }

  /**
   * One fetch -> parse -> map -> persist cycle. Returns the number of records written.
   * A failure is logged with the source name and swallowed only at this boundary so the
   * scheduler keeps running; it is never silently dropped.
   */
  public async pollSource(config: SourceConfig): Promise<number> {
    try {
      let rawRecords = await fetchHttpRecords(config.transport, (content) =>
        this.parseContent(config, content)
      );
      // With pagination each page is capped by max_records; cap the concatenation too.
      const max = config.parser.max_records;
      if (max && max > 0 && rawRecords.length > max) rawRecords = rawRecords.slice(0, max);
      return this.ingestRecords(config, rawRecords);
    } catch (err) {
      console.error(`Error polling source ${config.name}:`, err);
      return 0;
    }
  }

  /**
   * Filter -> map -> persist a batch of raw records in one transaction and broadcast the
   * entities that are new or moved. Used by both HTTP polls and websocket/sse stream batches.
   * Returns the number of records written; throws on a database error.
   */
  public ingestRecords(config: SourceConfig, rawRecords: unknown[]): number {
    // Inner block keeps the original poll body at its old indentation (smaller diffs).
    {
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
      let filtered = 0;
      const touchedEntities = new Set<string>();
      const changedEntities: EntityRecord[] = []; // new or moved -> broadcast after commit

      const transaction = this.db.transaction(() => {
        for (const raw of rawRecords) {
          // Source-declared predicates run BEFORE mapping: a deliberately excluded record
          // (e.g. a heliport in an airports feed) is not a malformed one, so it is counted
          // separately and never inflates the "missing id/coordinates" warning.
          if (!passesFilter(raw, config.filter)) {
            filtered++;
            continue;
          }

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
      if (filtered > 0) {
        console.log(`Source ${config.name}: ${filtered} record(s) excluded by filter rules`);
      }
      return written;
    }
  }

  /** Register sources, poll each enabled one immediately, then on its own interval. */
  public start(): void {
    this.initSources();

    for (const config of this.configs) {
      if (config.enabled === false) continue;
      if (isStreamTransport(config.transport.type)) {
        this.streams.push(
          startStream(config.transport, {
            name: config.name,
            parse: (message) => this.parseContent(config, message),
            onBatch: (records) => {
              this.ingestRecords(config, records);
            }
          })
        );
        continue;
      }
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
    for (const stream of this.streams) {
      stream.stop();
    }
    this.streams = [];
  }
}
