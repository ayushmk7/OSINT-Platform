# Data sources

Every feed on the globe is described by one YAML file in `sources.d/`. The engine discovers the files at startup, polls each feed on its own interval, and maps each record onto an entity (a point on the globe) and an observation (a timestamped sample of that point). Adding a feed means adding a file; no TypeScript changes are needed.

This page documents the schema as implemented in `backend/src/engine/yaml-loader.ts` (the `SourceConfig` type), `backend/src/engine/field-mapper.ts` and `backend/src/engine/scheduler.ts`. Anything not listed here is ignored by the engine.

## Loading rules

- The directory is `SOURCES_DIR`, defaulting to `sources.d/` at the repository root.
- Every `*.yaml` and `*.yml` file is read, in alphabetical order. Other files are ignored.
- Files are read once, at startup. Restart the backend to pick up changes.
- Each file is checked by `validateSourceConfig()`. It must contain these fields as non-empty strings: `name`, `source_type`, `transport.type`, `transport.url`, `parser.format`, `entity.external_id`, `observation.latitude`, `observation.longitude`. It is also rejected if `schema_version` is present and not `1`, if `transport.retry.backoff` is not one of `exponential`, `linear` or `fixed`, or if `observation.scale` is malformed (see [`observation`](#observation)).
- A file that fails validation is skipped with the error `Skipping invalid source definition <path>: <problems>`, which lists every problem found, separated by `;`.
- A file that is not valid YAML is logged and skipped. Neither case stops the other sources from loading.
- If writing a source's row to the `sources` table fails at startup, the error `Failed to register source <name>; it will not be polled` is logged and that source is dropped. The other sources still start.
- If `entity.category` is set to a value outside the canonical list, the source still loads, but a warning is logged. The frontend draws such entities with a grey fallback marker and does not list them in the layer drawer's category filters.

## Schema reference

### Top level

| Field | Type | Required | Default | Meaning |
| :-- | :-- | :-- | :-- | :-- |
| `schema_version` | number | no | `1` | Schema version. Only `1` is accepted; any other value makes the file invalid. Absent means `1`. |
| `name` | string | **yes** | | Unique source id. Stored as `sources.id` and as `source_id` on every entity and observation. |
| `source_type` | string | **yes** | | Stored in `sources.type`. |
| `layer_type` | string | no | | Used as the entity category when `entity.category` is absent. |
| `display_name` | string | no | `name` | Human label, stored in `sources.name` and shown in the layer drawer. |
| `enabled` | boolean | no | `true` | `false` registers the source (it appears in the API with `enabled: false`) but never polls it. |
| `transport` | object | **yes** | | How to fetch. See below. |
| `parser` | object | **yes** | | How to split the response into records. |
| `filter` | list | no | | Record-level predicates. |
| `entity` | object | **yes** | | Identity and metadata mapping. |
| `observation` | object | **yes** | | Position and kinematics mapping. |
| `recording` | object | no | `{ mode: append }` | How observations are stored. |

### `transport`

| Field | Type | Required | Default | Meaning |
| :-- | :-- | :-- | :-- | :-- |
| `type` | string | **yes** | | Stored in `sources.transport`. The engine only implements HTTP polling and does not branch on this value; use `http_poll`. |
| `url` | string | **yes** | | Endpoint to fetch. |
| `method` | string | no | `GET` | HTTP method. No request body is sent. |
| `headers` | map of string | no | | Extra request headers. `User-Agent: MK-OSINT/1.0` is sent by default and can be overridden here. |
| `timeout` | duration | no | `10s` | Per-attempt timeout. |
| `interval` | duration | no | `60s` | Poll period. The TypeScript type marks it required, but the loader does not check it and falls back to 60 seconds. |
| `retry.max_attempts` | number | no | `3` | Total attempts per poll, including the first. |
| `retry.initial_delay` | duration | no | `1s` | Delay before the second attempt. |
| `retry.max_delay` | duration | no | `15s` | Cap on any single delay. |
| `retry.backoff` | `exponential` \| `linear` \| `fixed` | no | `exponential` | How the delay grows. Any other value makes the file invalid. |

The retry defaults come from `DEFAULT_RETRY` in `backend/src/engine/retry.ts`, the one policy shared by the scheduler and `fetchUrl()`. The delay after failed attempt *n* (1-based) is computed by `retryDelayMs()` and always capped at `max_delay`:

| `backoff` | Delay after attempt *n* | With the defaults |
| :-- | :-- | :-- |
| `exponential` | `initial_delay × 2^(n-1)` | 1s, 2s, 4s, ... |
| `linear` | `initial_delay × n` | 1s, 2s, 3s, ... |
| `fixed` | `initial_delay` | 1s, 1s, 1s, ... |

Any non-2xx response counts as a failed attempt. When every attempt fails, the error is logged as `Error polling source <name>` and the source is tried again on the next interval.

### Duration format

Durations (`interval`, `timeout`, `retry.initial_delay`, `retry.max_delay`) are parsed by `parseDurationSeconds()`:

| Written as | Meaning |
| :-- | :-- |
| `"30s"` or `"30"` | 30 seconds. A missing unit means seconds. |
| `"5m"` | 5 minutes. |
| `"24h"` | 24 hours. |
| `"1500ms"` | Rounded to whole seconds, with a minimum of 1 second. |
| `45` (a YAML number) | 45 seconds. |

Units are case-insensitive and decimals are allowed (`"1.5m"`). The result is always whole seconds. An unparseable, zero or negative value silently falls back to the field's default.

### `parser`

| Field | Type | Required | Default | Meaning |
| :-- | :-- | :-- | :-- | :-- |
| `format` | `json` \| `geojson` \| `xml` \| `csv` | **yes** | | Response format. Any other value fails every poll with `Unsupported parser format`. |
| `records_path` | string | no | root (`features` for `geojson`) | Dot-notation path to the array of records, for example `ac`, `results.bindings` or `rss.channel.item`. |
| `max_records` | number | no | unlimited | Keep only the first N records per poll. |

How each format produces records:

- **json**: the value at `records_path`, or the whole document if it is omitted or `""`. An array is used as-is. A single object becomes one record, which suits endpoints like the ISS position API. Anything else yields no records.
- **geojson**: as `json`, but `records_path` defaults to `features`. Each record is a GeoJSON Feature, so paths look like `geometry.coordinates[1]` and `properties.mag`.
- **xml**: parsed with `fast-xml-parser` with attributes kept. Attributes appear as keys prefixed with `@_` (for example `@_id`). A repeated element that occurs only once is wrapped into a one-element array.
- **csv**: the first row is the header, and each following row becomes an object keyed by column name. Empty lines are skipped. All values are strings; the mapper converts coordinates and numbers.

`records_path` supports dots only. Bracket indices such as `data[0]` are not supported there, unlike mapping paths.

### `filter`

An optional list of rules. A record must pass **every** rule to be mapped. Records that fail are counted and logged as `excluded by filter rules`, separately from malformed records.

| Field | Type | Meaning |
| :-- | :-- | :-- |
| `field` | path | Path into the raw record (same syntax as mapping paths). |
| `in` | list of string or number | The value, trimmed and compared as a string, must equal one of these. A missing or blank value fails. |
| `not_empty` | boolean | When `true`, the value must be present and not blank. |

A rule with both `in` and `not_empty` applies both checks.

```yaml
filter:
  - field: 'type'
    in: ['large_airport', 'medium_airport']
  - field: 'icao_code'
    not_empty: true
```

### `entity`

| Field | Type | Required | Meaning |
| :-- | :-- | :-- | :-- |
| `external_id` | expression | **yes** | Stable id for the entity. Stored as `entities.id` in the form `<source name>:<external_id>`. Records where it resolves to nothing or `""` are skipped. |
| `name` | expression | the loader does not check it | Display name. Falls back to the id when it resolves to nothing. |
| `category` | string (literal) | no | One of the canonical categories below. If absent, `layer_type` is used, then `general`. |
| `metadata` | map of key to expression | no | Values copied from the record into `entities.metadata`. Keys that resolve to nothing are dropped. |
| `derived` | map of key to derived field | no | Computed metadata. See below. A derived key overrides a `metadata` key with the same name. |

`category` is a literal string, not a path. The canonical categories (`ENTITY_CATEGORIES`) are:

| Category | Marker | Colour |
| :-- | :-- | :-- |
| `satellite` | diamond | `#00f3ff` |
| `aircraft` | airplane, rotates to heading | `#ffaa00` |
| `geological` | quake glyph | `#ff0055` |
| `radiation` | radiation glyph | `#ffcc00` |
| `maritime` | ship, rotates to heading | `#4fc3f7` |
| `atc_zone` | tower, plus a circle on the ground sized from `metadata.radius_km` (default 5 km) | `#b388ff` |

Entity ids are namespaced by source: the mapper stores `<name>:<external_id>` (for example `usgs_earthquakes:ci40669442`), so two feeds that reuse an external id never overwrite each other's rows. Observation ids and `observations.entity_id` use the same prefixed id.

#### Derived fields

Each entry under `entity.derived` is one of three kinds.

**Lookup map.** Look up the value at `from` in `map`, falling back to `default`:

```yaml
radius_km:
  from: 'type'
  map:
    large_airport: 9
    medium_airport: 5
  default: 5
```

**Template.** Literal text with `{path}`, `{path|lower}` or `{path|upper}` placeholders. If any placeholder resolves to nothing, the whole value is dropped (or `default` is used, if given), so a half-built URL is never emitted:

```yaml
liveatc_url:
  template: 'https://www.liveatc.net/search/?icao={icao_code|lower}'
```

A template with no placeholders is a constant string.

**Plain copy.** Only `from`, with an optional `default`: copies the value at `from`, or uses `default` if it is missing or blank.

A derived field that resolves to nothing and has no `default` is omitted rather than written as `null`.

### `observation`

| Field | Type | Required | Default | Meaning |
| :-- | :-- | :-- | :-- | :-- |
| `latitude` | expression | **yes** | | Decimal degrees. |
| `longitude` | expression | **yes** | | Decimal degrees. |
| `altitude` | expression | no | `0` | Stored in metres; the frontend treats it as metres above the ellipsoid. Use `scale.altitude` when the feed reports another unit. |
| `speed` | expression | no | `0` | Stored on observations only. |
| `heading` | expression | no | `0` | Stored on observations only. The globe computes marker rotation from the entity's trail, not from this field. |
| `timestamp` | expression | no | ingest time | Source time of the sample. |
| `scale` | map of field to number | no | | Multiplies a resolved value by a constant. See below. |

Latitude and longitude are converted with `parseFloat`. If either is missing or not a finite number, the record is skipped and counted in the warning `skipped N record(s) with missing id/coordinates`. It is never plotted at (0, 0). Unparseable altitude, speed or heading values become `0`.

#### `observation.scale`

`scale` converts units. Its keys must be among `latitude`, `longitude`, `altitude`, `speed` and `heading`, and each value must be a finite number; anything else makes the file invalid. The resolved field is multiplied by the factor before it is stored. A negative factor flips the sign. Metadata values are never scaled.

```yaml
observation:
  altitude: 'alt_baro' # feet
  scale:
    altitude: 0.3048 # feet -> metres
```

The shipped sources use it for altitude only:

| Source | Factor | Why |
| :-- | :-- | :-- |
| `iss_position` | `1000` | The feed reports kilometres. |
| `usgs_earthquakes` | `-1000` | Depth is kilometres, positive-down. The quake is stored below the surface as negative metres; `metadata.depth` keeps the raw kilometre value. |
| `adsb_military` | `0.3048` | `alt_baro` is feet. |

Timestamps are normalized to ISO 8601:

- A number, or a numeric string, greater than 1e11 is read as epoch milliseconds. Anything smaller is read as epoch seconds.
- Any other string is passed to `Date.parse` (ISO 8601 and RFC 2822 both work).
- If the field is absent or unparseable, the ingest time is used. Leave `timestamp` unmapped for feeds with no sample time (such as ADSB snapshots). Do not map it to a literal like `"now"`.

### Expressions and path syntax

Mapping values (`external_id`, `name`, `metadata.*`, `observation.*`, `filter[].field`, `derived.*.from` and template placeholders) are **paths** into the raw record. They are not a query or expression language.

| Syntax | Example | Resolves to |
| :-- | :-- | :-- |
| key | `hex` | `record.hex` |
| dotted key | `properties.place` | `record.properties.place` |
| array index | `geometry.coordinates[1]` | `record.geometry.coordinates[1]` |
| index on an array record | `[0]` or `0` | element 0 when the record itself is an array (for example OpenSky `states`) |
| numeric literal | `'0'`, `'100'` | the number itself, **only if** no field by that name exists |

For `external_id`, `name`, `metadata.*` and `observation.*`, the engine tries the value as a path first. If that finds nothing and the value is numeric, it becomes a literal number. This is how `altitude: '0'` produces a constant 0. When the record is an array, `'0'` resolves to its first element rather than a literal. Filter fields, `derived.*.from` and template placeholders are always paths.

Keys that contain dots cannot be addressed. There are no functions, conditionals or arithmetic.

### Recording modes

`recording.mode` controls how observations are stored. The entity row is always upserted by id, holding the latest position.

| Mode | Observation rows | Observation id | Use for |
| :-- | :-- | :-- | :-- |
| `append` (default) | One per distinct instant, capped at the newest 200 per entity (`MAX_OBS_PER_ENTITY`). | `obs_<entity id>_<epoch_ms>` when the source provides a timestamp; otherwise `obs_<entity id>_<lat>_<lon>` with 4-decimal coordinates. | Moving tracks: aircraft, ships, the ISS. |
| `upsert` | Exactly one per entity, overwritten on every poll. | `obs_<entity id>` | Current-state or reference data: earthquakes, sensors, facilities. |

`<entity id>` is the prefixed `<name>:<external_id>`, for example `obs_iss_position:25544_1786644444000`.

In `append` mode, a record that repeats an instant already stored is ignored (`INSERT OR IGNORE`, backed by the unique index on `(entity_id, timestamp)`). Without a source timestamp, the position-based id means a stationary target does not add a row on every poll, while any movement does.

If `recording` is omitted, the mode is `append`.

### Display options

There are none. The engine has no `display`, `style`, `icon`, `labels`, `cache` or `history` block. Unknown keys in a source file are ignored. Marker shape and colour are chosen by the frontend from `entity.category` alone (see `frontend/src/components/globeMarkers.ts`). The only per-entity rendering input is `metadata.radius_km` on `atc_zone` entities, which sizes the ground circle. The entity inspector also shows a "Listen to ATC (LiveATC.net)" link when an `atc_zone` entity has `metadata.liveatc_url`.

## Worked example

`sources.d/usgs_earthquakes.yaml` polls the USGS past-hour earthquake feed every minute:

```yaml
schema_version: 1
name: usgs_earthquakes # sources.id and source_id on every row
source_type: usgs_earthquakes # sources.type (must be present)
layer_type: earthquakes
display_name: 'USGS Earthquakes' # label in the layer drawer
enabled: true

transport:
  type: http_poll
  url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson'
  method: GET
  headers:
    Accept: 'application/json'
  timeout: '10s'
  interval: '60s'
  retry:
    max_attempts: 3
    backoff: exponential # or linear / fixed
    initial_delay: '1s'
    max_delay: '15s'

parser:
  format: geojson
  records_path: 'features' # the default for geojson; explicit here
  max_records: 1000

entity:
  external_id: 'id' # e.g. "ci40669442"
  name: 'properties.place' # e.g. "3 km NNW of Murrieta, CA"
  category: 'geological'
  metadata:
    magnitude: 'properties.mag'
    depth: 'geometry.coordinates[2]'

observation:
  latitude: 'geometry.coordinates[1]' # GeoJSON order is [lon, lat, depth]
  longitude: 'geometry.coordinates[0]'
  altitude: 'geometry.coordinates[2]'
  speed: '0' # literal constant
  heading: '0'
  timestamp: 'properties.time' # epoch milliseconds
  scale:
    altitude: -1000 # km positive-down -> metres below the surface

recording:
  mode: upsert # one observation per quake, refreshed in place
```

Given this feature from the feed:

```json
{
  "type": "Feature",
  "id": "ci40669442",
  "properties": { "mag": 1.61, "place": "3 km NNW of Murrieta, CA", "time": 1786297095660 },
  "geometry": { "type": "Point", "coordinates": [-117.2311666666667, 33.5795, 15.07] }
}
```

the engine writes this entity:

```json
{
  "id": "usgs_earthquakes:ci40669442",
  "source_id": "usgs_earthquakes",
  "category": "geological",
  "name": "3 km NNW of Murrieta, CA",
  "latitude": 33.5795,
  "longitude": -117.2311666666667,
  "altitude": -15070,
  "timestamp": "2026-08-09T17:38:15.660Z",
  "metadata": { "magnitude": 1.61, "depth": 15.07 }
}
```

and one observation with id `obs_usgs_earthquakes:ci40669442`, which is overwritten on later polls because the mode is `upsert`.

## Sources in `sources.d/`

These five files are loaded by default.

| File | Display name | Category | Feed | Interval | Mode |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `adsb_military.yaml` | Military Flights ADSB | `aircraft` | `https://opendata.adsb.fi/api/v2/mil` (JSON, `ac`) | 30s | append |
| `atc_facilities.yaml` | ATC Facilities (OurAirports) | `atc_zone` | `https://davidmegginson.github.io/ourairports-data/airports.csv` (CSV, filtered to large and medium airports that have an ICAO code) | 24h | upsert |
| `iss_position.yaml` | ISS Position Tracker | `satellite` | `https://api.wheretheiss.at/v1/satellites/25544` (JSON, single object) | 30s | append |
| `safecast_radiation.yaml` | Safecast Radiation Monitoring | `radiation` | `https://api.safecast.org/measurements.json?limit=100` (JSON array) | 300s | upsert |
| `usgs_earthquakes.yaml` | USGS Earthquakes | `geological` | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson` (GeoJSON) | 60s | upsert |

`atc_facilities.yaml` is the only shipped file that uses `filter` and `entity.derived`. It computes `radius_km`, `zone_note` and `liveatc_url`. The radii are an illustrative stand-in sized by airport class, not real control-zone boundaries.

## Adding a source with the `onboard-source` skill

[`skills/onboard-source/SKILL.md`](../skills/onboard-source/SKILL.md) is an agent skill: point your coding agent at it with a URL, and it fetches the endpoint, works out the format and record path, maps the fields and writes `sources.d/<name>.yaml`.

The skill describes the same schema as this page (`schema_version: 1`, bare paths, `filter` rules, `observation.scale`, the three `backoff` values) and writes into `sources.d/` in your checkout. For example: *"Use skills/onboard-source to add `<URL>`."*

After adding a file, restart the backend and watch its log for `Skipping invalid source definition`, `non-canonical entity.category`, `Error polling source` or `skipped N record(s)`. Then check `GET /api/entities?source_id=<name>`.

### The 19 examples

[`skills/onboard-source/examples/`](../skills/onboard-source/examples/) holds 19 no-auth source definitions. All of them use `schema_version: 1` and the path syntax described above, so they are compatible with this engine without edits. To enable one, copy it into `sources.d/` and restart the backend. Four of them share a `name` with a file already in `sources.d/`: `adsb_military`, `iss_position`, `safecast_radiation` and `usgs_earthquakes`. Replace the existing file rather than keeping both: two files with the same `name` would both be polled but share one `sources` row and one `source_id`.

| File | Category | Format | Feed |
| :-- | :-- | :-- | :-- |
| `adsb_military.yaml` | aircraft | json | opendata.adsb.fi military |
| `adsb_theairtraffic_flights.yaml` | aircraft | json | globe.theairtraffic.com |
| `aviationweather_sigmets.yaml` | aircraft | json | aviationweather.gov SIGMETs |
| `bellingcat_ukraine.yaml` | geological | json | Bellingcat Ukraine civilian harm |
| `emsc_earthquakes.yaml` | geological | geojson | EMSC seismicportal.eu |
| `gdacs_disasters.yaml` | geological | geojson | GDACS disaster alerts |
| `iss_position.yaml` | satellite | json | api.wheretheiss.at |
| `military_bases_wikidata.yaml` | aircraft | json | Wikidata SPARQL (military bases) |
| `nga_world_ports.yaml` | maritime | json | NGA World Port Index |
| `nifc_wildfires.yaml` | geological | geojson | NIFC wildfire perimeters (ArcGIS) |
| `open_sky_flights.yaml` | aircraft | json | OpenSky Network state vectors |
| `ourairports_airports.yaml` | aircraft | csv | OurAirports airports.csv |
| `safecast_radiation.yaml` | radiation | json | api.safecast.org |
| `smithsonian_volcanoes.yaml` | geological | json | NOAA NCEI volcano events |
| `spacedevs_launches.yaml` | satellite | json | The Space Devs upcoming launches |
| `submarine_cable_landings.yaml` | maritime | geojson | submarinecablemap.com landing points |
| `usgs_earthquakes.yaml` | geological | geojson | USGS past-hour feed |
| `wikidata_nuclear_facilities.yaml` | radiation | json | Wikidata SPARQL (nuclear facilities) |
| `wri_power_plants.yaml` | radiation | csv | WRI Global Power Plant Database |

Several examples map a non-matching feed onto the closest canonical category so it gets a marker. For instance, military bases and airports use `aircraft`, and power plants use `radiation`.

## AI analyses (`analysis.d/`)

Sources fill the database; analyses read it. Each file in `analysis.d/` at the repo root (override with `MKOSINT_ANALYSIS_DIR`) defines one scheduled LLM analysis whose results appear as insights in the UI. The engine is inert until an LLM provider is configured (see [development.md](development.md#ai-analysis)); how runs are executed is in [architecture.md](architecture.md#ai-analysis-engine).

```yaml
schema_version: 1              # optional, only 1 is accepted
name: quake_swarm_detection    # required, unique, lowercase snake_case
description: One line shown by GET /api/insights/status.
enabled: true                  # default true
schedule: '15m'                # interval (>= 10s) or 5-field cron in UTC, e.g. '5,35 * * * *'

input:                         # exactly one of `layers` or `sql`
  layers: [geological, earthquakes]   # layer ids (entities.category); unknown ids match nothing
  lookback: 6h                 # default 1h: entities with timestamp >= now - lookback
  max_records: 200             # default 200, capped at 500
  filter:                      # optional, ALL must hold (layers input only)
    - { field: metadata.magnitude, op: '>=', value: 4 }
  run_if_empty: false          # default false: an empty input never calls the model

  # or, instead of layers/filter:
  sql: |
    SELECT id, name, latitude, longitude FROM entities
    WHERE category = 'aircraft' AND timestamp >= :since

prompt: |                      # the user message; {{records}} {{stats}} {{now}} are substituted
  ...

output:
  max_insights: 5              # default 5, 1-20
  schema:                      # optional: structured `data` object on every insight
    type: object
    properties:
      peak_cpm: { type: number }
      assessment: { type: string, enum: [elevated, sensor_fault] }

min_attention: low             # info | low | medium | high | critical (default low)
dedup_window: 6h               # default 24h: identical input inside the window is skipped
retention: 7d                  # default 7d: this analysis's older insights are deleted
```

Durations use `ms`, `s`, `m`, `h` or `d`. Cron fields accept `*`, numbers, ranges `a-b`, lists `a,b` and steps `*/n`; day-of-week 0 and 7 are Sunday; when day-of-month and day-of-week are both restricted, either may match.

### Layer input

Reads `entities` whose `category` is one of `layers` and whose `timestamp` is inside the lookback, newest first. Filters run on up to 5,000 candidate rows before `max_records` is applied. Filter fields: `name`, `category`, `source_id`, `latitude`, `longitude`, `altitude`, `timestamp`, `metadata.<path>`. Operators: `==`, `!=`, `>`, `>=`, `<`, `<=` (numeric), `in` (list), `contains` (case-insensitive substring), `exists`.

Layer ids are deliberately not checked against the loaded sources: sources come and go, and the legacy categories (`geological`, `aircraft`) are being joined by newer layer ids (`earthquakes`, ...). List both when in doubt; an id nothing produces just matches no rows.

Each record reaches the model as one compact JSON line: `id`, `layer`, `name`, `lat`, `lon`, `alt`, `ts`, `meta` (long strings clipped, at most 25 metadata keys).

### SQL input

For joins and aggregates. The query must be one `SELECT` (or `WITH ... SELECT`) and passes three guards:

1. A syntactic check at load time (no `;` except a trailing one).
2. `stmt.readonly && stmt.reader` from better-sqlite3 (SQLite's own read-only test), so `DELETE ... RETURNING`, CTE-wrapped writes, `PRAGMA` assignments and `ATTACH` are refused.
3. Execution in a short-lived child process on a **separate read-only connection**, SIGKILLed after 5 s, returning at most 500 rows (or `max_records` if lower).

`:since` (now minus `lookback`) and `:now` are bound as ISO 8601 strings when the query uses them. Entity timestamps are ISO 8601 strings, so compare as strings or build bounds with `strftime('%Y-%m-%dT%H:%M:%fZ', :now, '-15 minutes')`. `haversine_km(lat1, lon1, lat2, lon2)` (great-circle km, NULL if any argument is NULL) is available; pre-filter joins with a cheap latitude band such as `abs(a.latitude - b.latitude) < 3`. String columns named `id` or ending in `_id` count as entity references.

### Prompt and output

The file's `prompt` is the user message; a fixed system prompt (`SYSTEM_PROMPT` in `backend/src/analysis/engine.ts`) sets the role, the attention scale, the id rules, and that record content is untrusted data, not instructions.

| Placeholder | Value |
| :-- | :-- |
| `{{records}}` | Input records as JSON lines, or `(no records)`. Appended at the end if the template omits it. |
| `{{stats}}` | JSON: `total`, `truncated`, `by_layer`, `oldest`, `newest`, `lookback_hours`. |
| `{{now}}` | Run time, ISO 8601 UTC. |

The model must return `{"insights": [...]}`, each item with `title`, `summary`, `attention`, `entity_ids` and, when `output.schema` is set, `data`. The schema subset is `type`, `properties`, `required`, `items`, `enum`, `description`; every object is closed (`additionalProperties: false`) and every declared property becomes required, the strict form both providers' structured-output modes expect.

### Shipped analyses

| File | Input | Schedule | Looks for |
| :-- | :-- | :-- | :-- |
| `aircraft_near_quakes.yaml` | SQL: aircraft within 300 km of M4+ quakes | every 10 min | Military aircraft operating near recent quakes (possible response flights). |
| `radiation_outliers.yaml` | `radiation` layer, 24 h | every 30 min | Readings far above comparable sensors, clusters, sensor faults. |
| `quake_swarm_detection.yaml` | SQL: quakes with neighbour counts within 50 km | every 15 min | Swarms and aftershock sequences. |
| `infrastructure_exposure.yaml` | SQL: facilities within 150 km of M5+ quakes | `5,35 * * * *` | Airports / control zones (and power plants, ports when loaded) exposed to shaking. |
| `iss_pass_summary.yaml` | SQL over ISS observations, 150 min | `0 */3 * * *` | Plain-language ground-track summary. |
| `daily_situation_digest.yaml` | SQL: per-layer counts plus top quakes and readings | `0 6 * * *` | Shift-start digest. |
