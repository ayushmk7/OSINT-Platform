# PROMPT 1: Project Setup & Monorepo Foundation

You are an expert Full-Stack Software Engineer specializing in Node.js, TypeScript, Express, SQLite, and React.

Your task is to generate a Superpowers Spec and Implementation Plan, then execute Step 1 of the MK-OSINT: initializing the monorepo project structure, root Makefile, backend TypeScript + Express + SQLite setup with OpenAPI 3.0 specification, and a frontend Vite + React + MUI foundation that culminates in a simple, interactive **CesiumJS globe** — so students immediately see the thing they will spend the rest of the workshop building. (Steps 2–3 are backend-only; step 4 layers live telemetry onto this same globe.)

## Instructions & Constraints
- **Monorepo Layout**: Organize the workspace into a root project with `backend/` and `frontend/` packages using NPM workspaces or package scripts.
- **Root Makefile**: Include targets for `install` (installs all Node.js dependencies for the whole workspace), `dev` (runs backend and frontend in parallel), `build` (compiles backend and frontend), `test` (runs backend and frontend test suites), `lint` (runs linters), and `format` (runs prettier/formatter). The `install` target MUST call `npm install` **directly** — never `npm run install`, and never add an `"install"` script to any `package.json` (npm's `install` lifecycle hook would call it recursively and loop forever).
- **Backend Setup**:
  - Node.js + Express with TypeScript (`tsconfig.json` strict mode).
  - Dependencies: `express`, `better-sqlite3`, `ws`, `yaml`, `cors`, `dotenv`, `@types/node`, `@types/express`, `@types/better-sqlite3`, `@types/ws`, `jest` / `vitest` / `ts-jest` for testing.
  - `backend/src/db/database.ts`: Initialize SQLite database using `better-sqlite3`. Create schema for `entities`, `observations`, and `sources` tables.
  - `backend/src/api/openapi.yaml`: OpenAPI 3.0 REST specification defining endpoints:
    - `GET /api/sources` (list data sources)
    - `GET /api/entities` (list tracked entities)
    - `GET /api/observations` (list observations with filters)
- **Frontend Setup**:
  - Vite + React + TypeScript.
  - Material UI (MUI) `@mui/material`, `@emotion/react`, `@emotion/styled`, `@mui/icons-material`.
  - Configured with a dedicated dark theme provider matching tactical OSINT aesthetics.
  - **CesiumJS globe (the step-1 payoff)**: add `cesium` + `vite-plugin-cesium`, register
    `cesium()` in `vite.config.ts`, and render a real `Cesium.Viewer` in
    `frontend/src/components/GlobeView.tsx` — a dark **Stadia "Alidade Smooth Dark"** basemap (no
    API key), all default widgets disabled, filling the screen behind the app bar, with a gentle
    idle auto-rotate that stops on interaction. This is the **same component step 4 extends** with
    live markers and telemetry — build it real, not a placeholder. It needs **no backend**, so it
    renders as soon as `make dev` is up.
- **Superpowers Alignment**: Create `docs/superpowers/specs/01-project-setup-spec.md` and `docs/superpowers/plans/01-project-setup-plan.md` first, then follow TDD to execute the plan.
- **RTK Usage (agent shell ONLY)**: When *you* run a shell command, prefix it with `rtk` (e.g., `rtk npm test`, `rtk tsc`, `rtk git status`). **`rtk` is a machine-local, agent-side wrapper — it MUST NEVER appear inside any committed file.** The `Makefile`, `package.json` scripts, and any code must call `npm`/`npx` directly, or they will fail with `rtk: command not found` on every attendee's machine.

## Format Requirements
1. First, create the technical spec file at `docs/superpowers/specs/01-project-setup-spec.md`.
2. Second, create the step-by-step TDD implementation plan at `docs/superpowers/plans/01-project-setup-plan.md`.
3. Finally, execute the implementation plan step-by-step, verifying with `rtk make test` and `rtk make lint`.

## Analysis Steps
1. Review the provided requirements and input architecture data.
2. Outline the directory layout, configuration files, SQLite DDL schemas, and OpenAPI paths.
3. Formulate testing strategies (e.g., SQLite database unit tests, Express route tests, React component rendering tests).
4. Construct the spec, plan, and codebase files systematically.

## Input Data
=============================================
Project Target: MK-OSINT Intelligence Platform
Stack: Node.js, Express, TypeScript, better-sqlite3, ws, yaml, Vite, React, MUI (Dark Theme)

Database Tables Required:
1. `sources` (id TEXT PRIMARY KEY, name TEXT, type TEXT, transport TEXT, url TEXT, update_interval_sec INTEGER, enabled INTEGER)
2. `entities` (id TEXT PRIMARY KEY, source_id TEXT, category TEXT, name TEXT, latitude REAL, longitude REAL, altitude REAL, timestamp TEXT, metadata TEXT)
3. `observations` (id TEXT PRIMARY KEY, entity_id TEXT, source_id TEXT, latitude REAL, longitude REAL, altitude REAL, speed REAL, heading REAL, timestamp TEXT, raw_payload TEXT)

OpenAPI Paths Required:
- `/api/sources`: GET (list all sources)
- `/api/entities`: GET (list entities, optional ?category filter)
- `/api/observations`: GET (list observations, optional ?entity_id filter)
=============================================

## Hard Requirements & Definition of Done

These are non-negotiable acceptance criteria. A previous run of this workshop shipped a
setup whose `make` targets failed on every machine but the author's. Do not repeat that.
The step is **not done** until all of the following are verified by observation:

1. **No `rtk` in committed files.** The `Makefile` and all `package.json` scripts call
   `npm`/`npx` directly. Verify: `grep -rn "rtk" Makefile package.json backend/package.json frontend/package.json`
   returns **zero** matches.
2. **Every `make` target actually runs** — in a shell where `rtk` is **not** on `PATH`:
   - `make help` prints the target list.
   - `make install` installs all Node.js dependencies (`npm install` at the repo root
     installs `backend/` and `frontend/` in one pass via NPM workspaces). It must call
     `npm install` directly; there is **no** `install` script in any `package.json`.
   - `make build` compiles backend + frontend to completion (exit 0).
   - `make test` runs both suites (and must **not** use `--passWithNoTests`).
   - `make lint` runs with **zero** errors (`strict`, `noUnusedLocals`, `noUnusedParameters` all `true`).
   - `make format` completes.
   - `make dev` starts **both** servers: confirm the backend logs its port and the Vite
     dev server prints its URL, then open `http://localhost:3000` and confirm a dark 3D globe
     renders and slowly rotates. Then stop it. (Use timeouts / a background start so a
     long-running server does not block; do not claim success without seeing both servers come
     up and the globe render.)
3. **Single backend port = `4000`.** Backend listens on `4000`; `frontend/vite.config.ts`
   proxies `/api` **and** `/ws` (`ws: true`) to `http://localhost:4000`. No `3001` anywhere.
4. **`getDatabase()` singleton exists** in `backend/src/db/database.ts` (later steps import
   it). `initDatabase()` sets the singleton; `getDatabase()` returns it.
5. **Wrapped response contract** (finalized here, reused by all later steps): endpoints
   return objects, not bare arrays — `{ sources }`, `{ total, limit, offset, entities }`,
   `{ total, limit, offset, observations }`.
6. **Backend boots and answers.** Start the backend and `curl -s localhost:4000/api/sources`
   returns valid JSON (`{ "sources": [...] }`), not a connection error.
7. **Theme:** exactly **one** theme module (`frontend/src/theme.ts`, export `tacticalTheme`),
   green-on-black tactical palette (bg `#000000`/`#0a0a0a`, accent `#00ff9d`, secondary
   `#ff006e`, monospace `JetBrains Mono`). Do not create a second theme file.
8. **Globe renders.** `frontend/src/components/GlobeView.tsx` is a real `Cesium.Viewer` (Stadia
   dark basemap, default widgets off, idle auto-rotate) filling the screen behind the app bar;
   `cesium` + `vite-plugin-cesium` are in `frontend/package.json` and `cesium()` is registered in
   `vite.config.ts`. Verified visually (Cesium needs WebGL — the step-1 unit test stays the pure
   theme test). Not a placeholder card.
9. **No silent catches, no CDN-hotlinked assets, no `err.stack` returned to clients.**
