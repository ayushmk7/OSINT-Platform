---
name: onboard-source
description: "Analyze an HTTP endpoint (JSON, GeoJSON, XML, CSV) and generate a valid declarative YAML source configuration for sources.d/"
---

# Onboard Source Skill (`onboard-source`)

This skill guides an AI agent through inspecting a live HTTP data endpoint (JSON, GeoJSON, XML, CSV) and producing a fully populated, validated schema v2 declarative YAML source definition in `sources.d/<source_name>.yaml`.

---

## Step-by-Step Instructions for Agents

### Step 1: Fetch Source Data from Target URL
Run an HTTP request to the endpoint provided by the user using `rtk curl` or Node `fetch` to inspect the response structure and sample payload.

```bash
rtk curl -s -H "Accept: application/json" "<TARGET_URL>" | head -n 50
```

- Save or capture the raw response payload to inspect data structure.
- If authentication, query parameters, or special headers are required, make sure to document them.

---

### Step 2: Analyze Format & Schema
Examine the HTTP response body and determine the data format:
- **`geojson`**: standard `FeatureCollection` with `features` array containing `geometry.coordinates` `[lon, lat, alt]` and `properties`.
- **`json`**: array of objects or nested JSON structure with a record array path.
- **`xml`**: XML document with repeating tag elements.
- **`csv`**: tabular CSV data with headers.

---

### Step 3: Identify Key Fields & Expression Paths
Map payload fields to the entity and observation attributes:

1. **`records_path`**: The JSONPath/dot-notation path to the array of records (e.g., `features` for GeoJSON, `states` for OpenSky, `data.items` for custom JSON, or empty string `""` if root is an array).
2. **`external_id`**: Unique ID expression for entity identification (e.g., `record.id`, `record.properties.id`, or `record[0]`).
3. **`name`**: Descriptive string/expression for display name (e.g., `record.properties.place`, `record.callsign`).
4. **`latitude`**: Latitude expression in decimal degrees (e.g., `record.geometry.coordinates[1]` or `double(record.lat)`).
5. **`longitude`**: Longitude expression in decimal degrees (e.g., `record.geometry.coordinates[0]` or `double(record.lon)`).
6. **`altitude`**: Altitude expression in meters (e.g., `record.geometry.coordinates[2]` or `double(record.baro_altitude)`).
7. **`timestamp`**: Time expression mapped to Unix milliseconds (e.g., `unix_ms(record.properties.time)` or `unix_ms(record.last_contact * 1000)`).
8. **`velocity`**: Kinematics attributes if present (`heading`, `speed`, `climb_rate`).
9. **`metadata`**: Key-value attribute mappings for additional domain properties.

---

### Step 4: Construct Schema v2 Declarative YAML Configuration
Assemble the full YAML source definition following Schema v2 standard structure:

- **Metadata Header**: `schema_version: 2`, `name`, `labels`, `source_type`, `layer_type`, `display_name`
- **Transport**: `type: http_poll`, `url`, `method`, `headers`, `timeout`, `interval`, `max_response_bytes`, `retry`
- **Parser**: `format` (`geojson` | `json` | `xml` | `csv`), `records_path`, `max_records`
- **Filter**: CEL boolean expression to filter invalid or out-of-bounds records.
- **Entity Mapping**: CEL expressions for `external_id`, `name`, `metadata`.
- **Observation Mapping**: CEL expressions for `latitude`, `longitude`, `altitude`, `timestamp`, `velocity`, `metadata`.
- **Recording & Cache**: `recording.mode: upsert`, `cache.ttl: "3600s"`.
- **Display**: Icon configuration (`shape`, `rotatable`, `scale`), trail rendering, point styles, and `field_renderers`.
- **History**: `max_lookback` and `max_range_span`.

---

### Step 5: Validate and Write Output File
1. Verify that the YAML syntax is strictly valid and formatted cleanly.
2. Ensure mandatory schema fields (`schema_version`, `name`, `transport`, `parser`, `entity`, `observation`, `display`) are present.
3. Write the final YAML file to `/Users/alevsk/Development/reconvillage-workshop/sources.d/<source_name>.yaml`.

```bash
rtk make test # or run linter/validator script if available
```

---

## Reference Example: Complete Schema v2 Source Template

Below is a complete, fully populated example of a Schema v2 source configuration for USGS Earthquakes (`sources.d/usgs_earthquakes.yaml`):

```yaml
# sources.d/usgs_earthquakes.yaml
schema_version: 2

name: usgs_earthquakes
labels:
  category: geological
  priority: low

# --- Identity ---
source_type: usgs_earthquakes
layer_type: earthquakes
display_name: "USGS Earthquakes"

# --- Ingestion ---
transport:
  type: http_poll
  url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
  method: GET
  headers:
    Accept: "application/json"
  timeout: "10s"
  interval: "60s"
  max_response_bytes: 52428800  # 50MB
  retry:
    max_attempts: 3
    backoff: "exponential"
    initial_delay: "1s"
    max_delay: "30s"

# --- Response Parsing ---
parser:
  format: geojson
  records_path: "features"
  max_records: 10000

# --- Record Filtering (CEL) ---
filter: >-
  has(record.properties.mag) && double(record.properties.mag) >= 1.0

# --- Entity Mapping (CEL) ---
entity:
  external_id: >-
    record.id
  name: >-
    has(record.properties.place) ? record.properties.place : record.id
  metadata:
    magnitude: >-
      string(record.properties.mag)
    depth: >-
      string(record.geometry.coordinates[2])
    place: >-
      has(record.properties.place) ? record.properties.place : "Unknown"
    type: >-
      has(record.properties.type) ? record.properties.type : "earthquake"
    alert: >-
      has(record.properties.alert) ? record.properties.alert : ""
    url: >-
      has(record.properties.url) ? record.properties.url : ""

# --- Observation Mapping (CEL) ---
observation:
  latitude: >-
    record.geometry.coordinates[1]
  longitude: >-
    record.geometry.coordinates[0]
  altitude: >-
    record.geometry.coordinates[2] * -1000.0
  timestamp: >-
    unix_ms(record.properties.time)
  velocity: {}
  metadata:
    magnitude: >-
      string(record.properties.mag)
  content_hash: ""

# --- Recording ---
recording:
  mode: upsert

# --- Cache ---
cache:
  ttl: "3600s"

# --- Display (consumed by frontend) ---
display:
  icon:
    shape: ripple
    rotatable: false
    interpolation: false
    scale: 1.0
  trail:
    color: "#ff006e"
    width: 1.5
    opacity: 0.7
  style:
    color: "#ff006e"
    point_size: 6
  field_renderers:
    - keys: [magnitude, mag]
      label: "MAGNITUDE"
      format:
        type: float
        precision: 1
        prefix: "M"
      priority: 0
    - keys: [depth, depth_km]
      label: "DEPTH"
      format:
        type: float
        precision: 1
        suffix: " km"
      priority: 1
    - keys: [place]
      label: "LOCATION"
      format:
        type: string
      priority: 2
    - keys: [type]
      label: "TYPE"
      format:
        type: string
        transform: upper
      priority: 3
    - keys: [alert]
      label: "ALERT"
      format:
        type: string
        transform: upper
      priority: 4

# --- History ---
history:
  max_lookback: "2160h"    # 90 days
  max_range_span: "168h"   # 7 days per query window
```
