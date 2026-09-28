# PROMPT 3: Express REST API & Real-Time WebSocket Server

You are an expert Full-Stack Software Engineer specializing in Node.js, Express, TypeScript, SQLite (`better-sqlite3`), OpenAPI 3.0, and WebSockets (`ws`).

Your task is to generate a Superpowers Spec and Implementation Plan, then execute Step 3 of the ReconVillage OSINT Platform: building the Express REST API endpoints (`/api/sources`, `/api/entities`, `/api/observations`) and real-time WebSocket server (`/ws/telemetry`) with telemetry event broadcasting and connection heartbeat handling.

## Instructions & Constraints
- **REST API Endpoint Routes**:
  - `backend/src/api/routes/sources.ts`: `GET /api/sources` (returns configured data sources and polling status).
  - `backend/src/api/routes/entities.ts`: `GET /api/entities` (queries active entities with optional `category` and spatial bounding box parameters: `min_lat`, `max_lat`, `min_lon`, `max_lon`).
  - `backend/src/api/routes/observations.ts`: `GET /api/observations` (queries historical position and sensor telemetry observations filtered by `entity_id` and limit).
- **WebSocket Telemetry Server**:
  - `backend/src/websocket/server.ts`: Listens on `/ws/telemetry` using the `ws` package. Sends initial state (`initial_state`) upon client connection.
  - `backend/src/websocket/broadcaster.ts`: Event emitter/broadcaster class streaming live telemetry payloads (`entity_update`, `observation`) to all connected WebSocket clients whenever the ingestion engine processes new updates.
  - Connection health management: Application-level ping/pong heartbeats and WebSocket ping frames (30s interval) to terminate stale or dead sockets.
- **App & Router Integration**:
  - Register API routes and attach the WebSocket server in `backend/src/app.ts` / `backend/src/index.ts`.
  - Validate response contracts against `backend/src/api/openapi.yaml`.
- **Real-time wiring (critical)**: The WebSocket server and the ingestion scheduler must be
  **composed together in `index.ts`** — `http.createServer(app)` + `setupWebSocketServer(server)`
  + start the scheduler + set `scheduler.onEntityUpdate = (e) => broadcaster.broadcastEntityUpdate(e)`.
  In the previous run the broadcaster was never connected to the scheduler, so no live updates
  ever flowed even when the socket connected. Broadcast **only changed entities** (no per-record
  `observation` flood the frontend never reads).
- **Canonical port + path**: backend listens on **`4000`**; the WebSocket path is the single
  constant **`/ws/telemetry`**, shared by server and client. No `3001`.
- **Balanced initial snapshot**: `initial_state` must include entities from **every** category,
  not the newest 500 globally (aircraft use fresh timestamps and would otherwise monopolize the
  snapshot, hiding all other categories).
- **Superpowers Alignment**: Create `docs/superpowers/specs/03-backend-websocket-api-spec.md` and `docs/superpowers/plans/03-backend-websocket-api-plan.md` first, then follow TDD to execute the plan.
- **RTK Usage (agent shell ONLY)**: Prefix *your own* shell commands with `rtk`. Never write `rtk` into any committed file.

## Format Requirements
1. First, create the technical spec file at `docs/superpowers/specs/03-backend-websocket-api-spec.md`.
2. Second, create the step-by-step TDD implementation plan at `docs/superpowers/plans/03-backend-websocket-api-plan.md`.
3. Finally, execute the implementation plan step-by-step, verifying with `rtk make test` and `rtk make lint`.

## Analysis Steps
1. Review database table structures (`sources`, `entities`, `observations`) and OpenAPI specification contracts.
2. Design database query helpers with spatial bounding box filtering (`latitude BETWEEN min_lat AND max_lat`).
3. Define the WebSocket protocol payload formats (`initial_state`, `entity_update`, `observation`, `ping`, `pong`).
4. Establish route integration tests (`routes.test.ts`) and WebSocket client mock tests (`websocket.test.ts`).
5. Construct spec, plan, API routes, WebSocket broadcaster, and tests systematically.

## Input Data
=============================================
Project Target: ReconVillage Backend REST & WebSocket API
Stack: Node.js, Express, TypeScript, better-sqlite3, ws, OpenAPI 3.0

REST API Endpoints Required:
- `GET /api/sources` -> List active and configured data sources
- `GET /api/entities` -> Query entities (Filters: category, source_id, min_lat, max_lat, min_lon, max_lon, limit, offset)
- `GET /api/observations` -> Query telemetry observations (Filters: entity_id, source_id, limit, offset)

WebSocket Server Specification:
- Endpoint: `ws://localhost:4000/ws/telemetry` (proxied in dev via Vite `/ws`, `ws: true`)
- On Connect: Send `type: "initial_state"` payload with a **category-balanced** set of current entities and active sources
- Broadcast Events: `type: "entity_update"` (on new/changed entity only). Do NOT broadcast a per-record `observation` on every poll.
- Heartbeat: Interval 30,000ms sending `type: "ping"`, expecting `type: "pong"` or WS pong frame
=============================================

## Hard Requirements & Definition of Done

Step 3 is **done** only when observed:

1. **Wired end-to-end.** `index.ts` composes `http.createServer(app)` + WS server + scheduler,
   and sets `scheduler.onEntityUpdate`. Verify: with both dev servers up, the browser opens
   `/ws/telemetry` successfully, receives `initial_state`, and then receives `entity_update`
   frames as the engine ingests — confirmed in the Network tab, not just assumed.
2. **Canonical port/path:** backend on `4000`; WS path constant `/ws/telemetry`. No `3001`.
3. **Balanced snapshot:** the `initial_state` payload contains ≥1 entity for **each** category
   present in the DB (assert in a test that a DB seeded with 5 categories yields all 5 in the
   snapshot, even when one category has vastly more/newer rows).
4. **No observation flood:** the server does not emit a per-record `observation` message every
   poll; `entity_update` fires only on new/changed entities.
5. **No stack-trace leaks:** route error responses return `{ status, error, message }` and never
   include `err.stack`/raw error strings (gate any verbose detail behind non-production only).
6. **REST is real, not dead code:** at least the observations endpoint is consumed by the UI
   (entity inspector history), so the REST layer is exercised.
