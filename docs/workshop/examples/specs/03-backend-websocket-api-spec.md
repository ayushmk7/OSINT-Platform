# Technical Specification: 03 - Backend REST & Real-Time WebSocket API

## 1. Overview
This specification details the architecture for the backend REST API endpoints and real-time WebSocket telemetry server of the MK-OSINT. The system exposes REST endpoints for querying data sources, active entities (with category and spatial bounding box filtering), and historical observations stored in SQLite. Furthermore, it establishes a high-throughput WebSocket server on `/ws/telemetry` using the `ws` package, broadcasting live ingestion updates (`entity_update`, `observation`) and managing client socket health via heartbeat ping/pong protocol.

---

## 2. System Architecture & Data Flow

```
[ HTTP Clients / Frontend ] ──GET /api/sources, /api/entities, /api/observations──> [ Express Router ]
                                                                                           │
                                                                                           ▼
                                                                                   [ Query Helper ]
                                                                                           │
                                                                                           ▼
                                                                                 SQLite Database
                                                                             (sources, entities, obs)
                                                                                           ▲
                                                                                           │ Persistence
[ Ingestion Scheduler ] ──Upsert/Append Record──> [ Database Persistence ] ────────────────┘
          │
          └──Emit Event──> [ Telemetry Broadcaster ] ──Broadcast JSON──> [ WebSocket Server (/ws/telemetry) ]
                                                                                   │
                                                                                   ▼
                                                                       [ WS Telemetry Clients ]
```

---

## 3. Express REST API Endpoint Specifications

### 3.1 `GET /api/sources`
Retrieves all configured OSINT data sources, their transport configurations, update intervals, and current operational status.

- **Query Parameters**: None
- **Response `200 OK`**:
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
      "enabled": 1
    }
  ]
}
```

### 3.2 `GET /api/entities`
Queries tracked entities (satellites, aircraft, earthquakes, radiation sensors, ships). Supports category filtering and spatial bounding box bounding queries.

- **Query Parameters**:
  - `category` (optional, string): Filter by category (e.g. `satellite`, `aircraft`, `geological`, `radiation`).
  - `source_id` (optional, string): Filter by originating source identifier.
  - `min_lat` (optional, float): Minimum latitude bound (-90.0 to 90.0).
  - `max_lat` (optional, float): Maximum latitude bound (-90.0 to 90.0).
  - `min_lon` (optional, float): Minimum longitude bound (-180.0 to 180.0).
  - `max_lon` (optional, float): Maximum longitude bound (-180.0 to 180.0).
  - `limit` (optional, integer, default: 100, max: 1000): Maximum records returned.
  - `offset` (optional, integer, default: 0): Result pagination offset.

- **Response `200 OK`**:
```json
{
  "total": 1,
  "limit": 100,
  "offset": 0,
  "entities": [
    {
      "id": "ISS_25544",
      "source_id": "iss_position",
      "category": "satellite",
      "name": "International Space Station",
      "latitude": 48.8566,
      "longitude": 2.3522,
      "altitude": 420000.0,
      "timestamp": "2026-07-26T23:00:00.000Z",
      "metadata": "{\"velocity\":27600,\"visibility\":\"daylight\"}"
    }
  ]
}
```

### 3.3 `GET /api/observations`
Queries historical position and sensor telemetry observations captured for entities over time.

- **Query Parameters**:
  - `entity_id` (optional, string): Filter observations by associated entity ID.
  - `source_id` (optional, string): Filter by source identifier.
  - `limit` (optional, integer, default: 100, max: 1000): Maximum records returned.
  - `offset` (optional, integer, default: 0): Result pagination offset.

- **Response `200 OK`**:
```json
{
  "total": 1,
  "limit": 100,
  "offset": 0,
  "observations": [
    {
      "id": "obs_12345",
      "entity_id": "ISS_25544",
      "source_id": "iss_position",
      "latitude": 48.8566,
      "longitude": 2.3522,
      "altitude": 420000.0,
      "speed": 27600.0,
      "heading": 0.0,
      "timestamp": "2026-07-26T23:00:00.000Z",
      "raw_payload": "{}"
    }
  ]
}
```

### 3.4 API Error Response Standard
All error states follow the OpenAPI contract standard format. **`details` MUST NEVER contain a
stack trace or raw error string** — that is information disclosure. Log the full error
server-side; return only a safe message (verbose detail, if any, gated behind
`NODE_ENV !== 'production'`).
```json
{
  "status": 400,
  "error": "Bad Request",
  "message": "Invalid bounding box parameters: min_lat must be less than max_lat",
  "details": null
}
```

---

## 4. Real-Time WebSocket Server Specification (`/ws/telemetry`)

### 4.1 Connection Lifecycle & Initialization
The WebSocket path is a single shared constant `WS_PATH = "/ws/telemetry"` (backend on port
`4000`; dev clients reach it through the Vite `/ws` proxy with `ws: true`).
1. Client connects via `${ws|wss}://<host>${WS_PATH}` (scheme derived from `location.protocol`).
2. Server accepts connection, marks socket as alive (`isAlive = true`).
3. Immediately upon connection, server sends an `initial_state` message containing a
   **category-balanced** set of current entities (see §6) plus the data sources. It must NOT be
   the newest-500-globally, or aircraft (which carry the freshest timestamps) monopolize the
   snapshot and every other category is invisible on first paint.
4. Broadcaster registers the socket client in its active subscriber set.

### 4.2 WebSocket Protocol Message Schemas

#### 1. `initial_state` (Server -> Client)
Sent immediately upon connection establishing.
```json
{
  "type": "initial_state",
  "timestamp": "2026-07-26T23:00:00.000Z",
  "data": {
    "sources": [ ... ],
    "entities": [ ... ]
  }
}
```

#### 2. `entity_update` (Server -> Client Broadcast)
Emitted whenever the ingestion scheduler upserts or updates an entity record.
```json
{
  "type": "entity_update",
  "timestamp": "2026-07-26T23:00:00.000Z",
  "data": {
    "id": "ISS_25544",
    "source_id": "iss_position",
    "category": "satellite",
    "name": "International Space Station",
    "latitude": 48.8566,
    "longitude": 2.3522,
    "altitude": 420000.0,
    "timestamp": "2026-07-26T23:00:00.000Z",
    "metadata": { "velocity": 27600 }
  }
}
```

#### 3. `observation` (Server -> Client Broadcast)
Emitted whenever historical telemetry observation points are appended to SQLite.
```json
{
  "type": "observation",
  "timestamp": "2026-07-26T23:00:00.000Z",
  "data": {
    "id": "obs_12345",
    "entity_id": "ISS_25544",
    "source_id": "iss_position",
    "latitude": 48.8566,
    "longitude": 2.3522,
    "altitude": 420000.0,
    "speed": 27600.0,
    "heading": 0.0,
    "timestamp": "2026-07-26T23:00:00.000Z"
  }
}
```

#### 4. Heartbeat Messages (`ping` / `pong`)
- Server sends WS ping frame / JSON ping `{ "type": "ping" }` every 30,000 ms.
- Client responds with WS pong frame / JSON pong `{ "type": "pong" }`.
- If no response is received within 30,000 ms, the connection is terminated (`socket.terminate()`).

---

## 5. Broadcaster Architecture (`backend/src/websocket/broadcaster.ts`)

The `TelemetryBroadcaster` decouples ingestion from WebSocket streaming.

```typescript
export interface TelemetryBroadcaster {
  broadcastEntityUpdate(entity: EntityRecord): void;
  addClient(ws: WebSocket): void;
  removeClient(ws: WebSocket): void;
  getClientCount(): number;
}
```

**Broadcast discipline:** the globe runs on `entity_update` only. The scheduler calls
`broadcastEntityUpdate` **only for new or moved entities** (via its `onEntityUpdate` hook). Do
**not** broadcast a per-record `observation` message on every poll — the frontend never consumed
it, and for a feed like ADSB that is up to thousands of wasted messages every 30 seconds that
also inflate the "msgs/sec" gauge and burn CPU.

### 5.1 Composition & wiring (`backend/src/index.ts`) — REQUIRED

The single most important integration step, and the one missing from the previous run. `index.ts`
must compose everything so live updates actually flow:

```typescript
const PORT = 4000;
initDatabase(process.env.DB_PATH || 'mk-osint.db');

const app = express();                          // mount the REST router; routes use getDatabase()
app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

const server = http.createServer(app);          // one HTTP server...
setupWebSocketServer(server);                   // ...that the WS server attaches to (path = WS_PATH)

const scheduler = new IngestionScheduler(getDatabase(), sourcesDir);
scheduler.onEntityUpdate = (entity) => broadcaster.broadcastEntityUpdate(entity); // THE WIRE
scheduler.start();

server.listen(PORT, () => console.log(`MK-OSINT backend on :${PORT} (ws ${WS_PATH})`));
```

Without `scheduler.onEntityUpdate = …`, the socket connects but the map never updates.

---

## 6. Database Spatial & Filter Query Layer (`backend/src/db/queries.ts`)

SQL queries utilize prepared statements via `better-sqlite3` to guarantee high performance and SQL-injection prevention.

### Spatial Bounding Box SQL Query:
```sql
SELECT * FROM entities 
WHERE (? IS NULL OR category = ?)
  AND (? IS NULL OR source_id = ?)
  AND (? IS NULL OR latitude >= ?)
  AND (? IS NULL OR latitude <= ?)
  AND (? IS NULL OR longitude >= ?)
  AND (? IS NULL OR longitude <= ?)
ORDER BY timestamp DESC
LIMIT ? OFFSET ?;
```

### Category-Balanced Snapshot (`getInitialSnapshot`) — for `initial_state`
A global `ORDER BY timestamp DESC LIMIT 500` lets one high-frequency category (aircraft)
crowd out all others. Instead take the newest N **per category** so every category appears:
```sql
SELECT * FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY timestamp DESC) AS rn
  FROM entities
) WHERE rn <= ?;   -- e.g. 300 per category
```
(If window functions are undesirable, run one capped query per category and concatenate.)

---

## 7. Testing & Verification Plan
- **Route Unit/Integration Tests (`backend/src/__tests__/routes.test.ts`)**:
  - Verify `GET /api/sources` returns JSON response matching OpenAPI schema.
  - Verify `GET /api/entities` with category filter returns matching subset.
  - Verify `GET /api/entities` with bounding box (`min_lat`, `max_lat`, `min_lon`, `max_lon`) filters coordinates correctly.
  - Verify `GET /api/observations` returns historical observations for an entity.
- **WebSocket Tests (`backend/src/__tests__/websocket.test.ts`)**:
  - Test client connection and receipt of `initial_state` message.
  - Test that the `initial_state` snapshot includes **every** category when the DB is seeded
    with all five (even when one category dominates by count/recency).
  - Test broadcasting `entity_update` payload to active clients.
  - Test ping/pong health handling and disconnection cleanup.

---

## 8. Hard Requirements & Definition of Done

Step 3 is **done** only when observed:

1. `index.ts` composes `http.createServer(app)` + `setupWebSocketServer(server)` + the
   scheduler, and sets `scheduler.onEntityUpdate = (e) => broadcaster.broadcastEntityUpdate(e)`.
2. Backend listens on `4000`; WS path is the single constant `/ws/telemetry`. No `3001`.
3. With both dev servers running, a browser connects to `/ws/telemetry` (through the Vite `/ws`
   proxy), receives `initial_state`, then receives `entity_update` frames — verified in the
   Network tab.
4. `initial_state` is category-balanced (≥1 entity per category present in the DB).
5. No per-record `observation` broadcast; `entity_update` only for new/moved entities.
6. Error responses never include `err.stack`.
7. The observations REST endpoint is consumed by the UI (entity inspector), so it is exercised.
8. `make test` + `make lint` pass; no empty catches; no `--passWithNoTests`.
