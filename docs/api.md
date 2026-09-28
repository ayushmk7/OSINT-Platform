# API reference

The backend exposes a small read-only REST API and one WebSocket endpoint, both on the same HTTP server (port 4000 by default). In development the Vite server on port 3000 proxies `/api` and `/ws` to it, so the frontend uses relative URLs.

The OpenAPI 3.0 description lives at [`backend/src/api/openapi.yaml`](../backend/src/api/openapi.yaml) and is served by the backend at `GET /api/openapi.yaml`. It covers every endpoint, query parameter and error response on this page.

All REST responses are JSON objects. List endpoints always wrap their results in an object and never return a bare array.

## REST endpoints

| Method | Path | Purpose |
| :-- | :-- | :-- |
| GET | `/api/health` | Liveness check. |
| GET | `/api/openapi.yaml` | The OpenAPI spec (`application/yaml`). |
| GET | `/api/sources` | Registered data sources. |
| GET | `/api/entities` | Tracked entities, with category, source and bounding-box filters. |
| GET | `/api/observations` | Recorded observations, filtered by entity or source. |

There are no write endpoints.

### Column types in responses

SQLite stores `metadata` and `raw_payload` as JSON text and `enabled` as an integer. The query layer (`serializeSource`, `serializeEntity` and `serializeObservation` in `backend/src/db/queries.ts`) normalises them before they leave the server:

- `sources[].enabled` is a boolean.
- `entities[].metadata` and `observations[].raw_payload` are parsed JSON objects. A malformed stored value becomes `{}` rather than failing the response.

The WebSocket `initial_state` and `entity_update` frames use the same wire format, so clients never need to `JSON.parse` a field.

### Pagination

`/api/entities` and `/api/observations` share these rules (`DEFAULT_PAGE_SIZE = 100`, `MAX_PAGE_SIZE = 1000` in `backend/src/db/queries.ts`):

- `limit` defaults to 100 and is clamped to 1..1000. A non-numeric value falls back to 100.
- `offset` defaults to 0. Negative values become 0 and non-numeric values fall back to 0.
- Results are ordered by `timestamp` descending.
- `total` is the number of rows matching the filters (a `COUNT(*)` over the same `WHERE` clause), independent of `limit` and `offset`. Use it to work out how many pages exist.

---

### GET /api/health

Defined in `backend/src/app.ts`.

```bash
curl http://localhost:4000/api/health
```

```json
{ "status": "ok" }
```

`status` is `"ok"` while the database handle is open and `"degraded"` otherwise. The HTTP status is 200 in both cases.

---

### GET /api/openapi.yaml

Defined in `backend/src/app.ts`. Returns the spec file as `application/yaml`, read from disk on each request. If the file cannot be read the response is a `500` with message `Failed to read OpenAPI spec`.

```bash
curl http://localhost:4000/api/openapi.yaml
```

---

### GET /api/sources

Returns every row of the `sources` table, ordered by `id`. Rows are written by the scheduler from the YAML files in `sources.d/`, including sources marked `enabled: false`.

```bash
curl http://localhost:4000/api/sources
```

```json
{
  "sources": [
    {
      "id": "usgs_earthquakes",
      "name": "USGS Earthquakes",
      "type": "usgs_earthquakes",
      "transport": "http_poll",
      "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
      "update_interval_sec": 60,
      "enabled": true
    }
  ]
}
```

| Field | Source |
| :-- | :-- |
| `id` | YAML `name` |
| `name` | YAML `display_name` (or `name`) |
| `type` | YAML `source_type` |
| `transport` | YAML `transport.type` |
| `url` | YAML `transport.url` |
| `update_interval_sec` | parsed `transport.interval` |
| `enabled` | `true` unless the YAML sets `enabled: false` |

Errors: `500` with message `Failed to fetch sources`.

---

### GET /api/entities

Defined in `backend/src/api/routes/entities.ts`.

| Query parameter | Type | Description |
| :-- | :-- | :-- |
| `category` | string | Exact match on `category`, for example `aircraft`. |
| `source_id` | string | Exact match on `source_id`, for example `adsb_military`. |
| `min_lat`, `max_lat` | number | Inclusive latitude bounds. |
| `min_lon`, `max_lon` | number | Inclusive longitude bounds. |
| `limit` | integer | Page size, see [Pagination](#pagination). |
| `offset` | integer | Rows to skip. |

Entity `id`s are namespaced by source as `<source_name>:<external_id>` (see [data-sources.md](data-sources.md#entity)). `altitude` is always metres; for USGS it is the depth below the surface as a negative number, while `metadata.depth` keeps the raw kilometre value.

Each bound is optional and applied on its own. An empty string is treated as absent. The bounding box does not wrap across the antimeridian.

```bash
curl "http://localhost:4000/api/entities?category=geological&min_lat=30&max_lat=40&limit=1"
```

```json
{
  "total": 12,
  "limit": 1,
  "offset": 0,
  "entities": [
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
  ]
}
```

Errors:

| Status | Message | Cause |
| :-- | :-- | :-- |
| 400 | `Invalid bounding box parameter: <name>` | A bound is present but not a finite number. `<name>` is `min_lat`, `max_lat`, `min_lon` or `max_lon`. |
| 400 | `Invalid bounding box parameters: min_lat must be less than max_lat` | `min_lat > max_lat`. |
| 400 | `Invalid bounding box parameters: min_lon must be less than max_lon` | `min_lon > max_lon`. |
| 500 | `Failed to fetch entities` | Database error. |

Invalid `limit` or `offset` values never produce an error; they fall back to their defaults.

---

### GET /api/observations

Defined in `backend/src/api/routes/observations.ts`.

| Query parameter | Type | Description |
| :-- | :-- | :-- |
| `entity_id` | string | Exact match on `entity_id`. |
| `source_id` | string | Exact match on `source_id`. |
| `limit` | integer | Page size, see [Pagination](#pagination). |
| `offset` | integer | Rows to skip. |

```bash
curl "http://localhost:4000/api/observations?entity_id=iss_position:25544&limit=1"
```

```json
{
  "total": 200,
  "limit": 1,
  "offset": 0,
  "observations": [
    {
      "id": "obs_iss_position:25544_1786644444000",
      "entity_id": "iss_position:25544",
      "source_id": "iss_position",
      "latitude": 26.992672280134,
      "longitude": -62.503173202437,
      "altitude": 420412.98073631,
      "speed": 27584.123987064,
      "heading": 0,
      "timestamp": "2026-08-13T18:07:24.000Z",
      "raw_payload": {
        "name": "iss",
        "id": 25544,
        "latitude": 26.992672280134,
        "longitude": -62.503173202437,
        "altitude": 420.41298073631,
        "velocity": 27584.123987064,
        "visibility": "daylight",
        "timestamp": 1786644444,
        "units": "kilometers"
      }
    }
  ]
}
```

(The `raw_payload` above is shortened; the real value contains the full source record. It is the upstream record as received, so its `altitude` is still in kilometres while the stored `altitude` has been scaled to metres.)

How many observations exist per entity depends on the source's recording mode: one for `upsert` sources, up to 200 for `append` sources. See [data-sources.md](data-sources.md#recording-modes).

Errors: `500` with message `Failed to fetch observations`.

---

## Error format

Defined in `backend/src/api/errors.ts`. Every error the API produces, including unknown routes, uses the same envelope:

```json
{
  "status": 400,
  "error": "Bad Request",
  "message": "Invalid bounding box parameter: min_lat",
  "details": null
}
```

| Field | Type | Notes |
| :-- | :-- | :-- |
| `status` | integer | Same as the HTTP status code. |
| `error` | string | `"Bad Request"`, `"Not Found"` or `"Internal Server Error"`. |
| `message` | string | A fixed, safe string chosen by the route. |
| `details` | null | Always `null`. |

For 500 errors (`sendServerError`), the underlying exception is logged on the server as `[api] <context>: <error>`, and `message` is only the context string, such as `Failed to fetch entities`. Stack traces and raw error messages are never sent to the client.

Requests to paths that match no route (for example `GET /api/unknown`) are caught by `notFoundHandler`, registered last in `backend/src/app.ts`. They return `404` with this envelope:

```json
{
  "status": 404,
  "error": "Not Found",
  "message": "Route not found: GET /api/unknown",
  "details": null
}
```

The WebSocket upgrade on `/ws/telemetry` never reaches Express, so the catch-all does not affect it.

---

## WebSocket protocol

Defined in `backend/src/websocket/server.ts` and `backend/src/websocket/broadcaster.ts`. The client side is `frontend/src/hooks/useWebSocket.ts`.

### Connecting

| | |
| :-- | :-- |
| Path | `/ws/telemetry` (`WS_PATH`) |
| Direct URL | `ws://localhost:4000/ws/telemetry` |
| Through the Vite dev proxy | `ws://localhost:3000/ws/telemetry` |
| Encoding | One JSON object per text frame |
| Authentication | None |

The browser client derives the URL from the page location, using `wss://` on HTTPS pages and `ws://` otherwise.

```bash
npx wscat -c ws://localhost:4000/ws/telemetry
```

Every server message has a `type` and an ISO 8601 `timestamp` (the server time when it was sent). Most also have a `data` field.

### Server to client

#### `initial_state`

Sent once, right after the connection opens.

```json
{
  "type": "initial_state",
  "timestamp": "2026-08-13T18:07:30.120Z",
  "data": {
    "sources": [
      {
        "id": "iss_position",
        "name": "ISS Position Tracker",
        "type": "iss_position",
        "transport": "http_poll",
        "url": "https://api.wheretheiss.at/v1/satellites/25544",
        "update_interval_sec": 30,
        "enabled": true
      }
    ],
    "entities": [
      {
        "id": "iss_position:25544",
        "source_id": "iss_position",
        "category": "satellite",
        "name": "iss",
        "latitude": 26.992672280134,
        "longitude": -62.503173202437,
        "altitude": 420412.98073631,
        "timestamp": "2026-08-13T18:07:24.000Z",
        "metadata": { "visibility": "daylight", "velocity": 27584.123987064 }
      }
    ]
  }
}
```

- `sources` holds every row of the `sources` table, in the same shape as `GET /api/sources`.
- `entities` is a category-balanced snapshot: the newest 300 entities per category (`SNAPSHOT_PER_CATEGORY`). `metadata` is a parsed object, as in the REST responses.

If building the snapshot fails, the error is logged on the server and no `initial_state` frame is sent. The socket stays open.

#### `entity_update`

Sent to every connected client when the scheduler writes an entity that is new, or whose latitude, longitude or altitude changed since the last poll. Entities that did not move are not re-sent.

```json
{
  "type": "entity_update",
  "timestamp": "2026-08-13T18:08:00.004Z",
  "data": {
    "id": "adsb_military:ae1234",
    "source_id": "adsb_military",
    "category": "aircraft",
    "name": "RCH123",
    "latitude": 38.12,
    "longitude": -76.45,
    "altitude": 7315.2,
    "timestamp": "2026-08-13T18:07:59.870Z",
    "metadata": { "callsign": "RCH123", "registration": "12-3456", "type": "C17" }
  }
}
```

`data` is the mapper's `EntityRecord`. `broadcastEntityUpdate()` passes `metadata` through the same `parseJsonObject()` normaliser the REST layer uses, so it is always an object. The frontend's `parseEntityMetadata()` only guards the shape (anything that is not a plain object becomes `{}`). The values in this example are illustrative; `altitude` is metres (24,000 ft scaled by `0.3048`).

#### `ping`

Application-level heartbeat, sent every 30 seconds (`HEARTBEAT_INTERVAL_MS`) alongside a protocol-level WebSocket ping.

```json
{ "type": "ping", "timestamp": "2026-08-13T18:08:30.000Z" }
```

#### `pong`

The reply to a client `ping`.

```json
{ "type": "pong", "timestamp": "2026-08-13T18:08:30.015Z" }
```

The server sends no other message types. Individual observations are not streamed; fetch them from `GET /api/observations`.

### Client to server

The only messages the server acts on are the two heartbeat messages. No subscription, filtering or other command messages exist.

| Message | Server behaviour |
| :-- | :-- |
| `{"type":"ping"}` | Marks the socket alive and replies with a `pong` message. |
| `{"type":"pong"}` | Marks the socket alive. This is how browser clients answer the server's `ping`, because JavaScript cannot see protocol-level ping frames. |
| Any other valid JSON | Ignored. |
| Invalid JSON | Ignored, with a warning in the server log. |

The frontend replies to every server `ping` with `{"type":"pong","timestamp":"<now>"}`.

### Liveness and reconnection

On each 30-second heartbeat round the server terminates any socket that has not shown signs of life since the previous round. A socket counts as alive if it sent a protocol pong, a `ping` message or a `pong` message. Clients that answer either kind of ping stay connected indefinitely.

The frontend reconnects automatically after a disconnect with exponential backoff: 3 seconds, then 6, 12, 24, capped at 30 seconds. The delay resets after a successful connection. A reconnect triggers a fresh `initial_state`, which replaces the client's entity and source state.
