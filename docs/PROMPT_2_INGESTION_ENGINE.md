# PROMPT 2: Backend Declarative Ingestion Engine

You are an expert Full-Stack Software Engineer specializing in Node.js, TypeScript, SQLite, YAML data ingestion, and background schedulers.

Your task is to generate a Superpowers Spec and Implementation Plan, then execute Step 2 of the ReconVillage OSINT Platform: building the backend YAML Declarative Ingestion Engine to fetch, parse, map, and store telemetry data from multiple external OSINT APIs.

## Instructions & Constraints
- **Engine Architecture**: Place all engine code inside `backend/src/engine/`.
- **YAML Source Loader (`backend/src/engine/yaml-loader.ts`)**:
  - Read and validate declarative `.yaml` source files located in `sources.d/`.
  - Parse source metadata, transport settings, format rules, mapping configurations, and recording modes using the `yaml` package.
- **HTTP Fetcher (`backend/src/engine/http-fetcher.ts`)**:
  - Execute HTTP GET/POST requests based on YAML transport configuration.
  - Support headers, timeouts (e.g. 10s-30s), and configurable retry logic with backoff.
- **Multi-Format Parsers (`backend/src/engine/parsers/`)**:
  - `json-parser.ts`: Extract JSON array or nested records matching `records_path`.
  - `geojson-parser.ts`: Parse GeoJSON `FeatureCollection` items into structured records.
  - `xml-parser.ts`: Parse XML payloads using `fast-xml-parser`.
  - `csv-parser.ts`: Parse CSV data streams using `papaparse` (or `csv-parse`).
- **Field Mapper (`backend/src/engine/field-mapper.ts`)**:
  - Standardize raw records into typed `EntityRecord` (`id`, `source_id`, `category`, `name`, `latitude`, `longitude`, `altitude`, `timestamp`, `metadata`) and `ObservationRecord` (`id`, `entity_id`, `source_id`, `latitude`, `longitude`, `altitude`, `speed`, `heading`, `timestamp`, `raw_payload`).
  - Extract record fields via dot-notation path resolution and type coercions (numbers, strings, coordinates).
- **Ingestion Scheduler (`backend/src/engine/scheduler.ts`)**:
  - Manage polling loops for enabled sources based on `update_interval_sec` / `interval`.
  - Upsert target `entities` (mode: `upsert`) and record historical `observations` (mode: `append`) in SQLite.
- **Declarative Source Definitions**: Create sample source YAMLs in `sources.d/`:
  - `sources.d/usgs_earthquakes.yaml` (USGS GeoJSON Feed)
  - `sources.d/iss_position.yaml` (ISS Space Tracking API)
  - `sources.d/adsb_military.yaml` (ADSB Military Aircraft API)
  - `sources.d/safecast_radiation.yaml` (Safecast Radiation Feed)
- **Deduplication (critical)**: Observations MUST be **idempotent** under repeated polling.
  The previous run generated 372,114 observation rows for only 10,347 entities because it
  used a random/timestamped observation id and a plain `INSERT` that ignored the per-source
  `recording.mode`. You MUST: (a) build a **deterministic** observation id from the entity
  and the **source-provided** timestamp; (b) **honor `recording.mode`** (`append` →
  `INSERT OR IGNORE` against the `UNIQUE(entity_id, timestamp)` index; `upsert` → one row
  per entity via `ON CONFLICT DO UPDATE`); (c) never fabricate a timestamp with `Date.now()`
  when the source provides one.
- **Canonical categories**: `entity.category` in every source YAML MUST be one of the shared
  enum values — `satellite | aircraft | geological | radiation | maritime` — spelled exactly
  (e.g. military flights are `aircraft`, Safecast is `radiation`), so the frontend's filters
  and icon map match the data.
- **Superpowers Alignment**: Create `docs/superpowers/specs/02-ingestion-engine-spec.md` and `docs/superpowers/plans/02-ingestion-engine-plan.md` first, then follow TDD to execute the plan.
- **RTK Usage (agent shell ONLY)**: Prefix *your own* shell commands with `rtk` (e.g., `rtk npm test`, `rtk tsc`). Never write `rtk` into any committed file.

## Format Requirements
1. First, create the technical spec file at `docs/superpowers/specs/02-ingestion-engine-spec.md`.
2. Second, create the step-by-step TDD implementation plan at `docs/superpowers/plans/02-ingestion-engine-plan.md`.
3. Finally, execute the implementation plan step-by-step, verifying with `rtk make test` and `rtk make lint`.

## Analysis Steps
1. Review declarative YAML source format standards and target APIs (USGS, ISS, ADSB, Safecast).
2. Design component interfaces for loader, fetcher, parsers, mapper, and scheduler.
3. Establish unit and integration test strategies for parsing each format, field mapping, and SQLite upsert/append operations.
4. Construct spec, plan, YAML files, and engine implementation systematically.

## Input Data
=============================================
Project Target: ReconVillage Backend Ingestion Engine
Stack: Node.js, TypeScript, better-sqlite3, fast-xml-parser, papaparse, yaml, axios / native fetch

Target Engine Modules:
1. `backend/src/engine/yaml-loader.ts` (loads `.yaml` files from `sources.d/`)
2. `backend/src/engine/http-fetcher.ts` (HTTP fetching with retries & timeouts)
3. `backend/src/engine/parsers/` (`json`, `geojson`, `xml`, `csv`)
4. `backend/src/engine/field-mapper.ts` (standardizes raw payload -> entity & observation)
5. `backend/src/engine/scheduler.ts` (runs interval polling & SQLite persistence)

Required Sample Source Files in `sources.d/`:
- `sources.d/usgs_earthquakes.yaml`   (category: `geological`)
- `sources.d/iss_position.yaml`       (category: `satellite`)
- `sources.d/adsb_military.yaml`      (category: `aircraft`)
- `sources.d/safecast_radiation.yaml` (category: `radiation`)
=============================================

## Hard Requirements & Definition of Done

Step 2 is **done** only when every item below is verified by observation:

1. **Idempotency test (the key one).** Given a fixed upstream fixture, polling the same
   source **≥5 times** must NOT grow the observations table beyond the number of distinct
   `(entity_id, timestamp)` records. Assert `COUNT(*) FROM observations` equals the count of
   distinct `(entity_id, timestamp)` — not `polls × records`.
2. **`recording.mode` is actually read.** `grep -n "recording" backend/src/engine/scheduler.ts`
   must show it is consumed (not just parsed into a type). `append` → `INSERT OR IGNORE`;
   `upsert` → `ON CONFLICT DO UPDATE`.
3. **Deterministic observation id** derived from `entity_id` + the source's own timestamp
   (e.g. `obs_${entity_id}_${sourceTimestampMs}` for append, `obs_${entity_id}` for upsert).
   No `Date.now()`/random in the id when the source provides a timestamp.
4. **Canonical categories** — the set of `category` values across `sources.d/*.yaml` is a
   subset of `{satellite, aircraft, geological, radiation, maritime}`.
5. **No `(0,0)` plotting.** A record with a missing/invalid coordinate is skipped and logged,
   not inserted at latitude/longitude `0,0`. An upsert that omits a coordinate must not
   overwrite a previously-good position with `0`.
6. **Literal mappings supported** — a mapping value like `altitude: "0"` yields the literal
   `0`, not a lookup of a field named `"0"`.
7. **No silent catches.** A failed poll logs the source name + error and continues; it does
   not swallow the error.
8. **Realistic live check.** Run the engine against the real feeds for ~2 minutes, then
   inspect the DB: the observations/entities ratio must be bounded (not tens-of-thousands
   per entity).
