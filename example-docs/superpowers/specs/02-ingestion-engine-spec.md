# Technical Specification: 02 - Backend Declarative Ingestion Engine

## 1. Overview
This specification details the architecture for the backend YAML Declarative Ingestion Engine of the ReconVillage OSINT Platform. The engine automatically discovers declarative `.yaml` source definitions in `sources.d/`, periodically polls external HTTP APIs (supporting JSON, GeoJSON, XML, and CSV data formats), normalizes raw record payloads into standardized `EntityRecord` and `ObservationRecord` structures, and persists telemetry state into SQLite database tables (`entities` and `observations`).

---

## 2. Ingestion Pipeline & Component Architecture

```
sources.d/*.yaml ──> [ YamlLoader ]
                          │
                          ▼
                 [ IngestionScheduler ]
                          │
                 (Interval Timer Trigger)
                          │
                          ▼
                  [ HttpFetcher ] ──> (External HTTP API)
                          │
                          ▼ (Raw Response Payload)
                 [ Format Parsers ] (JSON, GeoJSON, XML, CSV)
                          │
                          ▼ (Raw Record Objects[])
                  [ FieldMapper ]
                          │
                          ▼ (Typed Entity & Observation Records)
               [ Database Persistence ] ──> SQLite (entities, observations)
```

### Engine Modules Breakdown:
- **`backend/src/engine/yaml-loader.ts`**: Discovers, loads, and validates `.yaml` source definitions from `sources.d/`.
- **`backend/src/engine/http-fetcher.ts`**: Fetches external data over HTTP/HTTPS with timeout control, user-agent headers, and exponential backoff retry handling.
- **`backend/src/engine/parsers/`**:
  - `json-parser.ts`: Parses standard JSON responses and navigates nested arrays using `records_path`.
  - `geojson-parser.ts`: Extracts GeoJSON `Feature` items from `FeatureCollection` payloads.
  - `xml-parser.ts`: Uses `fast-xml-parser` to parse XML documents into traversable JS objects.
  - `csv-parser.ts`: Uses `papaparse` / `csv-parse` to convert tabular CSV responses into array objects.
- **`backend/src/engine/field-mapper.ts`**: Resolves dot-notation field paths, converts data types (coordinates to float, timestamps to ISO strings), and maps records to target database entities/observations.
- **`backend/src/engine/scheduler.ts`**: Manages active ingestion jobs, executes interval timers, coordinates fetch-parse-map-store cycles, and writes records to SQLite.

---

## 3. Declarative Source YAML Schema Specification

Every source definition in `sources.d/*.yaml` follows a standardized declarative schema:

```yaml
schema_version: 1

name: usgs_earthquakes
source_type: usgs_earthquakes
layer_type: earthquakes
display_name: "USGS Earthquakes"
enabled: true

# Transport Configuration
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
    backoff: exponential
    initial_delay: "1s"
    max_delay: "15s"

# Parser Configuration
parser:
  format: geojson            # json | geojson | xml | csv
  records_path: "features"   # Dot-notation path to record array (optional)
  max_records: 1000

# Entity Mapping Rules
entity:
  external_id: "id"
  name: "properties.place"
  category: "geological"
  metadata:
    magnitude: "properties.mag"
    depth: "geometry.coordinates[2]"

# Observation Mapping Rules
observation:
  latitude: "geometry.coordinates[1]"
  longitude: "geometry.coordinates[0]"
  altitude: "geometry.coordinates[2]"
  speed: "0"
  heading: "0"
  timestamp: "properties.time"

# Persistence Recording Mode
recording:
  mode: upsert              # upsert | append
```

---

## 4. Component Technical Specifications

### 4.1 YAML Loader (`yaml-loader.ts`)
- **Responsibility**: Load `.yaml` files from a target directory, parse content using `yaml` package, and validate required fields (`name`, `transport.url`, `parser.format`, `entity`, `observation`).
- **Interface**:
  ```typescript
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
        backoff?: string;
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

  export function loadSourcesFromDir(dirPath: string): SourceConfig[];
  ```

### 4.2 HTTP Fetcher (`http-fetcher.ts`)
- **Responsibility**: Issue HTTP GET or POST requests with configurable timeout (default 10s), headers, and retry logic. Returns response content as string.
- **Interface**:
  ```typescript
  export interface FetchOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxAttempts?: number;
  }

  export async function fetchUrl(options: FetchOptions): Promise<string>;
  ```

### 4.3 Multi-Format Response Parsers (`parsers/`)
- **Responsibility**: Convert raw string payloads into arrays of JavaScript objects based on `format` (`json`, `geojson`, `xml`, `csv`).
- **Interface**:
  ```typescript
  export interface IParser {
    parse(content: string, recordsPath?: string, maxRecords?: number): any[];
  }
  ```
- **Supported Formats**:
  1. `json`: Direct JSON.parse + `records_path` traversal (e.g. `data.items` or top-level array).
  2. `geojson`: Extract `features` array from `FeatureCollection` objects.
  3. `xml`: Uses `fast-xml-parser` with `ignoreAttributes: false` and `records_path` resolution.
  4. `csv`: Uses `papaparse` with `header: true` and `skipEmptyLines: true`.

### 4.4 Field Mapper (`field-mapper.ts`)
- **Responsibility**: Normalize raw payload object properties into strict `EntityRecord` and `ObservationRecord` fields, producing a **deterministic** observation id.
- **Path Resolution & Coercion Rules**:
  - Resolves dot-notation paths (e.g. `properties.mag`, `geometry.coordinates[0]`).
  - **Literal values**: a mapping value that is not a resolvable path (e.g. `altitude: "0"`,
    `speed: "0"`) is treated as a **literal constant**, not a lookup of a field named `"0"`.
  - Coerces numbers: string/number inputs converted to floats for `latitude`, `longitude`, `altitude`, `speed`, `heading`.
  - **Timestamps**: use the **source-provided** timestamp (Unix epoch ms/sec or ISO),
    normalized to ISO-8601. Only fall back to `new Date()` when the source genuinely provides
    none — and never for the dedup key (see below). Do **not** map a source's field to the
    literal string `"now"` as a way of stamping current time; that defeats deduplication.
  - **Deterministic observation id**: derive it from `entity_id` + the source timestamp
    (`obs_${entity_id}_${sourceTimestampMs}` for `append`; `obs_${entity_id}` for `upsert`).
    Never build the id from `Date.now()`/`Math.random()` — that makes every insert unique and
    dedup impossible.
  - **Missing coordinates**: if latitude or longitude cannot be resolved to a finite number,
    the record is **skipped** (and logged). Missing coordinates must never be coerced to `0`
    and plotted at `(0,0)`.
- **Interfaces & Output**:
  ```typescript
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

  export function mapRecord(
    raw: any,
    config: SourceConfig,
    sourceId: string
  ): { entity: EntityRecord; observation: ObservationRecord };
  ```

### 4.5 Ingestion Scheduler (`scheduler.ts`) — deduplicating persistence

- **Responsibility**: Initializes timers for enabled sources, triggers poll iterations, maps records, and performs **idempotent** SQLite persistence transactions.

- **Deduplication requirement (this is the fix for the 372k-row bug).** External feeds are
  polled far more often than they change (USGS `all_hour` every 60s, ISS every 30s, ADSB
  every 30s). Re-persisting the same physical data point on every poll is what caused
  unbounded growth. The scheduler MUST:
  1. Build a **deterministic** observation id (no `Date.now()`/random) — see below.
  2. **Honor the per-source `recording.mode`** parsed from YAML. The scheduler MUST read
     `config.recording?.mode`; a mode that is parsed but never used is the exact defect being
     corrected.

- **Entity Upsert** (unchanged idea, but must not zero-out good coordinates — see §4.4):
  ```sql
  INSERT INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
  VALUES (@id, @source_id, @category, @name, @latitude, @longitude, @altitude, @timestamp, @metadata)
  ON CONFLICT(id) DO UPDATE SET
    category = excluded.category,
    name = excluded.name,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    altitude = excluded.altitude,
    timestamp = excluded.timestamp,
    metadata = excluded.metadata;
  ```
  Records whose position is missing/invalid are skipped (logged), never inserted at `(0,0)`.

- **Observation persistence — branch on `recording.mode`:**
  - **`append`** (historical track: ISS, aircraft). Deterministic id
    `obs_${entity_id}_${sourceTimestampMs}`; rely on the `UNIQUE(entity_id, timestamp)`
    index. A repeat poll of the same instant is a no-op:
    ```sql
    INSERT OR IGNORE INTO observations
      (id, entity_id, source_id, latitude, longitude, altitude, speed, heading, timestamp, raw_payload)
    VALUES (@id, @entity_id, @source_id, @latitude, @longitude, @altitude, @speed, @heading, @timestamp, @raw_payload);
    ```
  - **`upsert`** (current-state: earthquakes). One observation row per entity; id
    `obs_${entity_id}`; re-polling updates in place instead of appending:
    ```sql
    INSERT INTO observations
      (id, entity_id, source_id, latitude, longitude, altitude, speed, heading, timestamp, raw_payload)
    VALUES (@id, @entity_id, @source_id, @latitude, @longitude, @altitude, @speed, @heading, @timestamp, @raw_payload)
    ON CONFLICT(id) DO UPDATE SET
      latitude = excluded.latitude, longitude = excluded.longitude, altitude = excluded.altitude,
      speed = excluded.speed, heading = excluded.heading, timestamp = excluded.timestamp,
      raw_payload = excluded.raw_payload;
    ```

- **Retention (recommended):** cap `append` observations per entity (e.g. keep the newest
  200) or apply a TTL, so long-running sessions stay bounded.

- **Broadcast hook (wired in step 3):** after a successful entity upsert, the scheduler emits
  to the telemetry broadcaster **only when the entity is new or its position changed** — not
  once per record per poll. (See spec 03 §5.)

---

## 5. Sample Declarative Source Definitions (`sources.d/`)

`entity.category` MUST use the shared enum spelled exactly
(`satellite | aircraft | geological | radiation | maritime`):

1. **`sources.d/usgs_earthquakes.yaml`**: USGS hourly earthquake feed (GeoJSON) — category `geological`, `recording.mode: upsert`.
2. **`sources.d/iss_position.yaml`**: ISS orbit location tracker (JSON object) — category `satellite`, `recording.mode: append`.
3. **`sources.d/adsb_military.yaml`**: ADSB military flight data (JSON with `ac` path) — category `aircraft` (NOT `military_aircraft`), `recording.mode: append`.
4. **`sources.d/safecast_radiation.yaml`**: Safecast radiation sensors (JSON array) — category `radiation` (NOT `radiation_sensor`), `recording.mode: upsert`.

> `maritime` has no sample source here. Either add a real AIS/vessel source
> (`sources.d/aisstream.yaml` or similar) or do not advertise `maritime` in the frontend —
> no UI category may exist with zero backing data.

---

## 6. Hard Requirements & Definition of Done

Step 2 is **done** only when observed:

1. **Idempotency:** poll a fixed fixture ≥5× → `COUNT(*) observations` == count of distinct
   `(entity_id, timestamp)`, not `polls × records`. (Write this as an automated test.)
2. **`recording.mode` consumed:** `grep -n recording backend/src/engine/scheduler.ts` shows
   it read; `append` uses `INSERT OR IGNORE`, `upsert` uses `ON CONFLICT DO UPDATE`.
3. **Deterministic ids** from entity + source timestamp; no `Date.now()`/random in ids; no
   `"now"` timestamp mapping.
4. **Canonical categories** across all `sources.d/*.yaml`.
5. **No `(0,0)`:** records with missing coordinates are skipped + logged; upserts never zero
   out good coordinates.
6. **Literals** (`altitude: "0"`) resolve to the constant.
7. **No silent catches**; a failed poll logs and continues.
8. **Bounded live run:** after ~2 min against real feeds, observations/entities ratio is
   sane (not thousands per entity).
