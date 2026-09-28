# Implementation Plan: 02 - Backend Declarative Ingestion Engine

This step-by-step TDD implementation plan details the creation of the backend YAML Declarative Ingestion Engine for MK-OSINT, including source definitions (`sources.d/`), multi-format parsers (JSON, GeoJSON, XML, CSV), field mapping engine, HTTP fetcher with retry logic, and SQLite persistence scheduler.

---

## Task 1: Declarative Source YAML Files Initialization

- [ ] **Step 1.1: Create `sources.d/usgs_earthquakes.yaml`**

  File: `sources.d/usgs_earthquakes.yaml`
  ```yaml
  schema_version: 1
  name: usgs_earthquakes
  source_type: usgs_earthquakes
  layer_type: earthquakes
  display_name: "USGS Earthquakes"
  enabled: true

  transport:
    type: http_poll
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
    method: GET
    headers:
      Accept: "application/json"
    timeout: "10s"
    interval: "60s"
    retry:
      max_attempts: 3
      initial_delay: "1s"
      max_delay: "15s"

  parser:
    format: geojson
    records_path: "features"
    max_records: 1000

  entity:
    external_id: "id"
    name: "properties.place"
    category: "geological"
    metadata:
      magnitude: "properties.mag"
      depth: "geometry.coordinates[2]"

  observation:
    latitude: "geometry.coordinates[1]"
    longitude: "geometry.coordinates[0]"
    altitude: "geometry.coordinates[2]"
    timestamp: "properties.time"

  recording:
    mode: upsert
  ```

- [ ] **Step 1.2: Create `sources.d/iss_position.yaml`**

  File: `sources.d/iss_position.yaml`
  ```yaml
  schema_version: 1
  name: iss_position
  source_type: iss_position
  layer_type: space
  display_name: "ISS Position Tracker"
  enabled: true

  transport:
    type: http_poll
    url: "https://api.wheretheiss.at/v1/satellites/25544"
    method: GET
    headers:
      Accept: "application/json"
    timeout: "10s"
    interval: "30s"

  parser:
    format: json
    max_records: 1

  entity:
    external_id: "id"
    name: "name"
    category: "satellite"
    metadata:
      visibility: "visibility"
      velocity: "velocity"

  observation:
    latitude: "latitude"
    longitude: "longitude"
    altitude: "altitude"
    speed: "velocity"
    timestamp: "timestamp"

  recording:
    mode: append
  ```

- [ ] **Step 1.3: Create `sources.d/adsb_military.yaml`**

  File: `sources.d/adsb_military.yaml`
  ```yaml
  schema_version: 1
  name: adsb_military
  source_type: adsb_military
  layer_type: aviation
  display_name: "Military Flights ADSB"
  enabled: true

  transport:
    type: http_poll
    url: "https://api.adsb.lol/v2/mil"
    method: GET
    headers:
      Accept: "application/json"
    timeout: "15s"
    interval: "30s"

  parser:
    format: json
    records_path: "ac"
    max_records: 5000

  entity:
    external_id: "hex"
    name: "flight"
    category: "aircraft"        # canonical enum value (NOT "military_aircraft")
    metadata:
      callsign: "flight"
      registration: "r"
      type: "t"

  observation:
    latitude: "lat"
    longitude: "lon"
    altitude: "alt_baro"
    speed: "gs"
    heading: "track"
    # No source timestamp field is mapped: the mapper stamps ingest time and the append
    # dedup/retention keep the track bounded. NEVER map a field to the literal "now".

  recording:
    mode: append
  ```

- [ ] **Step 1.4: Create `sources.d/safecast_radiation.yaml`**

  File: `sources.d/safecast_radiation.yaml`
  ```yaml
  schema_version: 1
  name: safecast_radiation
  source_type: safecast_radiation
  layer_type: radiation
  display_name: "Safecast Radiation Monitoring"
  enabled: true

  transport:
    type: http_poll
    url: "https://api.safecast.org/measurements.json?limit=100"
    method: GET
    headers:
      Accept: "application/json"
    timeout: "15s"
    interval: "300s"

  parser:
    format: json
    max_records: 100

  entity:
    external_id: "id"
    name: "device_id"
    category: "radiation"        # canonical enum value (NOT "radiation_sensor")
    metadata:
      cpm: "value"
      unit: "unit"

  observation:
    latitude: "latitude"
    longitude: "longitude"
    altitude: "0"                # literal constant 0 (not a field named "0")
    timestamp: "captured_at"

  recording:
    mode: upsert                 # current-state sensors: one observation row per device
  ```

---

## Task 2: YAML Source Loader Component (`yaml-loader.ts`)

- [ ] **Step 2.1: Write YAML Loader Test (TDD)**

  File: `backend/src/__tests__/yaml-loader.test.ts`
  ```typescript
  import { loadSourcesFromDir, SourceConfig } from '../engine/yaml-loader';
  import path from 'path';

  describe('YAML Source Loader', () => {
    const sourcesDir = path.resolve(__dirname, '../../../sources.d');

    it('should discover and parse YAML source files from sources.d/', () => {
      const sources: SourceConfig[] = loadSourcesFromDir(sourcesDir);
      expect(sources.length).toBeGreaterThanOrEqual(4);

      const usgs = sources.find((s) => s.name === 'usgs_earthquakes');
      expect(usgs).toBeDefined();
      expect(usgs?.transport.url).toContain('earthquake.usgs.gov');
      expect(usgs?.parser.format).toBe('geojson');

      const iss = sources.find((s) => s.name === 'iss_position');
      expect(iss).toBeDefined();
      expect(iss?.parser.format).toBe('json');
    });
  });
  ```

  Run test to verify failure:
  Command: `rtk npm test --prefix backend`
  Expected Output: FAIL due to missing `yaml-loader.ts`.

- [ ] **Step 2.2: Implement `backend/src/engine/yaml-loader.ts`**

  File: `backend/src/engine/yaml-loader.ts`
  ```typescript
  import fs from 'fs';
  import path from 'path';
  import YAML from 'yaml';

  export interface SourceConfig {
    schema_version?: number;
    name: string;
    source_type: string;
    layer_type: string;
    display_name: string;
    enabled?: boolean;
    transport: {
      type: string;
      url: string;
      method?: string;
      headers?: Record<string, string>;
      timeout?: string | number;
      interval: string | number;
      retry?: {
        max_attempts?: number;
        initial_delay?: string;
        max_delay?: string;
      };
    };
    parser: {
      format: 'json' | 'geojson' | 'xml' | 'csv';
      records_path?: string;
      max_records?: number;
    };
    entity: {
      external_id: string;
      name: string;
      category?: string;
      metadata?: Record<string, string>;
    };
    observation: {
      latitude: string;
      longitude: string;
      altitude?: string;
      speed?: string;
      heading?: string;
      timestamp?: string;
    };
    recording?: {
      mode?: 'upsert' | 'append';
    };
  }

  export function loadSourcesFromDir(dirPath: string): SourceConfig[] {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const files = fs.readdirSync(dirPath);
    const configs: SourceConfig[] = [];

    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = path.join(dirPath, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const parsed = YAML.parse(fileContent) as SourceConfig;
        if (parsed && parsed.name && parsed.transport && parsed.parser) {
          configs.push(parsed);
        }
      }
    }

    return configs;
  }
  ```

  Run test to verify pass:
  Command: `rtk npm test --prefix backend`
  Expected Output: PASS `yaml-loader.test.ts`.

---

## Task 3: HTTP Fetcher Component (`http-fetcher.ts`)

- [ ] **Step 3.1: Write HTTP Fetcher Test (TDD)**

  File: `backend/src/__tests__/http-fetcher.test.ts`
  ```typescript
  import { fetchUrl } from '../engine/http-fetcher';

  describe('HTTP Fetcher', () => {
    it('should successfully fetch text data from URL', async () => {
      const result = await fetchUrl({
        url: 'https://httpbin.org/get',
        timeoutMs: 5000
      });
      expect(result).toBeDefined();
      expect(result).toContain('"url"');
    });
  });
  ```

- [ ] **Step 3.2: Implement `backend/src/engine/http-fetcher.ts`**

  File: `backend/src/engine/http-fetcher.ts`
  ```typescript
  export interface FetchOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxAttempts?: number;
  }

  export async function fetchUrl(options: FetchOptions): Promise<string> {
    const { url, method = 'GET', headers = {}, timeoutMs = 10000, maxAttempts = 3 } = options;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          method,
          headers: {
            'User-Agent': 'MK-OSINT/1.0',
            ...headers
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.text();
      } catch (err: any) {
        lastError = err;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 200));
        }
      }
    }

    throw lastError || new Error(`Failed to fetch URL ${url}`);
  }
  ```

  Run test to verify pass:
  Command: `rtk npm test --prefix backend`
  Expected Output: PASS `http-fetcher.test.ts`.

---

## Task 4: Multi-Format Response Parsers Component (`parsers/`)

- [ ] **Step 4.1: Write Parsers Unit Test (TDD)**

  File: `backend/src/__tests__/parsers.test.ts`
  ```typescript
  import { parsePayload } from '../engine/parsers';

  describe('Multi-Format Parsers', () => {
    it('should parse JSON arrays and nested records_path', () => {
      const jsonRaw = JSON.stringify({ items: [{ id: 1 }, { id: 2 }] });
      const records = parsePayload(jsonRaw, 'json', 'items');
      expect(records).toHaveLength(2);
      expect(records[0].id).toBe(1);
    });

    it('should parse GeoJSON FeatureCollections', () => {
      const geojsonRaw = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [-122, 37] }, properties: { mag: 4.5 } }
        ]
      });
      const records = parsePayload(geojsonRaw, 'geojson');
      expect(records).toHaveLength(1);
      expect(records[0].properties.mag).toBe(4.5);
    });

    it('should parse XML data using fast-xml-parser', () => {
      const xmlRaw = `<rss><channel><item><title>Report 1</title></item></channel></rss>`;
      const records = parsePayload(xmlRaw, 'xml', 'rss.channel.item');
      expect(records).toHaveLength(1);
      expect(records[0].title).toBe('Report 1');
    });

    it('should parse CSV data using papaparse', () => {
      const csvRaw = `id,name,lat,lon\n101,Station Alpha,19.4, -99.1`;
      const records = parsePayload(csvRaw, 'csv');
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('101');
      expect(records[0].name).toBe('Station Alpha');
    });
  });
  ```

- [ ] **Step 4.2: Implement `backend/src/engine/parsers/index.ts`**

  File: `backend/src/engine/parsers/index.ts`
  ```typescript
  import { XMLParser } from 'fast-xml-parser';
  import Papa from 'papaparse';

  export function getNestedProperty(obj: any, pathStr?: string): any {
    if (!pathStr || !obj) return obj;
    const parts = pathStr.split('.');
    let curr = obj;
    for (const part of parts) {
      if (curr == null) return undefined;
      curr = curr[part];
    }
    return curr;
  }

  export function parsePayload(
    content: string,
    format: 'json' | 'geojson' | 'xml' | 'csv',
    recordsPath?: string,
    maxRecords?: number
  ): any[] {
    let records: any[] = [];

    if (format === 'json' || format === 'geojson') {
      const parsed = JSON.parse(content);
      if (format === 'geojson') {
        const targetPath = recordsPath || 'features';
        const target = getNestedProperty(parsed, targetPath);
        records = Array.isArray(target) ? target : [];
      } else {
        const target = getNestedProperty(parsed, recordsPath);
        if (Array.isArray(target)) {
          records = target;
        } else if (target && typeof target === 'object') {
          records = [target];
        }
      }
    } else if (format === 'xml') {
      const xmlParser = new XMLParser({ ignoreAttributes: false });
      const parsed = xmlParser.parse(content);
      const target = getNestedProperty(parsed, recordsPath);
      if (Array.isArray(target)) {
        records = target;
      } else if (target && typeof target === 'object') {
        records = [target];
      }
    } else if (format === 'csv') {
      const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
      records = parsed.data as any[];
    }

    if (maxRecords && maxRecords > 0) {
      return records.slice(0, maxRecords);
    }
    return records;
  }
  ```

  Run test to verify pass:
  Command: `rtk npm test --prefix backend`
  Expected Output: PASS `parsers.test.ts`.

---

## Task 5: Field Mapper Component (`field-mapper.ts`)

- [ ] **Step 5.1: Write Field Mapper Test (TDD)**

  File: `backend/src/__tests__/field-mapper.test.ts`
  ```typescript
  import { mapRecord } from '../engine/field-mapper';
  import { SourceConfig } from '../engine/yaml-loader';

  describe('Field Mapper', () => {
    const dummyConfig: SourceConfig = {
      name: 'test_earthquakes',
      source_type: 'test_earthquakes',
      layer_type: 'earthquakes',
      display_name: 'Test Quakes',
      transport: { type: 'http_poll', url: 'http://test.com', interval: '60s' },
      parser: { format: 'geojson', records_path: 'features' },
      entity: {
        external_id: 'id',
        name: 'properties.place',
        category: 'geological',
        metadata: { mag: 'properties.mag' }
      },
      observation: {
        latitude: 'geometry.coordinates[1]',
        longitude: 'geometry.coordinates[0]',
        altitude: 'geometry.coordinates[2]',
        timestamp: 'properties.time'
      }
    };

    it('should map raw geojson feature into Entity and Observation records', () => {
      const rawRecord = {
        id: 'us7000abc',
        properties: { place: 'San Francisco, CA', mag: 5.2, time: 1700000000000 },
        geometry: { coordinates: [-122.4194, 37.7749, 10.5] }
      };

      const result = mapRecord(rawRecord, dummyConfig, 'src-123');
      expect(result).not.toBeNull();
      expect(result!.entity.id).toBe('us7000abc');
      expect(result!.entity.name).toBe('San Francisco, CA');
      expect(result!.entity.category).toBe('geological');
      expect(result!.observation.latitude).toBe(37.7749);
      expect(result!.observation.longitude).toBe(-122.4194);
      expect(result!.observation.altitude).toBe(10.5);
      expect(result!.entity.metadata.mag).toBe(5.2);
    });

    it('should build a DETERMINISTIC observation id from entity + source timestamp', () => {
      const rawRecord = {
        id: 'us7000abc',
        properties: { place: 'SF', mag: 5.2, time: 1700000000000 },
        geometry: { coordinates: [-122.4194, 37.7749, 10.5] }
      };
      const a = mapRecord(rawRecord, dummyConfig, 'src-123');
      const b = mapRecord(rawRecord, dummyConfig, 'src-123');
      // Same input twice → same id (so INSERT OR IGNORE can dedup). No Date.now()/random.
      expect(a!.observation.id).toBe(b!.observation.id);
    });

    it('should SKIP (return null) when coordinates are missing — never plot at (0,0)', () => {
      const noCoords = {
        id: 'nogeo',
        properties: { place: 'nowhere', time: 1700000000000 },
        geometry: { coordinates: [] }
      };
      expect(mapRecord(noCoords, dummyConfig, 'src-123')).toBeNull();
    });
  });
  ```

- [ ] **Step 5.2: Implement `backend/src/engine/field-mapper.ts`**

  File: `backend/src/engine/field-mapper.ts`
  ```typescript
  import { SourceConfig } from './yaml-loader';

  export interface EntityRecord {
    id: string;
    source_id: string;
    category: string;
    name: string;
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: string;
    metadata: Record<string, any>;
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
    raw_payload: Record<string, any>;
  }

  // Resolve a dot/bracket path against the raw record.
  export function resolvePath(obj: any, pathStr?: string): any {
    if (!pathStr || obj == null) return undefined;
    const normalized = pathStr.replace(/\[(\d+)\]/g, '.$1');
    const parts = normalized.split('.');
    let curr = obj;
    for (const part of parts) {
      if (curr == null) return undefined;
      curr = curr[part];
    }
    return curr;
  }

  // Resolve a mapping expression: try it as a path first; if it does not resolve but is a
  // numeric string (e.g. "0"), treat it as a LITERAL constant. This is why altitude: "0"
  // yields 0 instead of looking up a field named "0".
  export function resolveValue(obj: any, expr?: string): any {
    if (expr === undefined || expr === null) return undefined;
    const viaPath = resolvePath(obj, expr);
    if (viaPath !== undefined) return viaPath;
    if (typeof expr === 'string' && expr.trim() !== '' && !Number.isNaN(Number(expr))) {
      return Number(expr); // literal number
    }
    return undefined;
  }

  function toNumber(v: any): number {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  }

  // Normalize a source timestamp (epoch sec/ms or ISO) to { ms, iso, fromSource }.
  // fromSource=false means the source provided nothing usable and we fell back to ingest time.
  function normalizeTimestamp(rawTs: any): { ms: number; iso: string; fromSource: boolean } {
    if (rawTs !== undefined && rawTs !== null && rawTs !== '') {
      let ms: number | null = null;
      if (typeof rawTs === 'number') {
        ms = rawTs > 1e11 ? rawTs : rawTs * 1000; // heuristic: seconds vs milliseconds
      } else {
        const parsed = Date.parse(String(rawTs));
        if (!Number.isNaN(parsed)) ms = parsed;
      }
      if (ms !== null) return { ms, iso: new Date(ms).toISOString(), fromSource: true };
    }
    const now = Date.now();
    return { ms: now, iso: new Date(now).toISOString(), fromSource: false };
  }

  // Returns null when the record cannot be plotted (no id or no valid coordinates) — the
  // scheduler skips nulls. We NEVER coerce a missing coordinate to 0 and plot it at (0,0).
  export function mapRecord(
    raw: any,
    config: SourceConfig,
    sourceId: string
  ): { entity: EntityRecord; observation: ObservationRecord } | null {
    const extIdRaw = resolveValue(raw, config.entity.external_id);
    if (extIdRaw === undefined || extIdRaw === null || String(extIdRaw) === '') {
      return null; // no stable identity → skip (do not invent a random id)
    }
    const extId = String(extIdRaw);
    const name = String(resolveValue(raw, config.entity.name) ?? extId);
    const category = config.entity.category || config.layer_type || 'general';

    const lat = toNumber(resolveValue(raw, config.observation.latitude));
    const lon = toNumber(resolveValue(raw, config.observation.longitude));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null; // missing/invalid position → skip (never plot at 0,0)
    }
    const alt = toNumber(resolveValue(raw, config.observation.altitude)) || 0.0;
    const speed = toNumber(resolveValue(raw, config.observation.speed)) || 0.0;
    const heading = toNumber(resolveValue(raw, config.observation.heading)) || 0.0;

    const { ms: tsMs, iso: isoTimestamp, fromSource: tsFromSource } = normalizeTimestamp(
      resolveValue(raw, config.observation.timestamp)
    );

    const metadata: Record<string, any> = {};
    if (config.entity.metadata) {
      for (const [key, expr] of Object.entries(config.entity.metadata)) {
        metadata[key] = resolveValue(raw, expr);
      }
    }

    const entity: EntityRecord = {
      id: extId,
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
      obsId = `obs_${extId}`;
    } else if (tsFromSource) {
      obsId = `obs_${extId}_${tsMs}`;
    } else {
      obsId = `obs_${extId}_${lat.toFixed(4)}_${lon.toFixed(4)}`;
    }

    const observation: ObservationRecord = {
      id: obsId,
      entity_id: extId,
      source_id: sourceId,
      latitude: lat,
      longitude: lon,
      altitude: alt,
      speed,
      heading,
      timestamp: isoTimestamp,
      raw_payload: typeof raw === 'object' ? raw : { data: raw }
    };

    return { entity, observation };
  }
  ```

  Run test to verify pass:
  Command: `rtk npm test --prefix backend`
  Expected Output: PASS `field-mapper.test.ts`.

---

## Task 6: Ingestion Scheduler & Database Persistence Component (`scheduler.ts`)

- [ ] **Step 6.1: Write Scheduler Integration Test (TDD)**

  File: `backend/src/__tests__/scheduler.test.ts`
  ```typescript
  // Mock the network so pollSource runs the real parse → map → persist path against a
  // fixed fixture (no live HTTP).
  jest.mock('../engine/http-fetcher', () => ({ fetchUrl: jest.fn() }));

  import { initDatabase, closeDatabase } from '../db/database';
  import { IngestionScheduler } from '../engine/scheduler';
  import { SourceConfig } from '../engine/yaml-loader';
  import { fetchUrl } from '../engine/http-fetcher';
  import Database from 'better-sqlite3';
  import path from 'path';

  describe('Ingestion Scheduler', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = initDatabase(':memory:');
    });

    afterEach(() => {
      closeDatabase(db);
      jest.clearAllMocks();
    });

    it('should register sources into database upon initialization', () => {
      const sourcesDir = path.resolve(__dirname, '../../../sources.d');
      const scheduler = new IngestionScheduler(db, sourcesDir);
      scheduler.initSources();

      const sources = db.prepare('SELECT * FROM sources').all() as any[];
      expect(sources.length).toBeGreaterThanOrEqual(4);
    });

    it('does NOT duplicate observations across repeated polls (idempotency)', async () => {
      // A source with a real per-record timestamp → deterministic obs id → dedup.
      db.prepare(`
        INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
        VALUES ('test_src', 'Test', 'test', 'http_poll', 'http://x', 60, 1)
      `).run();

      const config: SourceConfig = {
        name: 'test_src', source_type: 'test', layer_type: 'aircraft',
        display_name: 'Test', enabled: true,
        transport: { type: 'http_poll', url: 'http://x', interval: '60s' },
        parser: { format: 'json' },
        entity: { external_id: 'id', name: 'id', category: 'aircraft' },
        observation: { latitude: 'lat', longitude: 'lon', timestamp: 'ts' },
        recording: { mode: 'append' },
      };

      // Same fixture (same entity + same timestamp) returned every poll.
      const fixture = JSON.stringify([{ id: 'e1', lat: 10, lon: 20, ts: 1700000000000 }]);
      (fetchUrl as jest.Mock).mockResolvedValue(fixture);

      const scheduler = new IngestionScheduler(db, '/does-not-exist');
      await scheduler.pollSource(config);
      await scheduler.pollSource(config);
      await scheduler.pollSource(config);

      const obs = (db.prepare('SELECT COUNT(*) AS c FROM observations').get() as any).c;
      const ent = (db.prepare('SELECT COUNT(*) AS c FROM entities').get() as any).c;
      expect(ent).toBe(1);
      expect(obs).toBe(1); // 3 polls of identical data → ONE observation, not three
    });

    it('appends a new observation only when the position/instant actually changes', async () => {
      db.prepare(`
        INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
        VALUES ('test_src', 'Test', 'test', 'http_poll', 'http://x', 60, 1)
      `).run();
      const config: SourceConfig = {
        name: 'test_src', source_type: 'test', layer_type: 'aircraft',
        display_name: 'Test', transport: { type: 'http_poll', url: 'http://x', interval: '60s' },
        parser: { format: 'json' },
        entity: { external_id: 'id', name: 'id', category: 'aircraft' },
        observation: { latitude: 'lat', longitude: 'lon', timestamp: 'ts' },
        recording: { mode: 'append' },
      };
      const scheduler = new IngestionScheduler(db, '/x');

      (fetchUrl as jest.Mock).mockResolvedValue(JSON.stringify([{ id: 'e1', lat: 10, lon: 20, ts: 1700000000000 }]));
      await scheduler.pollSource(config);
      (fetchUrl as jest.Mock).mockResolvedValue(JSON.stringify([{ id: 'e1', lat: 11, lon: 21, ts: 1700000060000 }]));
      await scheduler.pollSource(config);

      const obs = (db.prepare('SELECT COUNT(*) AS c FROM observations').get() as any).c;
      expect(obs).toBe(2); // two distinct instants → two track points
    });
  });
  ```

- [ ] **Step 6.2: Implement `backend/src/engine/scheduler.ts`**

  File: `backend/src/engine/scheduler.ts`
  ```typescript
  import Database from 'better-sqlite3';
  import { loadSourcesFromDir, SourceConfig } from './yaml-loader';
  import { fetchUrl } from './http-fetcher';
  import { parsePayload } from './parsers';
  import { mapRecord, EntityRecord } from './field-mapper';

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

    public initSources(): SourceConfig[] {
      this.configs = loadSourcesFromDir(this.sourcesDir);

      const stmt = this.db.prepare(`
        INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          url = excluded.url,
          update_interval_sec = excluded.update_interval_sec,
          enabled = excluded.enabled
      `);

      for (const config of this.configs) {
        const intervalSec = parseInt(String(config.transport.interval).replace('s', ''), 10) || 60;
        const enabled = config.enabled !== false ? 1 : 0;
        stmt.run(
          config.name,
          config.display_name || config.name,
          config.source_type,
          config.transport.type,
          config.transport.url,
          intervalSec,
          enabled
        );
      }

      return this.configs;
    }

    public async pollSource(config: SourceConfig): Promise<number> {
      try {
        const rawContent = await fetchUrl({
          url: config.transport.url,
          method: config.transport.method || 'GET',
          headers: config.transport.headers
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
        const MAX_OBS_PER_ENTITY = 200;
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
        const changedEntities: EntityRecord[] = []; // new or moved → broadcast after commit

        const transaction = this.db.transaction(() => {
          for (const raw of rawRecords) {
            const mapped = mapRecord(raw, config, config.name);
            if (!mapped) {
              skipped++; // no identity or no valid coordinates — never plotted at (0,0)
              continue;
            }
            const { entity, observation } = mapped;

            upsertEntityStmt.run(
              entity.id, entity.source_id, entity.category, entity.name,
              entity.latitude, entity.longitude, entity.altitude, entity.timestamp,
              JSON.stringify(entity.metadata)
            );

            const obsStmt = mode === 'upsert' ? upsertObsStmt : appendObsStmt;
            obsStmt.run(
              observation.id, observation.entity_id, observation.source_id,
              observation.latitude, observation.longitude, observation.altitude,
              observation.speed, observation.heading, observation.timestamp,
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
          console.warn(`Source ${config.name}: skipped ${skipped} record(s) with missing id/coordinates`);
        }
        return written;
      } catch (err) {
        console.error(`Error polling source ${config.name}:`, err);
        return 0;
      }
    }

    public start(): void {
      this.initSources();

      for (const config of this.configs) {
        if (config.enabled === false) continue;
        const intervalSec = parseInt(String(config.transport.interval).replace('s', ''), 10) || 60;
        
        // Immediate initial poll
        this.pollSource(config);

        // Schedule periodic interval poll
        const timer = setInterval(() => {
          this.pollSource(config);
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
  ```

  Run test to verify pass:
  Command: `rtk npm test --prefix backend`
  Expected Output: PASS `scheduler.test.ts`.

---

## Task 7: Verification & Final Audit (Definition of Done)

- [ ] **Step 7.1: Run tests and lint**
  Command: `rtk make test` → all backend suites PASS, **including the idempotency test**
  (3 polls of identical data → 1 observation).
  Command: `rtk make lint` → zero TypeScript errors.

- [ ] **Step 7.2: Confirm `recording.mode` is actually consumed**
  Command: `rtk grep -n "recording" backend/src/engine/scheduler.ts`
  Expected: the scheduler reads `config.recording?.mode` and branches on it (not merely a
  parsed type). `append` → `INSERT OR IGNORE`; `upsert` → `ON CONFLICT DO UPDATE`.

- [ ] **Step 7.3: Confirm no non-deterministic ids / no `"now"` mapping**
  Command: `rtk grep -rn "Date.now\|Math.random\|\"now\"" backend/src/engine sources.d`
  Expected: no `Date.now()`/`Math.random()` used to build an observation id, and no source
  maps a timestamp to the literal `"now"`.

- [ ] **Step 7.4: Live dedup sanity check**
  Start the engine against the real feeds for ~2 minutes, then:
  ```
  sqlite3 mk-osint.db "SELECT count(*) FROM observations;"
  sqlite3 mk-osint.db "SELECT count(*) FROM entities;"
  sqlite3 mk-osint.db "SELECT count(DISTINCT entity_id||timestamp) FROM observations;"
  ```
  Expected: `observations` ≈ `count(DISTINCT entity_id||timestamp)` (no duplicate rows for
  the same entity+instant), and the observations/entities ratio is bounded — NOT tens of
  thousands of observations per entity. Categories in `entities` are only
  `{satellite, aircraft, geological, radiation, maritime}`.
