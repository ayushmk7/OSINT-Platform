# Development

How to install, run, test and check the platform locally. For branch and commit conventions, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- **Node.js 22.22.2 or newer** (or 24.15+). Root `package.json` declares `engines.node >=22.22.2`; the installed dependencies set the floor:
  - `better-sqlite3` 13 requires Node `>=22`.
  - `cesium` 1.144 requires Node `>=22.0.0`.
  - `jsdom` 30, used by the frontend tests, requires `^22.22.2 || ^24.15.0 || >=26.0.0`.
  - CI runs on Node 22.
- **npm** (the repo uses NPM workspaces and ships a `package-lock.json`).
- **make**, optional. Every Makefile target is a thin wrapper around an npm script.
- A C/C++ build toolchain, only if `better-sqlite3` has no prebuilt binary for your platform and Node version and has to compile from source.
- Outbound internet access, for the data feeds and the globe's tile servers (Stadia Maps, ESRI).

## Install

From the repository root:

```bash
make install    # same as: npm install
```

This installs the root, `backend` and `frontend` workspaces in one pass. Most packages, including `cesium`, are hoisted to the root `node_modules/`. `frontend/vite.config.ts` resolves Cesium's real location to account for this.

Do not add an `install` script to any `package.json`. npm runs it as a lifecycle hook during `npm install`, so `make install` would loop forever.

## Running

```bash
make dev        # same as: npm run dev
```

This runs both dev servers with `concurrently`:

| Process | Command | Port | Notes |
| :-- | :-- | :-- | :-- |
| Backend | `tsx watch src/index.ts` (in `backend/`) | 4000 (`PORT`) | REST at `/api/*`, WebSocket at `/ws/telemetry`. Restarts on file changes. |
| Frontend | `vite` (in `frontend/`) | 3000 | Proxies `/api` and `/ws` to `http://localhost:4000`. |

Open http://localhost:3000. The backend logs `MK-OSINT backend running on port 4000 (ws /ws/telemetry)` and then one line per source problem, if there are any.

You can also run one side on its own:

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

The Vite proxy target is hard-coded to `localhost:4000` in `frontend/vite.config.ts`. If you change the backend `PORT`, change the proxy too, or the frontend will not reach the API.

### Production build

```bash
make build      # backend: tsc -> backend/dist; frontend: tsc && vite build -> frontend/dist
npm start --prefix backend   # node dist/index.js
```

With `NODE_ENV=production` (or `MKOSINT_SERVE_FRONTEND=true`) the backend also serves `frontend/dist` on the same port, so one process is the whole app. See [Deployment](#deployment). You can still serve `frontend/dist` from a separate web server that proxies `/api`, `/config.json` and `/ws` (with WebSocket upgrade) to the backend. The frontend only uses relative URLs and derives `ws://` or `wss://` from the page's own scheme.

## Environment variables

All are optional and read by `backend/src/index.ts`. The template is [`backend/.env.example`](../backend/.env.example).

| Variable | Default | Meaning |
| :-- | :-- | :-- |
| `PORT` | `4000` | HTTP and WebSocket port. |
| `SOURCES_DIR` | `<repo>/sources.d` | Directory of source YAML files. The default is computed from the backend's own location, so it works for both `src/` (dev) and `dist/` (build). |
| `DB_PATH` | `mk-osint.db` | SQLite file. A relative path resolves against the process working directory, which is `backend/` under the npm scripts, giving `backend/mk-osint.db`. WAL mode also creates `-wal` and `-shm` files next to it. |
| `INGEST_ENABLED` | enabled | Set to `false` to register sources without polling them. The API and WebSocket still serve whatever is already in the database. Any other value, or leaving it unset, enables ingestion. |
| `MKOSINT_SERVE_FRONTEND` | unset | `true` serves the built frontend from the backend. `false` never does. Unset: served only when `NODE_ENV=production` and the build exists. |
| `MKOSINT_FRONTEND_DIR` | `<repo>/frontend/dist` | Where the built frontend lives. |
| `MKOSINT_APP_NAME` | `MK-OSINT` | Browser tab title, delivered through `/config.json`. |
| `MKOSINT_CESIUM_ION_TOKEN` | unset | Cesium ion access token, delivered through `/config.json` and set as `Cesium.Ion.defaultAccessToken`. Browser-visible by design. |
| `MKOSINT_DEFAULT_GLOBE_STYLE` | `tactical` | Initial globe style: `tactical`, `blue_marble`, `night_lights`, `neon_vector`, `terrain_relief` or `holographic`. Unknown values are ignored. |
| `MKOSINT_DB_MAX_MB` | `500` | Database size ceiling for the retention job. Above it, the oldest observations are pruned until usage is under 90%, then `PRAGMA incremental_vacuum` runs. `0` disables the guard. Shrinking the file on disk needs a database created by this version (`auto_vacuum = INCREMENTAL`). |

`dotenv` loads `.env` from the process working directory. With the npm scripts that is `backend/`, so put overrides in `backend/.env` (it is gitignored) or export them in your shell:

```bash
cp backend/.env.example backend/.env
# or, for one run:
INGEST_ENABLED=false npm run dev --prefix backend
```

Source API keys and other secrets are also environment variables. Source YAML references them as `${NAME}` (or `${NAME:-default}`); a source whose variable is unset is skipped at startup with `source <name> disabled: missing env <NAME>`. Add the keys you have to `backend/.env`; the keys the bundled sources use are listed in `backend/.env.example`. See [Secrets and environment variables](data-sources.md#secrets-and-environment-variables).

To start from an empty database, stop the backend and delete `backend/mk-osint.db*`. The schema is recreated on the next start.

Older checkouts used `backend/recon.db`. It is no longer read (and holds pre-namespacing entity ids); delete it.

## Testing

```bash
make test       # backend (jest) then frontend (vitest)
```

### Backend: Jest

- Config: `backend/jest.config.js` (`ts-jest`, Node environment).
- Tests: `backend/src/__tests__/*.test.ts`. They cover the database, field mapper, HTTP fetcher (including the retry backoff strategies), parsers, REST routes, scheduler, WebSocket server and YAML loader (including validation).
- Run one file: `npx jest src/__tests__/field-mapper.test.ts` from `backend/`.

### Frontend: Vitest

- Config: the `test` block in `frontend/vite.config.ts` (`jsdom` environment, globals on, setup file `src/test/setup.ts`, which registers the `@testing-library/jest-dom` matchers).
- Tests live in `__tests__/` folders next to the code they cover:
  - `frontend/src/__tests__/` (theme)
  - `frontend/src/components/__tests__/` (components, markers, globe styles, selectors, performance HUD)
  - `frontend/src/components/filters/__tests__/` (CRT, NVG and FLIR overlays)
  - `frontend/src/hooks/__tests__/` (`useWebSocket`)
  - `frontend/src/store/slices/__tests__/` (slices)
- `npm test` in `frontend/` runs `vitest run` once. For watch mode, run `npx vitest` from `frontend/`.

## Type checking ("lint")

```bash
make lint       # tsc --noEmit in backend, then in frontend
```

The `lint` scripts are TypeScript type checks only. No ESLint is configured. Both workspaces use `strict` mode with `noUnusedLocals` and `noUnusedParameters`, so unused variables and parameters fail the check.

## Formatting

```bash
make format            # npx prettier --write "**/*.{ts,tsx,json,md,yaml}"
npm run format:check   # prettier --check, same glob; fails if anything is unformatted
```

Settings in `.prettierrc`: single quotes, 100-column print width, no trailing commas.

`.prettierignore` excludes `node_modules/`, `dist/`, `build/` and `package-lock.json`, plus the workshop kit's hand-authored prose and fixtures: `README.md`, `AGENTS.md`, `CLAUDE.md`, `RTK.md`, `docs/`, `tools/` and `skills/`. Source YAML in `sources.d/` is formatted.

CI runs `npm run format:check`, so run `make format` before committing. There is no `make` target for the check.

## Marker icon preview

[`tools/tactical-icon-preview.html`](../tools/tactical-icon-preview.html) is a standalone page with no build step. Open it directly in a browser to inspect the globe's marker silhouettes at large size and at several rotations, which shows how heading rotation looks. It carries its own copy of the Canvas 2D drawing functions, so it does not update automatically when `frontend/src/components/globeMarkers.ts` changes. It covers every canonical category, including the `atc_zone` tower. It does not include the data-driven icon registry (`frontend/src/components/markerIcons.ts`); to eyeball those, import `markerForIcon` from the running dev server in the browser console, or rely on `markerIcons.test.ts`, which checks that every contract icon key draws in its given colour only.

## Deployment

The repository ships a single-container setup: one Node process serves the UI, the REST API and the WebSocket feed on port 4000.

```bash
make docker-up      # docker compose up -d --build
open http://localhost:4000
make docker-down    # docker compose down (the data volume is kept)
make docker-build   # build the image only
```

What the pieces do:

- **`Dockerfile`** (multi-stage, `node:22-slim`). The `build` stage installs all workspaces and runs `npm run build`. The `deps` stage installs only the backend's production dependencies (it has `python3`, `make` and `g++` in case `better-sqlite3` has no prebuilt binary). The runtime stage copies `node_modules`, `backend/dist`, `frontend/dist`, `sources.d` and `analysis.d`, runs as the unprivileged `node` user, and starts `node backend/dist/index.js` directly so that SIGTERM reaches the process.
- **`compose.yaml`** runs service `mk-osint` on port 4000 with a named volume `mk-osint-data` at `/data` (the SQLite database is `/data/mk-osint.db`). `./sources.d` and `./analysis.d` are bind-mounted read-only, so you can edit sources on the host and restart the container without rebuilding. `backend/.env` is loaded if it exists; put API keys and `MKOSINT_*` settings there. `DB_PATH`, `SOURCES_DIR` and `PORT` are fixed by the compose file for the container layout.
- **Health check**: the image's `HEALTHCHECK` calls `GET /api/health` every 30 seconds. `docker inspect mk-osint --format '{{.State.Health.Status}}'` shows the result.
- **Shutdown**: on SIGTERM (`docker stop`, `docker compose down`) the backend stops the scheduler, terminates WebSocket clients, closes the HTTP server and the database, and exits 0. If connections refuse to close, a 5 second backstop still closes the database and exits, well inside Docker's 10 second grace period.

### Static file caching

When the backend serves the frontend, Vite's content-hashed files under `/assets/` get `Cache-Control: public, max-age=31536000, immutable`. Everything else, including `index.html` and Cesium's unhashed `/cesium/*` files, gets `no-cache`, so the browser revalidates with the ETag. Unknown paths without a file extension fall back to `index.html`. `/api/*` and `/ws/*` never fall back, so API 404s stay JSON.

### Runtime config (`/config.json`)

`GET /config.json` returns the client-safe settings the frontend reads once at startup, before the first render:

```json
{ "appName": "MK-OSINT", "cesiumIonToken": null, "defaultGlobeStyle": null }
```

The response is built from an explicit allow-list of the `MKOSINT_*` variables in the table above and sent with `Cache-Control: no-store`. No other environment variable is ever included, so source API keys cannot leak through it. The Vite dev server proxies `/config.json` to the backend, so it works under `make dev` as well. If the request fails or takes longer than 3 seconds, the frontend uses its built-in defaults.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`, on `ubuntu-latest` with Node 22 and the npm cache:

1. `npm ci`
2. `npm run format:check`
3. `npm run lint`
4. `npm test`
5. `npm run build`

To reproduce it locally, run `npm ci && npm run format:check && npm run lint && npm test && npm run build` (or `npm run format:check && make lint test build` on an existing install).
