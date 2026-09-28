---
name: onboard-source
description: "Analyze an HTTP endpoint (JSON, GeoJSON, XML, CSV) and generate a valid declarative YAML source configuration for sources.d/"
---

# Onboard Source Skill (`onboard-source`)

This skill takes an HTTP endpoint URL, inspects its response, and writes a source definition to `sources.d/<source_name>.yaml` (relative to the repository root) that the engine in `backend/src/engine/` can load and poll.

The engine implements one schema, `schema_version: 1`. A file with any other `schema_version` is rejected; omitting the key means `1`. Everything it reads is described below. It has no expression language, no display/style block, no cache and no history settings. Unknown keys are silently ignored, so writing them has no effect. The full reference is `docs/data-sources.md`; the source of truth is `backend/src/engine/yaml-loader.ts` (the `SourceConfig` type) and `backend/src/engine/field-mapper.ts`.

Working examples for 19 public feeds are in `skills/onboard-source/examples/`. Start from the one closest to the new feed.

---

## Step 1: Fetch a sample response

```bash
curl -s -H "Accept: application/json" "<TARGET_URL>" | head -c 4000
```

- Note the `Content-Type` and whether the body is an array, an object wrapping an array, a GeoJSON `FeatureCollection`, XML or CSV.
- The engine sends no request body and supports no auth flow beyond static `headers`. If the feed needs a key, put it in `transport.headers` or the URL query string, and tell the user it will be stored in plain text.
- Check that the feed returns records right now. A 200 response with an empty list is useless (the `api.adsb.lol/v2/mil` endpoint did exactly that).

## Step 2: Pick the parser

| Body | `parser.format` | `parser.records_path` |
| :-- | :-- | :-- |
| Top-level JSON array | `json` | omit |
| JSON object holding the array, e.g. `{"ac": [...]}` | `json` | `ac` (dot path, e.g. `results.bindings`) |
| Single JSON object that is itself one record (e.g. the ISS API) | `json` | omit; the object becomes one record |
| GeoJSON `FeatureCollection` | `geojson` | omit (defaults to `features`) |
| XML / RSS | `xml` | path to the repeated element, e.g. `rss.channel.item` |
| CSV with a header row | `csv` | omit; each row becomes an object keyed by column name, all values strings |

- `records_path` accepts dots only, not bracket indices.
- XML attributes appear as keys prefixed with `@_` (for example `@_id`).
- `parser.max_records` keeps only the first N records per poll.
- Any other `format` value makes every poll fail with `Unsupported parser format`.

## Step 3: Map the fields

Every mapping value is a **path** into one raw record. It is not CEL, JSONPath or JavaScript: do not write `record.x`, `has(...)`, `double(...)`, `x * 1000`, ternaries or string functions. They will not resolve.

| Path syntax | Example | Resolves to |
| :-- | :-- | :-- |
| key | `hex` | `record.hex` |
| dotted key | `properties.place` | `record.properties.place` |
| array index | `geometry.coordinates[1]` | second element of `coordinates` |
| index on an array record | `[0]` | first element when each record is an array (OpenSky `states`) |
| numeric literal | `'0'` | the number 0, but only if no field of that name exists |

Keys that contain dots cannot be addressed. There is no arithmetic in paths; convert units with `observation.scale` instead (see below).

Map these fields:

1. **`entity.external_id`** (required): a stable unique id. Records where it is missing or `""` are skipped. The engine stores it as `<name>:<external_id>`, so it only needs to be unique within this feed.
2. **`entity.name`**: display name; falls back to the id.
3. **`entity.category`**: a literal string, one of `satellite`, `aircraft`, `geological`, `radiation`, `maritime`, `atc_zone`. This alone picks the marker shape and colour on the globe. Any other value still loads but logs a warning and renders as a grey dot. If the feed does not fit, use the closest category.
4. **`entity.metadata`**: map of output key to path. Values are copied into the entity; missing ones are dropped.
5. **`observation.latitude`** / **`observation.longitude`** (required): decimal degrees. Records without finite coordinates are skipped, never plotted at (0, 0). In GeoJSON, `coordinates` is `[lon, lat, alt]`.
6. **`observation.altitude`**, **`speed`**, **`heading`**: optional, default 0. Altitude is stored in metres. If the feed uses another unit, add `observation.scale`.
7. **`observation.timestamp`**: optional. Epoch seconds, epoch milliseconds (values over 1e11) or any `Date.parse`-able string. Omit it when the feed has no per-record time; ingest time is used. Never map it to a literal such as `"now"`.
8. **`observation.scale`**: optional map of field to multiplier. Keys must be among `latitude`, `longitude`, `altitude`, `speed`, `heading`; each value must be a finite number, or the file is rejected. The resolved value is multiplied before it is stored; a negative factor flips the sign. Metadata is never scaled, so keep the raw value in `entity.metadata` if it is worth showing.

   ```yaml
   observation:
     altitude: 'alt_baro'
     scale:
       altitude: 0.3048 # feet -> metres (km feeds: 1000; km depth positive-down: -1000)
   ```

Optional record filtering is a **list of rules**, all of which must pass:

```yaml
filter:
  - field: 'type'
    in: ['large_airport', 'medium_airport'] # value (as a string) must be one of these
  - field: 'icao_code'
    not_empty: true # value must be present and not blank
```

Optional computed metadata goes under `entity.derived`. Each entry is one of:

```yaml
entity:
  derived:
    radius_km: # lookup map on the value at `from`
      from: 'type'
      map: { large_airport: 9, medium_airport: 5 }
      default: 5
    liveatc_url: # template with {path}, {path|lower} or {path|upper}
      template: 'https://www.liveatc.net/search/?icao={icao_code|lower}'
    country: # plain copy of `from`, with an optional default
      from: 'iso_country'
      default: 'unknown'
```

A template with any unresolved placeholder is dropped (or replaced by `default`). A derived key overrides a `metadata` key of the same name. For `atc_zone` entities the frontend reads `metadata.radius_km` (ground circle size, default 5 km) and `metadata.liveatc_url`.

## Step 4: Choose transport and recording settings

- `transport.type: http_poll` (the only transport the engine implements).
- `transport.interval`: poll period, default `60s`. Match the feed's update rate; use hours or days for static reference data.
- `transport.timeout`: per-attempt timeout, default `10s`.
- `transport.retry`: `max_attempts` (default 3, including the first try), `initial_delay` (default `1s`), `max_delay` (default `15s`, caps every delay) and `backoff`: `exponential` (default, `initial_delay × 2^(n-1)`), `linear` (`initial_delay × n`) or `fixed` (`initial_delay`). Any other `backoff` value makes the file invalid.
- Durations are `"30s"`, `"5m"`, `"24h"`, `"1500ms"` or a bare number of seconds. Unparseable values fall back to the default silently.
- `recording.mode`:
  - `append` (default): keeps a track, up to 200 observations per entity. Use for moving things (aircraft, ships, the ISS).
  - `upsert`: one observation per entity, overwritten each poll. Use for current-state or reference data (quakes, sensors, facilities).

## Step 5: Write the file

Write `sources.d/<name>.yaml` in the repository root. The file name should match `name`, and `name` must be unique across `sources.d/`. Use this template, deleting what does not apply:

```yaml
schema_version: 1

name: usgs_earthquakes # unique source id; source_id on every entity
source_type: usgs_earthquakes # required
layer_type: earthquakes # fallback category if entity.category is absent
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
  records_path: 'features'
  max_records: 1000

entity:
  external_id: 'id'
  name: 'properties.place'
  category: 'geological'
  metadata:
    magnitude: 'properties.mag'
    depth: 'geometry.coordinates[2]'

observation:
  latitude: 'geometry.coordinates[1]'
  longitude: 'geometry.coordinates[0]'
  altitude: 'geometry.coordinates[2]'
  speed: '0'
  heading: '0'
  timestamp: 'properties.time' # epoch milliseconds
  scale:
    altitude: -1000 # depth in km, positive-down -> metres below the surface

recording:
  mode: upsert
```

Do not add `labels`, `display`, `cache`, `history`, `max_response_bytes`, `observation.velocity`, `observation.metadata` or `content_hash`. The engine does not implement them.

## Step 6: Validate

1. Check the file loads. The loader skips a file, logging `Skipping invalid source definition <path>: <problems>`, unless `name`, `source_type`, `transport.type`, `transport.url`, `parser.format`, `entity.external_id`, `observation.latitude` and `observation.longitude` are all non-empty strings, `schema_version` is absent or `1`, `transport.retry.backoff` (if set) is `exponential`, `linear` or `fixed`, and `observation.scale` (if set) maps only scalable fields to finite numbers. `validateSourceConfig()` in the same module returns the list of problems for one parsed file:

   ```bash
   cd backend && npx tsx -e "
   const { loadSourcesFromDir } = require('./src/engine/yaml-loader');
   const c = loadSourcesFromDir('../sources.d');
   console.log(c.map(s => s.name));"
   ```

   The new `name` must be in the list, with no `non-canonical entity.category` warning.

2. Check the mapping against the sample from Step 1. Parse it with `parsePayload` from `src/engine/parsers` and run a few records through `mapRecord(record, config, config.name)` from `src/engine/field-mapper`. Every record should return an entity with real coordinates, not `null`, and an id of the form `<name>:<external_id>`. Check that altitude comes out in metres.

3. Restart the backend and watch the log for `Error polling source <name>` or `skipped N record(s) with missing id/coordinates`, then check `GET /api/entities?source_id=<name>`.

4. Run `npm run format:check` from the repository root; run `npm run format` if it complains about the new file.
