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
| `lookups` | map | no | | Named tables for the `lookup()` expression helper. See [lookups](#lookups). |

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
| `propagate_interval` | duration | no | | Orbital formats only (`tle`, `omm_json`). Re-propagates the cached element sets to the current time this often, without refetching. `interval` still controls how often fresh elements are downloaded. |

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
| `"7d"` | 7 days. |
| `"1500ms"` | Rounded to whole seconds, with a minimum of 1 second. |
| `45` (a YAML number) | 45 seconds. |

Units are case-insensitive and decimals are allowed (`"1.5m"`). The result is always whole seconds. An unparseable, zero or negative value silently falls back to the field's default.

### `parser`

| Field | Type | Required | Default | Meaning |
| :-- | :-- | :-- | :-- | :-- |
| `format` | `json` \| `geojson` \| `xml` \| `csv` \| `rss` \| `tle` \| `omm_json` | **yes** | | Response format. Any other value makes the file invalid. |
| `records_path` | string | no | root (`features` for `geojson`) | Dot-notation path to the array of records, for example `ac`, `results.bindings` or `rss.channel.item`. Ignored by `rss` and `tle`. |
| `max_records` | number | no | unlimited | Keep only the first N records per poll (for `tle`/`omm_json`: element sets). |
| `csv` | map | no | | CSV options, see below. |
| `object_to_records` | boolean | no | `false` | `json`: the value at `records_path` is an object map (`{"KJFK": {...}, "EGLL": {...}}`); each entry becomes a record and the key is stored in `key_field`. Non-object values become `{<key_field>: key, value: v}`. |
| `key_field` | string | no | `_key` | Field that receives the map key with `object_to_records`. |
| `array_columns` | list of string \| `header` | no | | `json`: rows that are arrays become objects with these keys (for example OpenSky `states`). `header` uses the first row as the column names. Columns beyond the list are named `c<index>`. |

`parser.csv` options (without the block, CSV keeps its default: header row, auto-detected delimiter):

| Field | Type | Default | Meaning |
| :-- | :-- | :-- | :-- |
| `delimiter` | string | auto | A literal delimiter (`,`, `;`, `\|`, `'\t'`), or `whitespace` to split on runs of spaces and tabs (space-aligned text tables). |
| `has_header` | boolean | `true` | `false`: the first row is data; columns are named from `columns`, else `c0`, `c1`, ... |
| `columns` | list of string | | Column names. Also override an existing header row. Extra columns fall back to `c<index>`. |
| `skip_lines` | integer | `0` | Leading lines to drop (banners, preambles) before the header. |
| `comment_prefix` | string | | Lines whose first non-blank characters are this prefix (for example `#`) are ignored. |

Line-based options (`skip_lines`, `comment_prefix`) work on physical lines, so do not combine them with quoted fields that span lines.

How each format produces records:

- **json**: the value at `records_path`, or the whole document if it is omitted or `""`. An array is used as-is. A single object becomes one record, which suits endpoints like the ISS position API. Anything else yields no records.
- **geojson**: as `json`, but `records_path` defaults to `features`. Each record is a GeoJSON Feature, so paths look like `geometry.coordinates[1]` and `properties.mag`.
- **xml**: parsed with `fast-xml-parser` with attributes kept. Attributes appear as keys prefixed with `@_` (for example `@_id`). A repeated element that occurs only once is wrapped into a one-element array.
- **csv**: the first row is the header, and each following row becomes an object keyed by column name. Empty lines are skipped. All values are strings; the mapper converts coordinates and numbers. See `parser.csv` above for header-less, whitespace-delimited and commented files.
- **rss**: RSS 2.0, RSS 1.0 (RDF) and Atom. Every item is normalized to `{title, link, description, published, guid, categories, author, lat, lon}`. `published` is ISO 8601 when the date parses (`pubDate`, `published`, `dc:date` or `updated`). `guid` falls back to the Atom `id`, then the link, then the title. `lat`/`lon` come from `georss:point`, `georss:where/gml:Point/gml:pos` or `geo:lat`/`geo:long`, and are `null` otherwise, so most news feeds need `observation.optional: true`. No geocoding is done.
- **tle**: plain-text two-line element sets, in 3-line (name, line 1, line 2; a `0 ` name prefix is stripped) or 2-line form (named `NORAD <id>`). Each set becomes `{name, norad_id, intl_designator, epoch, inclination, eccentricity, mean_motion, period_min, line1, line2}`.
- **omm_json**: CelesTrak GP JSON (OMM keywords such as `OBJECT_NAME`, `NORAD_CAT_ID`, `EPOCH`, `MEAN_MOTION`). Each record keeps its OMM fields and gains the same fields as `tle`. Records missing mandatory elements are dropped.

For `tle` and `omm_json` the scheduler propagates every element set with SGP4 (`satellite.js`) to the current time on each poll, and on every `transport.propagate_interval` tick. Each record then also carries `lat`, `lon` (degrees), `alt` (metres above the ellipsoid), `speed` (inertial speed, m/s), `heading` (ground-track bearing, degrees from north) and `timestamp` (the propagation instant). Map them like any other field; use `recording.mode: upsert` for a current-position layer:

```yaml
transport: { type: http_poll, url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json', interval: 6h, propagate_interval: 10s }
parser: { format: omm_json, max_records: 500 }
entity: { external_id: norad_id, name: name, metadata: { epoch: epoch, object_id: intl_designator } }
observation: { latitude: lat, longitude: lon, altitude: alt, speed: speed, heading: heading, timestamp: timestamp }
recording: { mode: upsert }
```

`records_path` supports dots only. Bracket indices such as `data[0]` are not supported there, unlike mapping paths.

### `filter`

An optional list of rules. A record must pass **every** rule to be mapped. Records that fail are counted and logged as `excluded by filter rules`, separately from malformed records.

| Field | Type | Meaning |
| :-- | :-- | :-- |
| `field` | path | Path into the raw record (same syntax as mapping paths). |
| `in` | list of string or number | The value, trimmed and compared as a string, must equal one of these. A missing or blank value fails. |
| `not_empty` | boolean | When `true`, the value must be present and not blank. |
| `expr` | expression | The [expression](#expression-language) must be truthy, for example `mag >= 2.5`. A leading `=` is optional here. |

A rule with both `in` and `not_empty` applies both checks. A rule needs `field` or `expr` (or both); a rule with neither makes the file invalid.

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
| `optional` | boolean | no | `false` | For partly geo-tagged feeds (RSS). Records whose coordinates do not resolve are dropped silently: counted as `unlocated` in the poll stats, not warned about. |

Latitude and longitude are converted with `parseFloat`. If either is missing or not a finite number, the record is skipped and counted in the warning `skipped N record(s) with missing id/coordinates` (unless `optional: true`). It is never plotted at (0, 0). Unparseable altitude, speed or heading values become `0`.

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

Mapping values (`external_id`, `name`, `metadata.*`, `observation.*`, `filter[].field`, `derived.*.from` and template placeholders) are **paths** into the raw record, unless the value starts with `=`, which makes it an [expression](#expression-language) (`external_id`, `name`, `metadata.*` and `observation.*` only).

| Syntax | Example | Resolves to |
| :-- | :-- | :-- |
| key | `hex` | `record.hex` |
| dotted key | `properties.place` | `record.properties.place` |
| array index | `geometry.coordinates[1]` | `record.geometry.coordinates[1]` |
| index on an array record | `[0]` or `0` | element 0 when the record itself is an array (for example OpenSky `states`) |
| numeric literal | `'0'`, `'100'` | the number itself, **only if** no field by that name exists |

For `external_id`, `name`, `metadata.*` and `observation.*`, the engine tries the value as a path first. If that finds nothing and the value is numeric, it becomes a literal number. This is how `altitude: '0'` produces a constant 0. When the record is an array, `'0'` resolves to its first element rather than a literal. Filter fields, `derived.*.from` and template placeholders are always paths.

Keys that contain dots cannot be addressed by a path; use an expression such as `=$['georss:point']`.

#### Expression language

A mapping value that starts with `=` is an **expression** instead of a path. This works for `external_id`, `name`, `metadata.*`, every `observation.*` field and `recording.dedupe_fields`, and `filter[].expr` is always an expression. Values without `=` keep working as paths.

```yaml
entity:
  name: '=trim(callsign) ?? hex'
  metadata:
    model: "=lookup('aircraft_types', t, 'unknown')"
observation:
  altitude: "=alt_baro == 'ground' ? 0 : alt_baro * 0.3048"
  timestamp: '=unix_ms(seen)'
filter:
  - expr: 'mag >= 2.5'
```

The evaluator is a small hand-written parser in `backend/src/engine/expressions.ts`. It never uses `eval` or `Function`, and identifiers read only the record's own properties, so prototypes and globals are unreachable. Syntax errors make the file invalid at load time. Errors at run time leave the field unresolved.

| Syntax | Meaning |
| :-- | :-- |
| `a`, `a.b`, `a[0]`, `a['x-y']`, `$` | Field access; `$` is the whole record. A missing field is `undefined`. |
| `1.5`, `'text'`, `"text"`, `true`, `false`, `null` | Literals. |
| `+ - * / %` | Arithmetic. Numeric strings count as numbers (`'5' + 1` is 6); otherwise `+` concatenates. A non-finite result (`1 / 0`, `'x' * 2`) is `null`. |
| `== != < <= > >=` | Comparison. Numeric strings compare as numbers. Comparisons with a missing value are false. `=== !==` are strict. |
| `&& \|\| !` or `and or not` | Logic (short-circuit). |
| `a ?? b` | `b` when `a` is null, undefined or NaN. |
| `c ? a : b` | Conditional. |

Helpers:

| Helper | Returns |
| :-- | :-- |
| `now()` | Current epoch milliseconds. |
| `unix_ms(x)`, `unix_s(x)` | Epoch milliseconds / seconds from epoch seconds, epoch milliseconds (values above 1e11) or a date string. |
| `parse_date(x)` | ISO 8601 string, or `null`. |
| `number(x)`, `string(x)` | Conversions (`number` gives `null` for non-numeric text). |
| `lower(x)`, `upper(x)`, `trim(x)`, `concat(a, b, ...)` | String helpers. `concat` treats missing values as `''`. |
| `coalesce(a, b, ...)` | First value that is not null or blank. |
| `round(x, digits?)`, `floor(x)`, `ceil(x)`, `abs(x)`, `min(...)`, `max(...)` | Math. |
| `contains(haystack, needle)` | Case-insensitive substring test, or membership for a list. |
| `lookup(table, key, default?)` | Value from a `lookups:` table. |

#### `lookups`

Top-level map of named tables for `lookup()`. Each entry is an inline map or a path, relative to the sources directory (it may not point outside it), to a `.json` object or a `.csv` file with a header row. For CSV the first column is the key. With exactly two columns the second column is the value; with more, the value is the whole row, so `lookup('t', k).label` works. A missing or unreadable file skips the source with an error.

```yaml
lookups:
  countries: { US: United States, FR: France }
  aircraft_types: lookups/aircraft_types.csv
```

### Recording modes

`recording.mode` controls how observations are stored. The entity row is always upserted by id, holding the latest position.

| Mode | Observation rows | Observation id | Use for |
| :-- | :-- | :-- | :-- |
| `append` (default) | One per distinct instant, capped at the newest 200 per entity (`MAX_OBS_PER_ENTITY`). | `obs_<entity id>_<epoch_ms>` when the source provides a timestamp; otherwise `obs_<entity id>_<lat>_<lon>` with 4-decimal coordinates. | Moving tracks: aircraft, ships, the ISS. |
| `upsert` | Exactly one per entity, overwritten on every poll. | `obs_<entity id>` | Current-state or reference data: earthquakes, sensors, facilities. |
| `dedupe` | One per distinct content, capped like `append`. A record whose hash is already stored is skipped entirely (the entity is not touched or re-broadcast). New content at an instant already stored replaces that row. | `obs_<entity id>_<sha256>` | News, alerts, bulletins: anything re-served unchanged on every poll. |

`dedupe` identity: the sha256 of the values of `recording.dedupe_fields` (paths or `=expr`, read from the raw record), or, without that list, of the whole mapped entity (id, name, category, position, metadata, and the timestamp when the source provides one).

`recording.max_age` (a duration such as `30m` or `7d`) applies to every mode: records whose source timestamp is older than now minus `max_age` are dropped and counted as `stale`. Records without a source timestamp are never stale.

```yaml
recording:
  mode: dedupe
  dedupe_fields: [guid, title]
  max_age: 7d
```

The scheduler keeps per-source counters for the last poll in `IngestionScheduler.lastStats`: `written`, `skipped`, `filtered`, `unlocated`, `duplicates` and `stale`.

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
