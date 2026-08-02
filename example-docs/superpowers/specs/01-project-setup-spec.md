# Technical Specification: 01 - Project Setup & Monorepo Foundation

## 1. Overview
This specification details the foundational architecture for the ReconVillage OSINT Intelligence Platform. The objective of Step 1 is to establish a robust monorepo workspace containing a Node.js + Express + TypeScript backend connected to a SQLite database (`better-sqlite3`), an OpenAPI 3.0 API spec, and a Vite + React + MUI frontend that — on a tactical dark theme — renders a simple interactive **CesiumJS globe**, plus a top-level `Makefile` to unify development workflows.

**Why a globe already in step 1?** The globe is introduced at the end of the very first step on purpose. Steps 2–3 are entirely backend (ingestion engine, WebSocket API) with no visible output, so without this, students would build for a long stretch before seeing anything. Ending step 1 with a real spinning Earth gives them the payoff up front — "this is what you're building" — and step 4 then layers live telemetry onto **this same globe** rather than creating it from scratch. The step-1 globe has **no backend dependency** (its basemap needs no API key), so it runs standalone the moment setup is done.

---

## 2. Workspace & Monorepo Structure

```
reconvillage-workshop/
├── Makefile
├── package.json
├── docs/
│   ├── PROMPT_1_PROJECT_SETUP.md
│   └── superpowers/
│       ├── specs/
│       │   └── 01-project-setup-spec.md
│       └── plans/
│           └── 01-project-setup-plan.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js
│   └── src/
│       ├── index.ts
│       ├── app.ts
│       ├── db/
│       │   └── database.ts
│       ├── api/
│       │   ├── openapi.yaml
│       │   └── routes.ts
│       └── __tests__/
│           ├── database.test.ts
│           └── routes.test.ts
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx             # app shell: app bar over a full-bleed globe
        ├── theme.ts            # single tactical theme (tacticalTheme)
        ├── components/
        │   └── GlobeView.tsx   # simple Cesium globe — the base step 4 extends
        └── __tests__/
            └── theme.test.ts
```

---

## 3. Database Architecture & Schema (`better-sqlite3`)

The backend persistence layer uses SQLite via `better-sqlite3` (`backend/src/db/database.ts`). The module MUST expose a **singleton accessor** so routes, query helpers, the ingestion scheduler, and the WebSocket server all share one connection:
- `initDatabase(path?: string): Database.Database` — opens the DB, creates the schema, stores it as the module singleton, and returns it.
- `getDatabase(): Database.Database` — returns the singleton (throws if `initDatabase` was never called). Later steps import `getDatabase` directly, so it must exist from step 1.
- `closeDatabase(db?): void` — closes and clears the singleton.

The database initializes the following three tables upon connection:

### 3.1 `sources` Table
Stores configured telemetry data sources (ingestion definitions).
```sql
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    transport TEXT NOT NULL,
    url TEXT NOT NULL,
    update_interval_sec INTEGER NOT NULL DEFAULT 60,
    enabled INTEGER NOT NULL DEFAULT 1
);
```

### 3.2 `entities` Table
Tracks real-world assets/targets (e.g., aircraft, satellites, vessels, earthquakes).
```sql
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude REAL NOT NULL DEFAULT 0.0,
    timestamp TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);
CREATE INDEX IF NOT EXISTS idx_entities_source_id ON entities(source_id);
```

### 3.3 `observations` Table
Historical telemetry data points captured for entities over time.
```sql
CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude REAL NOT NULL DEFAULT 0.0,
    speed REAL NOT NULL DEFAULT 0.0,
    heading REAL NOT NULL DEFAULT 0.0,
    timestamp TEXT NOT NULL,
    raw_payload TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_observations_entity_id ON observations(entity_id);
CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp);

-- Natural-key uniqueness: prevents duplicate observations for the same entity at the
-- same instant. Combined with a deterministic observation id + INSERT OR IGNORE, this is
-- what stops the unbounded duplication (see step 2). REQUIRED.
CREATE UNIQUE INDEX IF NOT EXISTS ux_observations_entity_timestamp
    ON observations(entity_id, timestamp);
```

---

## 4. OpenAPI 3.0 REST API Specification

File: `backend/src/api/openapi.yaml`

Endpoints (responses are **wrapped objects**, never bare arrays — this envelope is fixed
here and reused unchanged by steps 3–4):
- `GET /api/sources`: `{ "sources": Source[] }`.
- `GET /api/entities`: `{ "total": int, "limit": int, "offset": int, "entities": Entity[] }`. Supports query parameter `category` (string, optional).
- `GET /api/observations`: `{ "total": int, "limit": int, "offset": int, "observations": Observation[] }`. Supports query parameter `entity_id` (string, optional).

### OpenAPI Schemas Definition:
- **`Source`**: `{ id: string, name: string, type: string, transport: string, url: string, update_interval_sec: integer, enabled: boolean }`
- **`Entity`**: `{ id: string, source_id: string, category: string, name: string, latitude: number, longitude: number, altitude: number, timestamp: string, metadata: object }`
- **`Observation`**: `{ id: string, entity_id: string, source_id: string, latitude: number, longitude: number, altitude: number, speed: number, heading: number, timestamp: string, raw_payload: object }`
- **`ErrorResponse`**: `{ status: integer, error: string, message: string, details: object }`

---

## 5. Frontend UI & Material UI Theme

The frontend is built using Vite, React 18, Material UI, and **CesiumJS** (bundled with `vite-plugin-cesium`).

### Tactical Theme Specification (`frontend/src/theme.ts`, export `tacticalTheme`)
Use **exactly one** theme module — `frontend/src/theme.ts` — for the whole app. Do not
create a second theme file (a `darkTheme` vs `tacticalTheme` split caused inconsistencies).
The palette is the green-on-black tactical "command center" identity:
- Background Default: `#000000` (true black)
- Background Paper: `#0a0a0a` (near-black container)
- Primary Color: `#00ff9d` (neon green accent)
- Secondary Color: `#ff006e` (magenta)
- Text Primary: `#ffffff`
- Text Secondary: `#888888`
- Typography: monospace everywhere — `"JetBrains Mono", "SF Mono", "Fira Code", monospace`.

### First-Run Globe (`frontend/src/components/GlobeView.tsx`)

Step 1 ends with a real, interactive **CesiumJS globe** filling the screen behind the app bar —
the payoff that shows students what they are building before any backend exists. It is
deliberately minimal and has **no backend dependency**:

- A raw `Cesium.Viewer` created once in a `useEffect` (held in a ref); all default Cesium widgets
  disabled; black background; credit bar hidden.
- Basemap: **Stadia "Alidade Smooth Dark"** raster tiles via `UrlTemplateImageryProvider` — **no
  API key required**. Build it in a factory (React StrictMode double-invokes effects in dev).
- A gentle idle auto-rotation ("attract mode") that stops the first time the user interacts, so
  panning/zoom then feels natural.
- `cesium` + `vite-plugin-cesium` are added to the frontend package here; the plugin (registered
  in `vite.config.ts`) copies Cesium's static assets and defines `CESIUM_BASE_URL`.

This is the **same `GlobeView.tsx` that step 4 extends** — step 4 adds a `BillboardCollection`,
the WebSocket telemetry feed, category markers, layer filters, and click-to-select on top of it.
It is not a throwaway; it is the foundation. Because Cesium needs WebGL (absent in jsdom), the
globe is verified **visually**, not by a unit test (the unit test in step 1 stays the pure theme
test).

---

## 6. Makefile Command Standard

Top-level `Makefile` exposes targets. **`rtk` must never appear in the Makefile** (it is an
agent-side shell wrapper only; committed files call `npm`/`npx` directly, or they fail with
`rtk: command not found` on attendees' machines):
- `make install`: Installs all Node.js dependencies for the workspace by running `npm install` at the repo root (NPM workspaces installs `backend/` and `frontend/` in one pass). It **must** call `npm install` directly — do not wire it to an `install` npm script and do not add an `"install"` key to any `package.json`, because npm runs an `install` lifecycle script automatically during `npm install` and it would recurse forever.
- `make dev`: Concurrently runs the backend and frontend dev servers via `npx concurrently`.
- `make build`: Compiles backend (`npm run build --prefix backend`) and builds the frontend bundle (`npm run build --prefix frontend`).
- `make test`: Runs `npm test --prefix backend` and `npm test --prefix frontend`. Test scripts must NOT use `--passWithNoTests`.
- `make lint`: Runs ESLint + TypeScript checks across packages.
- `make format`: Runs `npx prettier` across the workspace.

Every target must run to completion in a shell where `rtk` is **not** on `PATH`.
`make dev` is validated by starting it, confirming **both** servers come up, then stopping it.

---

## 7. Hard Requirements & Definition of Done

Step 1 is **done** only when every item below is verified by observation (not assumed):

1. `grep -rn "rtk" Makefile package.json backend/package.json frontend/package.json` → **zero** matches.
2. With `rtk` **not** on `PATH`: `make install`, `make help`, `make build`, `make test`, `make lint`, `make format` all exit 0; `make dev` brings up **both** the backend (logs port `4000`) and the Vite dev server (prints its URL). `make install` calls `npm install` directly (no `install` script in any `package.json`).
3. Backend listens on **`4000`**; `frontend/vite.config.ts` proxies both `/api` and `/ws` (`ws: true`) to `http://localhost:4000`. No `3001` anywhere in the repo.
4. `backend/src/db/database.ts` exports `initDatabase`, `getDatabase`, `closeDatabase`; `getDatabase()` returns the shared singleton.
5. Endpoints return the wrapped envelope of §4; `curl -s localhost:4000/api/sources` returns `{ "sources": [...] }`.
6. Exactly one theme module `frontend/src/theme.ts` (`tacticalTheme`), green-on-black, monospace.
7. **The frontend renders a real Cesium globe.** Run `make dev` and open the app: a dark 3D Earth
   fills the screen behind the app bar and slowly auto-rotates. `cesium` + `vite-plugin-cesium`
   are in `frontend/package.json` and `cesium()` is registered in `vite.config.ts`. Verified
   **visually** (Cesium needs WebGL; the step-1 unit test stays the pure theme test). It is a real
   `Cesium.Viewer` in `frontend/src/components/GlobeView.tsx` — not a placeholder card.
8. `tsconfig` keeps `strict`, `noUnusedLocals`, `noUnusedParameters` = `true`. Test scripts never use `--passWithNoTests`.
9. No empty `catch` blocks; no CDN-hotlinked runtime assets; no `err.stack` returned to clients.
