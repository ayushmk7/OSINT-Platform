# Data sources

Every feed on the globe is described by one YAML file in `sources.d/`. The engine discovers the files at startup, polls each feed on its own interval, and maps each record onto an entity (a point on the globe) and an observation (a timestamped sample of that point). Adding a feed means adding a file; no TypeScript changes are needed.

This page documents the schema as implemented in `backend/src/engine/yaml-loader.ts` (the `SourceConfig` type), `backend/src/engine/field-mapper.ts` and `backend/src/engine/scheduler.ts`. Anything not listed here is ignored by the engine.

## Loading rules

- The directory is `SOURCES_DIR`, defaulting to `sources.d/` at the repository root.
- Every `*.yaml` and `*.yml` file is read, in alphabetical order. Other files are ignored.
- Files are read once, at startup. Restart the backend to pick up changes.
- A file is loaded only if these fields are present and are strings: `name`, `transport.url`, `parser.format`, `entity.external_id`, `observation.latitude`, `observation.longitude`. Otherwise it is skipped with the warning `Skipping invalid source definition (missing required fields)`.
- A file that is not valid YAML is logged and skipped. It never stops the other sources from loading.
- If `entity.category` is set to a value outside the canonical list, the source still loads, but a warning is logged. The frontend draws such entities with a grey fallback marker and does not list them in the layer drawer's category filters.

## Schema reference

### Top level

| Field | Type | Required | Default | Meaning |
| :-- | :-- | :-- | :-- | :-- |
| `schema_version` | number | no | | Informational. The engine does not read it. All shipped files use `1`. |
| `name` | string | **yes** | | Unique source id. Stored as `sources.id` and as `source_id` on every entity and observation. |
| `source_type` | string | **yes in practice** | | Stored in `sources.type`. The loader does not check it, but the column is `NOT NULL`, so a file without it makes source registration fail at startup. |
| `layer_type` | string | no | | Used as the entity category when `entity.category` is absent. |
| `display_name` | string | no | `name` | Human label, stored in `sources.name` and shown in the layer drawer. |
| `enabled` | boolean | no | `true` | `false` registers the source (it appears in the API with `enabled: 0`) but never polls it. |
| `transport` | object | **yes** | | How to fetch. See below. |
| `parser` | object | **yes** | | How to split the response into records. |
| `filter` | list | no | | Record-level predicates. |
| `entity` | object | **yes** | | Identity and metadata mapping. |
| `observation` | object | **yes** | | Position and kinematics mapping. |
| `recording` | object | no | `{ mode: append }` | How observations are stored. |

### `transport`

| Field | Type | Required | Default | Meaning |
| :-- | :-- | :-- | :-- | :-- |
| `type` | string | no | | Stored in `sources.transport`. The engine only implements HTTP polling and does not branch on this value; use `http_poll`. |
| `url` | string | **yes** | | Endpoint to fetch. |
| `method` | string | no | `GET` | HTTP method. No request body is sent. |
| `headers` | map of string | no | | Extra request headers. `User-Agent: ReconVillage-OSINT/1.0` is sent by default and can be overridden here. |
| `timeout` | duration | no | `10s` | Per-attempt timeout. |
| `interval` | duration | no | `60s` | Poll period. The TypeScript type marks it required, but the loader does not check it and falls back to 60 seconds. |
| `retry.max_attempts` | number | no | `3` | Total attempts per poll, including the first. |
| `retry.initial_delay` | duration | no | `1s` | Delay before the second attempt. |
| `retry.max_delay` | duration | no | `15s` | Cap on any single delay. |
| `retry.backoff` | string | no | | Accepted but ignored. Backoff is always exponential: the delay doubles after each failed attempt. |

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
| `external_id` | expression | **yes** | Stable id for the entity. Becomes `entities.id`. Records where it resolves to nothing or `""` are skipped. |
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

Entity ids are not namespaced by source. If two sources emit the same id, they write to the same entity row.

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
| `altitude` | expression | no | `0` | Stored as-is. The frontend treats it as metres above the ellipsoid. |
| `speed` | expression | no | `0` | Stored on observations only. |
| `heading` | expression | no | `0` | Stored on observations only. The globe computes marker rotation from the entity's trail, not from this field. |
| `timestamp` | expression | no | ingest time | Source time of the sample. |

Latitude and longitude are converted with `parseFloat`. If either is missing or not a finite number, the record is skipped and counted in the warning `skipped N record(s) with missing id/coordinates`. It is never plotted at (0, 0). Unparseable altitude, speed or heading values become `0`.

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
| `append` (default) | One per distinct instant, capped at the newest 200 per entity (`MAX_OBS_PER_ENTITY`). | `obs_<id>_<epoch_ms>` when the source provides a timestamp; otherwise `obs_<id>_<lat>_<lon>` with 4-decimal coordinates. | Moving tracks: aircraft, ships, the ISS. |
| `upsert` | Exactly one per entity, overwritten on every poll. | `obs_<id>` | Current-state or reference data: earthquakes, sensors, facilities. |

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
    backoff: exponential # ignored; backoff is always exponential
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
  "id": "ci40669442",
  "source_id": "usgs_earthquakes",
  "category": "geological",
  "name": "3 km NNW of Murrieta, CA",
  "latitude": 33.5795,
  "longitude": -117.2311666666667,
  "altitude": 15.07,
  "timestamp": "2026-08-09T17:38:15.660Z",
  "metadata": { "magnitude": 1.61, "depth": 15.07 }
}
```

and one observation with id `obs_ci40669442`, which is overwritten on later polls because the mode is `upsert`.

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

Check the skill's output against this page before relying on it. Its reference template is written for a richer "schema v2" format that this engine does not implement:

- Mapping values written as CEL expressions (`record.id`, `has(...)`, `double(...)`, `unix_ms(...)`) are treated as plain paths and will not resolve. Write bare paths instead, such as `id`, `properties.place` or `geometry.coordinates[1]`.
- A `filter` written as a CEL string is ignored, because the engine expects a list of `{ field, in, not_empty }` rules.
- `labels`, `max_response_bytes`, `observation.velocity`, `observation.metadata`, `content_hash`, `cache`, `display` and `history` are ignored.
- The skill writes to a hard-coded absolute path from the original author's machine. Tell your agent to write to `sources.d/` in your checkout.

A quick way to steer it: *"Use skills/onboard-source to add `<URL>`, but follow the schema in docs/data-sources.md and the examples in skills/onboard-source/examples/."*

After adding a file, restart the backend and watch its log for `Skipping invalid source definition`, `non-canonical entity.category`, `Error polling source` or `skipped N record(s)`. Then check `GET /api/entities?source_id=<name>`.

### The 19 examples

[`skills/onboard-source/examples/`](../skills/onboard-source/examples/) holds 19 no-auth source definitions. All of them use `schema_version: 1` and the path syntax described above, so they are compatible with this engine without edits. To enable one, copy it into `sources.d/` and restart the backend. Four of them share a `name` with a file already in `sources.d/`: `adsb_military`, `iss_position`, `safecast_radiation` and `usgs_earthquakes`. Replace the existing file rather than keeping both: two files with the same `name` would both be polled but share one `sources` row and one `source_id`.

| File | Category | Format | Feed |
| :-- | :-- | :-- | :-- |
| `adsb_military.yaml` | aircraft | json | api.adsb.lol military |
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

Several examples map a non-matching feed onto the closest canonical category so it gets a marker. For instance, military bases and airports use `aircraft`, and power plants use `radiation`. Some examples also differ from the tuned copies in `sources.d/`. The example `adsb_military.yaml`, for instance, still points at `api.adsb.lol/v2/mil`, which the `sources.d/` version replaced because it was returning an empty list.
