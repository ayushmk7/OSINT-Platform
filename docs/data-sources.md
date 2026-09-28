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
| `category` | string (literal) | no | Any lowercase snake_case id. If absent, the source's `layer.id` is used (which itself defaults to `layer_type`). |
| `metadata` | map of key to expression | no | Values copied from the record into `entities.metadata`. Keys that resolve to nothing are dropped. |
| `derived` | map of key to derived field | no | Computed metadata. See below. A derived key overrides a `metadata` key with the same name. |

`category` is a literal string, not a path. It is an open set: any lowercase snake_case id is valid. These six legacy categories (`ENTITY_CATEGORIES`) have hand-drawn frontend styles, used when a source has no `display:` block:

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

### `layer` and `display`

Both blocks are optional. They tell the frontend which legend layer a source feeds and how its entities look, so a new feed needs no frontend change. The backend applies defaults and serves the result on `GET /api/sources` and in the WS `initial_state` frame. A block that is present but malformed rejects the whole file with a clear error, for example `Skipping invalid source definition …: invalid layer.group "Nope" (expected one of: …)`. The one exception is an unknown `display.icon`: that logs a warning and falls back to `dot`.

```yaml
layer:
  id: geological              # legend layer key, lowercase snake_case
  name: Earthquakes           # legend label
  group: Hazards              # legend group
  description: USGS, past hour

display:
  icon: quake                 # icon registry key
  color: '#ff0055'            # base colour, hex
  color_by:                   # optional; exactly one of `stops` or `map`
    field: metadata.magnitude # path into the entity: metadata.*, altitude, speed, heading
    stops: [[0, '#ffd166'], [3, '#ff9e00'], [5, '#ff3b3b'], [7, '#ff0055']]
    # map: { high: '#ff0000', low: '#00ff00' }
    # default: '#888888'
  size: 1.0                   # marker scale multiplier
  rotate: false               # rotate the icon to heading
  trail: { enabled: false, max_points: 20 }
  ttl: '24h'                  # hide + prune entities not updated within this long
  fields:                     # entity card rows, in order
    - { path: metadata.magnitude, label: Magnitude, format: number, precision: 1 }
    - { path: metadata.url, label: Details, format: link }
```

| Field | Default | Rules |
| :-- | :-- | :-- |
| `layer.id` | `layer_type` in snake_case | `^[a-z][a-z0-9_]*$`. Also the default `entity.category`. Several sources may share one layer id; the legend merges them into one row. |
| `layer.name` | `display_name` | String. |
| `layer.group` | `Other` | One of `Aviation`, `Maritime`, `Space`, `Hazards`, `Weather`, `Environment`, `Conflict`, `Infrastructure`, `Cyber`, `News`, `Other`. |
| `layer.description` | `""` | String, shown under the name in the legend. |
| `display.icon` | `dot` | Icon key (list below). Unknown key: warning, then `dot`. |
| `display.color` | `#9ca3af` | Hex colour (`#rgb`, `#rrggbb`, with or without alpha). |
| `display.color_by.field` | | Required inside `color_by`. |
| `display.color_by.stops` | | `[number, colour]` pairs in strictly ascending order. Colours are interpolated linearly between stops and clamped outside them. |
| `display.color_by.map` | | Exact match on the stringified value. |
| `display.color_by.default` | `display.color` | Used when the value is missing or unmatched. |
| `display.size` | `1` | Number in (0, 10]. |
| `display.rotate` | `false` | Rotates the marker to the reported heading, else to the bearing between the last two positions. Use it with nose-first icons (`plane`, `helicopter`, `ship`, `rocket`). |
| `display.trail` | `{ enabled: false, max_points: 20 }` | `max_points` is an integer in [1, 1000]. |
| `display.ttl` | none (never expires) | `"90s"`, `"15m"`, `"24h"`, `"7d"` or a bare number of seconds. Compared against the entity `timestamp` (the source's own time when mapped, else ingest time). |
| `display.fields[]` | `[]` | `path` required; `label` defaults to the path; `format` is `text` (default), `number` (`precision` 0 to 10), `datetime` (relative time plus UTC; ISO or epoch s/ms), `link` (http(s) only, opens in a new tab with `rel="noopener noreferrer"`) or `bool`. Optional `prefix` / `suffix`. |

Icon keys: `dot`, `plane`, `helicopter`, `ship`, `satellite`, `rocket`, `iss`, `quake`, `volcano`, `fire`, `storm`, `lightning`, `flood`, `tsunami`, `radiation`, `nuclear`, `biohazard`, `factory`, `power`, `cable`, `tower`, `antenna`, `port`, `airport`, `military`, `conflict`, `explosion`, `alert`, `news`, `shield`, `bug`, `buoy`, `balloon`, `camera`, `pin`.

The resolved `display` also carries `declared` (false when the YAML had no `display:` block) and `ttl_seconds`. A source without a declared `display` is drawn with the legacy style of its category (the table under [`entity`](#entity)). `atc_zone` entities additionally get a ground circle sized from `metadata.radius_km`, and the inspector shows a "Listen to ATC (LiveATC.net)" link when `metadata.liveatc_url` is set.

TTL is enforced twice: the backend's retention job deletes expired entities and their observations every 60 seconds and broadcasts `entity_remove`, and the frontend hides and drops expired entities on its own every 15 seconds.

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

| File | Display name | Layer (group) | Icon | TTL | Feed | Interval | Mode |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `adsb_military.yaml` | Military Flights ADSB | `aircraft` (Aviation) | `plane`, rotated, coloured by altitude | 5m | `https://opendata.adsb.fi/api/v2/mil` (JSON, `ac`) | 30s | append |
| `atc_facilities.yaml` | ATC Facilities (OurAirports) | `atc_zone` (Aviation) | `tower` | none | `https://davidmegginson.github.io/ourairports-data/airports.csv` (CSV, filtered to large and medium airports that have an ICAO code) | 24h | upsert |
| `iss_position.yaml` | ISS Position Tracker | `satellite` (Space) | `iss` | none | `https://api.wheretheiss.at/v1/satellites/25544` (JSON, single object) | 30s | append |
| `safecast_radiation.yaml` | Safecast Radiation Monitoring | `radiation` (Environment) | `radiation`, coloured by CPM | none (the feed serves historical readings) | `https://api.safecast.org/measurements.json?limit=100` (JSON array) | 300s | upsert |
| `usgs_earthquakes.yaml` | USGS Earthquakes | `geological` (Hazards) | `quake`, coloured by magnitude | 24h | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson` (GeoJSON) | 60s | upsert |

Each shipped layer id equals its legacy category, so `entity.category` is left to default to it.

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
