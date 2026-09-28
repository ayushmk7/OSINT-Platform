# Data sources

Every feed on the globe is described by one YAML file in `sources.d/`. The engine discovers the files at startup, polls each feed on its own interval, and maps each record onto an entity (a point on the globe) and an observation (a timestamped sample of that point). Adding a feed means adding a file; no TypeScript changes are needed.

This page documents the schema as implemented in `backend/src/engine/yaml-loader.ts` (the `SourceConfig` type), `backend/src/engine/field-mapper.ts` and `backend/src/engine/scheduler.ts`. Anything not listed here is ignored by the engine.

## Loading rules

- The directory is `SOURCES_DIR`, defaulting to `sources.d/` at the repository root.
- Every `*.yaml` and `*.yml` file is read, in alphabetical order. Other files are ignored.
- Files are read once, at startup. Restart the backend to pick up changes.
- Each file is checked by `validateSourceConfig()`. It must contain these fields as non-empty strings: `name`, `source_type`, `transport.type`, `transport.url`, `parser.format`, `entity.external_id`, `observation.latitude`, `observation.longitude`. It is also rejected if `schema_version` is present and not `1`, if `transport.retry.backoff` is not one of `exponential`, `linear` or `fixed`, or if `observation.scale` is malformed (see [`observation`](#observation)).
- A file that fails validation is skipped with the error `Skipping invalid source definition <path>: <problems>`, which lists every problem found, separated by `;`.
- A file whose `transport` references an environment variable (`${NAME}`, no default) that is unset or empty is skipped with the warning `source <name> disabled: missing env <NAME>`. It is not registered or polled. See [Secrets and environment variables](#secrets-and-environment-variables).
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
| `type` | string | **yes** | | Stored in `sources.transport`. `websocket` and `sse` open a long-lived stream (see [Streaming transports](#streaming-transports)); any other value (use `http_poll`) polls over HTTP. |
| `url` | string | **yes** | | Endpoint to fetch (`ws://` / `wss://` for `websocket`). May contain `${NAME}` placeholders. |
| `method` | string | no | `GET`, or `POST` when `body` is set | HTTP method. |
| `body` | string or mapping | no | | Request body. A string is sent verbatim; a mapping is sent as JSON (or as a form when `content_type` is `application/x-www-form-urlencoded`). |
| `content_type` | string | no | `application/json` for a mapping body | `Content-Type` of the body, unless `headers` already sets one. |
| `auth` | mapping | no | | Credentials. See [Authentication](#authentication). |
| `max_response_bytes` | integer | no | `52428800` (50 MB) | The response is aborted, without retrying, once it grows past this. |
| `pagination` | mapping | no | | Fetch several pages per poll. See [Pagination](#pagination). |
| `subscribe` | string or mapping | no | | `websocket` only: message sent after every (re)connect; a mapping is JSON-encoded. |
| `batch_window` | duration | no | `2s` | `websocket` / `sse` only: how long messages are buffered before being ingested as one batch. Sub-second values such as `500ms` are honoured. |
| `headers` | map of string | no | | Extra request headers; values may contain `${NAME}` placeholders. `User-Agent: MK-OSINT/1.0` is sent by default and can be overridden here. |
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

### Secrets and environment variables

Source files never hold secrets. They reference environment variables instead, resolved from `process.env` (and `backend/.env`) each time a request is made:

| Placeholder | Resolves to |
| :-- | :-- |
| `${NAME}` | The value of `NAME`. If `NAME` is unset or empty, the whole source is skipped at load with `source <name> disabled: missing env NAME`. |
| `${NAME:-default}` | The value of `NAME`, or `default` when it is unset or empty. Never disables the source. |

Placeholders work in `transport.url`, `transport.headers` values, `transport.body` (any string inside it), every `transport.auth` field and `transport.subscribe`. The stored `sources.url` and the API keep the unresolved placeholder text, and every resolved value (plus derived credentials such as OAuth2 tokens and Basic headers) is replaced by `***` in logged errors. Keyed sources therefore ship enabled but inert until their key is added to `backend/.env`; list every key a source needs in `backend/.env.example`.

### Authentication

`transport.auth` adds credentials to every request (and to the websocket upgrade / SSE request):

```yaml
auth: { type: bearer, token: '${EXAMPLE_TOKEN}' }                       # Authorization: Bearer <token>
auth: { type: api_key, in: header, name: X-Api-Key, value: '${KEY}' }  # header (default)
auth: { type: api_key, in: query, name: apikey, value: '${KEY}' }      # ?apikey=<value>
auth: { type: basic, username: '${USER}', password: '${PASS}' }        # Authorization: Basic ...
auth:
  type: oauth2_client_credentials
  token_url: https://auth.example.com/oauth/token
  client_id: '${EXAMPLE_CLIENT_ID}'
  client_secret: '${EXAMPLE_CLIENT_SECRET}'
  scope: read            # optional
  client_auth: post      # optional: post (credentials in the form body, default) or basic
```

`api_key` also accepts the shorthands `header: X-Api-Key` or `query: apikey` in place of `in` + `name`. For `oauth2_client_credentials` the engine POSTs `grant_type=client_credentials` to `token_url` and caches the `access_token` in memory until 30 seconds before `expires_in` (one hour if the server omits it); the token is then sent as `Authorization: Bearer`. A failed token request is reported with its HTTP status only.

### Pagination

`transport.pagination` makes one poll fetch several pages. Each page is parsed with the source's `parser` settings, and the records of all pages are concatenated before filtering and mapping (`parser.max_records` caps each page and the total).

| Field | Applies to | Default | Meaning |
| :-- | :-- | :-- | :-- |
| `type` | all | | `page`, `offset` or `cursor`. |
| `param` | all | | Query parameter carrying the page number, offset or cursor. |
| `start` | page, offset | `1` / `0` | First page number / first offset. |
| `size_param` | page, offset | | Query parameter carrying the page size, sent when `size` is also set. |
| `size` | page, offset | | Page size. Required for `offset` (the offset advances by it). A page with fewer than `size` records ends the walk. |
| `cursor_path` | cursor | | Dot path into the parsed JSON response to the next cursor. The first request has no cursor; the walk ends when the value is missing, empty, `null`, `false` or repeats. |
| `max_pages` | all | `10` | Hard cap on requests per poll. |
| `stop_when_empty` | all | `true` | Stop at the first page that yields no records. |

```yaml
pagination: { type: page, param: page, start: 1, size_param: per_page, size: 100 }
pagination: { type: offset, param: offset, size_param: limit, size: 500, max_pages: 20 }
pagination: { type: cursor, param: cursor, cursor_path: meta.next_cursor }
```

Pagination is not supported on streaming transports.

### Streaming transports

`transport.type: websocket` and `transport.type: sse` hold one connection open instead of polling (`interval` is ignored):

- **websocket** connects to `url` (auth headers are sent on the upgrade request; `api_key` in `query` goes into the URL), sends `subscribe` after every connect, and treats each text or binary frame as one message.
- **sse** issues a streaming GET (or POST when `body` is set) with `Accept: text/event-stream`, and treats the joined `data:` lines of each event as one message. The last `id:` is sent back as `Last-Event-ID` on reconnect.

Each message is parsed on its own with the source's `parser` (so `records_path` applies per message; a message may yield zero, one or many records). An unparseable message is logged and skipped. Records are buffered and, every `batch_window` (default `2s`), ingested as one batch through the same filter, map and persist path as a poll, so `recording.mode` and broadcasting behave the same. When the connection closes or fails, the engine reconnects after `retryDelayMs()` using `transport.retry` (`initial_delay` default 1s, `max_delay` default **60s** for streams, `backoff` default exponential); the attempt counter resets once a connection opens. `retry.max_attempts` is not used: streams retry forever until the backend stops.

```yaml
transport:
  type: websocket
  url: wss://stream.example.com/v1
  subscribe: { action: subscribe, api_key: '${EXAMPLE_STREAM_KEY}', channels: [positions] }
  batch_window: 2s
  retry: { initial_delay: 1s, max_delay: 30s }
parser:
  format: json
  records_path: payload
```

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
