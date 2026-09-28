# Design: MK-OSINT Workshop — Harness Hardening

**Date:** 2026-07-27
**Status:** Approved (drives edits to AGENTS.md, PROMPT_1..6, specs/01..06, plans/01..06)
**Author:** Workshop maintainers

> This document is the source of truth for a hardening pass over the workshop's
> vibe-coding harness. It exists because a full end-to-end run of the five prompts
> (branch `gemini-vibe-coding`) shipped an app that was broken in ways the harness
> failed to catch. It records the root causes, the shared contracts every prompt
> must obey, and the per-document fixes + verification gates being added.
>
> It does **not** modify the three original planning artifacts
> (`docs/INSTRUCTIONS.md`, `specs/2026-07-26-...-design.md`, `plans/2026-07-26-...-plan.md`).

---

## 1. The meta-insight

A full run produced an app that *looked* complete — green unit tests, checked-off
tasks — but was broken on launch. Every defect fell into one of two buckets:

**Bucket A — the specs/plans prescribed something wrong:**
- `rtk` (an agent-side, machine-local shell wrapper) was written into the committed
  `Makefile`, so `make dev` dies with `rtk: command not found` on any other machine.
- The ingestion spec defines a per-source `recording.mode` but its reference SQL
  hardcodes a plain, mode-blind `INSERT` — so observations duplicate without bound
  (372,114 observation rows for 10,347 entities from 4 sources).
- `GlobeView.tsx` was specified/left as a **stub** (a `<Box>` that renders the text
  "3D GLOBE ENGINE READY") — nothing renders because nothing was built.
- No imagery requirement → the globe used a single fixed low-res texture.
- Entity `category` strings diverge between the ingestion YAML
  (`military_aircraft`, `radiation_sensor`) and the frontend
  (`aircraft`, `radiation`) — so category filters match nothing.

**Bucket B — integration/runtime defects a single "launch it and look" gate would catch,**
but which were **structurally hidden** by:
- empty `catch (_) {}` blocks that swallow errors with no log,
- `jest --passWithNoTests` (a suite reports success with zero tests),
- `noUnusedLocals`/`noUnusedParameters` set to `false` and `lint` being bare `tsc`
  (no ESLint) — so dead code and `any` sail through,
- "review" that only ever inspected the generated docs, never a running app.

**Therefore the hardening has two levers:**
1. **Correct the wrong prescriptions** (Bucket A).
2. **Add mandatory runtime + visual verification gates** so "done" means *observed
   working*, not *tests pass* — and remove the mechanisms that hide failure (Bucket B).

The git history of the failed branch is the proof: a clean run of `feat(...)` "done"
commits followed by a late cluster of `fix(...)` commits
(`fix(globe): resolve websocket vite proxy, category matching…`,
`fix(header): unify top bar and render visible cyan drawer button`,
`fix … dynamically resolve ws/wss`, `fix(root): prefix concurrently and prettier with npx`)
— every one a runtime defect only visible when the app is actually launched.

---

## 2. Shared contracts (defined once, referenced by every prompt)

These are enforced in `AGENTS.md` and repeated in each prompt's Hard Requirements.

### 2.1 The `rtk` boundary (critical)
`rtk` is the **agent's interactive shell wrapper** for saving tokens while the agent
works. It is **machine-local and personal**. It MUST NOT appear in any committed
file — not in `Makefile`, `package.json` scripts, CI config, or code.
- Committed build tooling calls package managers directly: `npm run …`, and
  `npx concurrently`/`npx prettier` for tools that may not be global.
- **Verification:** `grep -rn "rtk" Makefile package.json backend/package.json frontend/package.json`
  returns zero matches, AND `make help && make build` complete in a shell where
  `rtk` is not on `PATH`.

### 2.2 Ports
Single backend port constant **`4000`**. The backend listens on 4000; the Vite dev
proxy targets `http://localhost:4000`; every doc/example uses 4000. (The old
`3001` references are removed.) Frontend dev server: `3000`.

### 2.3 WebSocket path
One canonical constant shared by client and server:
`WS_PATH = "/ws/telemetry"`.
- Backend `WebSocketServer({ server, path: WS_PATH })`.
- Client connects to `${wsProto}://${window.location.host}${WS_PATH}` where
  `wsProto = location.protocol === "https:" ? "wss" : "ws"`.
- Vite dev proxy MUST proxy the `/ws` prefix with `ws: true` to the backend.

### 2.4 Category vocabulary (single shared enum)
```
type Category = "satellite" | "aircraft" | "geological" | "radiation" | "maritime";
```
- Source YAML `entity.category` values MUST be exactly these strings
  (`adsb_military` → `aircraft`, `safecast_radiation` → `radiation`).
- Frontend color map, filter list, and icon map MUST key off exactly this set.
- Every advertised UI category MUST have ≥1 enabled source. `maritime` gets a real
  AIS/vessel source (`sources.d/aisstream.yaml` or equivalent) **or** is removed
  from the UI — no category may be advertised with no backing data.
- **Verification:** the set of `category` strings in `sources.d/*.yaml` is a subset
  of the enum, and every enum member the UI advertises maps to an enabled source.

### 2.5 Visual identity (green-on-black tactical), one theme file
- Background `#000000` / paper `#0a0a0a`; accent (primary) `#00ff9d`;
  secondary `#ff006e`; text `#ffffff` / `#888888`.
- Typography: monospace everywhere — `"JetBrains Mono", "SF Mono", "Fira Code", monospace`.
- Exactly **one** theme module (`frontend/src/theme.ts`, export `tacticalTheme`).
  No second theme file; no `darkTheme` vs `tacticalTheme` split.
- Category marker colors:

  | Category | Color |
  |---|---|
  | `satellite` | `#00f3ff` (cyan) |
  | `aircraft` | `#ffaa00` (amber) |
  | `geological` | `#ff0055` (crimson) |
  | `radiation` | `#ffcc00` (yellow) |
  | `maritime` | `#4fc3f7` (azure) |

### 2.6 Globe + markers
- **CesiumJS** (`cesium ^1.143`, `vite-plugin-cesium`), a raw `Viewer` created in a
  React `useEffect` and held in a ref (not resium components, not a fixed sphere).
- Basemap default: **Stadia "Alidade Smooth Dark"** via `UrlTemplateImageryProvider`
  (`https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png`,
  `maximumLevel: 18`), created by a **factory** (StrictMode double-invoke safety).
  Optional upgrade: Cesium Ion World Imagery when `VITE_CESIUM_ION_TOKEN` is set.
- Viewer options: `requestRenderMode: true`, `maximumRenderTimeChange: 0.5`,
  `scene3DOnly: true`, `shouldAnimate: true`, `shadows: false`, all default widgets
  disabled (`timeline/animation/geocoder/homeButton/sceneModePicker/baseLayerPicker/
  navigationHelpButton/fullscreenButton/vrButton/infoBox/selectionIndicator: false`);
  container `background: #000`; hide `.cesium-viewer-bottom`.
- Markers: one **tactical filled silhouette per category**, drawn directly with Canvas 2D
  (`drawX(ctx, color)`, no icon library, no disc/ring) onto a 2× canvas and used as a
  Cesium **billboard** image with `Color.WHITE` (color baked in). Aircraft **and maritime**
  billboards rotate to `heading` (`alignedAxis = Cartesian3.UNIT_Z`). Position via
  `Cartesian3.fromDegrees(lon, lat, alt)`.
- shape → category:

  | Category | Tactical shape |
  |---|---|
  | `satellite` | diamond |
  | `aircraft` | top-down airplane |
  | `geological` | earthquake epicenter (seismic rings) |
  | `radiation` | radiation trefoil |
  | `maritime` | top-down vessel |

- Selection: canvas **corner-bracket reticle** in `#00ff9d` + a live coordinate
  readout label (`DD.dddd° N/S  DD.dddd° W/E`); hover sets pointer cursor.

### 2.7 Z-index layering contract (kills the "header not visible" bug)
Exactly one header/HUD stack, documented and ordered:
```
globe canvas        z 0
cinematic overlays  z 10   (pointer-events: none)
HUD / header        z 20
drawers / modals    z 1200 (MUI defaults)
```
There is **one** top bar. The `TelemetryStatsBanner` is either the single top bar or
lives inside it — never an absolutely-positioned banner painting over a second
`AppBar`. The drawer-open button, title, connection chip, and filter selector are all
part of that one bar and must be visible and clickable.

### 2.8 "Definition of Done" gate (applies to every prompt)
A task is not done until:
- all relevant `make` targets run to completion with `rtk` **not** on `PATH`;
- for any backend change: the described runtime behavior is exercised and observed
  (not just unit-tested);
- for any frontend/UI change: the running app is inspected with **chrome-devtools MCP**
  — screenshot taken, target DOM/canvas present, **console has no errors**, and the
  specific acceptance checks for that prompt pass;
- no empty `catch` blocks (every catch logs with context);
- `jest`/`vitest` never run with `--passWithNoTests`;
- `tsconfig` keeps `strict`, `noUnusedLocals`, `noUnusedParameters` = `true`;
- no `rtk` in committed files; no CDN-hotlinked runtime assets; no `err.stack`
  returned to HTTP clients.

---

## 3. Per-document issue → fix mapping

### PROMPT 1 / spec 01 / plan 01 — Project Setup
| # | Issue (evidence) | Fix / hard requirement |
|---|---|---|
| 1.1 | `rtk` baked into committed `Makefile` (`plan 01` writes `dev: rtk npm run dev`); dies on any machine without `rtk`. `concurrently`/`prettier` assumed global. | Makefile targets call `npm run …` directly; use `npx concurrently`/`npx prettier`. Add §2.1 grep gate + "run every target with `rtk` off PATH". `make dev` verified by start→confirm both servers→kill. |
| 1.2 | `plan 03` imports `getDatabase()` from `db/database`, but `plan 01` only exports `initDatabase`/`closeDatabase` → won't compile. | `database.ts` exposes a module-singleton `getDatabase()` (and `initDatabase` sets it). |
| 1.3 | Port drift: backend `4000` vs spec03/prompt3 `3001`. | Pin `4000` everywhere (§2.2). |
| 1.4 | Response contract drift: plan 01 returns bare arrays; plan 03 returns wrapped objects. | State the wrapped contract once (`{sources}`, `{total,limit,offset,entities}`, `{total,limit,offset,observations}`); plan 01's throwaway routes match it. |
| 1.5 | `vite.config` only proxies `/api`. | Add `/ws` proxy with `ws:true` now (§2.3). |
| 1.6 | No verification that the app boots. | DoD gate §2.8; add "boot backend, curl `/api/sources`, see JSON" check. |

### PROMPT 2 / spec 02 / plan 02 — Ingestion (deduplication)
| # | Issue (evidence) | Fix / hard requirement |
|---|---|---|
| 2.1 | `field-mapper` obs id = `obs_${extId}_${Date.now()}_${random}` → every insert unique → no dedup possible. | Deterministic id `obs_${entity_id}_${sourceTimestampMs}`. |
| 2.2 | `recording.mode` parsed but **never read** by scheduler; spec §4.5 hardcodes plain `INSERT`. | Rewrite spec §4.5 + scheduler to branch on `recording.mode`. `append`: `UNIQUE(entity_id, timestamp)` + `INSERT OR IGNORE`. `upsert`: `ON CONFLICT(id) DO UPDATE`. Grep-assert `recording` referenced in `scheduler.ts`. |
| 2.3 | Uses `now()`/current time for timestamps → dedup key never repeats (esp. `adsb` `timestamp: "now"`). | Use the source's real observation timestamp; only fall back to `now()` when the source truly provides none, and in that case dedup on `(entity_id, rounded position)`. |
| 2.4 | Entity upsert overwrites good coords with `0` on a missing field; first-seen missing coords → `(0,0)` Gulf of Guinea. | Records with no valid position are skipped (logged), not plotted at `(0,0)`; upsert preserves last-known coords when a poll omits them. |
| 2.5 | Literal mappings unsupported (`altitude: "0"` treated as a path). | Field mapper supports literal/constant values distinctly from paths. |
| 2.6 | Category strings non-canonical (`military_aircraft`, `radiation_sensor`). | YAML `category` values use the §2.4 enum exactly. |
| 2.7 | No idempotency test. | **Acceptance test:** poll the same fixture ≥5× → `COUNT(*) observations` == number of distinct `(entity_id, timestamp)`, not `polls × records`. |
| 2.8 | Unbounded growth. | Retention policy: cap observations per entity (e.g. keep newest N) or TTL; documented. |

### PROMPT 3 / spec 03 / plan 03 — REST API + WebSocket
| # | Issue (evidence) | Fix / hard requirement |
|---|---|---|
| 3.1 | No `/ws` dev proxy; canonical WS path never pinned. | §2.3 — one path constant; `/ws` proxy `ws:true`. |
| 3.2 | Broadcaster never wired to scheduler; `index.ts` uses `app.listen` (no `http.Server` for WS). | `index.ts` composes `http.createServer(app)` + `setupWebSocketServer(server)` + starts the scheduler; scheduler calls `broadcaster.broadcastEntityUpdate` **only when an entity is new or its position changed**. |
| 3.3 | Initial WS snapshot `getEntities({limit:500}) ORDER BY timestamp DESC` + `adsb timestamp:"now"` → 5000 aircraft monopolize the top 500; other categories never appear. | **Balanced initial snapshot**: cap per category (e.g. N newest per category) so every category is represented. |
| 3.4 | Broadcasts a per-record `observation` for every record every poll (up to 5000×2/30s); frontend never handles `observation`. | Drop the per-record `observation` broadcast (or make it opt-in and actually consumed). Globe runs on `entity_update` only. |
| 3.5 | RTK Query REST layer is entirely dead code (UI is WS-only) — prompt-3 deliverable untested by UI. | Wire `getObservations` into the entity inspector (observation history) so REST is real and exercised. |
| 3.6 | Route error handlers return `err.stack`/`String(err)` in `details` → info disclosure. | Never return stack traces to clients; gate verbose detail behind `NODE_ENV !== 'production'`, log server-side. |
| 3.7 | Port `3001` vs `4000`. | Pin `4000` (§2.2). |

### PROMPT 4 / spec 04 / plan 04 — Frontend Globe (largest change)
| # | Issue (evidence) | Fix / hard requirement |
|---|---|---|
| 4.1 | `GlobeView.tsx` is a **stub** — no globe engine, no markers. | Real **CesiumJS** viewer per §2.6; add `cesium` + `vite-plugin-cesium` deps. |
| 4.2 | Fixed low-res texture (orig CDN-hotlinked `unpkg` night jpg). | Stadia dark basemap (no key); no hotlinked runtime assets. |
| 4.3 | Only aircraft render — category mismatch (2.4) + saturated snapshot (3.3) + `maritime` has no source + silent `catch(_){}` hides globe errors. | Canonical categories; balanced snapshot; real maritime source or drop it; log all globe errors. |
| 4.4 | No icon system / no tactical style defined. | Canvas-2D tactical silhouette markers (filled shapes, no disc), category colors, corner-bracket selection (§2.6); green-on-black theme (§2.5), one theme file. |
| 4.5 | No visual verification. | **Mandatory chrome-devtools gate:** load app; assert Cesium canvas present; assert ≥1 marker for **each** of the 5 categories; console error-free; click a marker → inspector opens; capture screenshot. |
| 4.6 | `useWebSocket` hardcodes `ws://`. | Derive `ws`/`wss` from `location.protocol` (§2.3). |
| 4.7 | `any` all over GlobeView; vite `as any`. | Type the Cesium usage; no `as any` on config. |

### PROMPT 5 / spec 05 / plan 05 — Cinematic Filters & Polish
| # | Issue (evidence) | Fix / hard requirement |
|---|---|---|
| 5.1 | Two competing top bars: MUI `AppBar` + absolute `TelemetryStatsBanner` (z1100) painting over it → drawer button/title/filters hidden. | One header + §2.7 z-index contract; controls visible & clickable. |
| 5.2 | `useAppDispatch`/`useAppSelector` imported but never created → compile error. | Create typed hooks in `store/hooks.ts`; export from store. |
| 5.3 | Theme split (`darkTheme` vs `tacticalTheme`). | One theme file (§2.5). |
| 5.4 | `useWebSocket('/ws/telemetry')` passes a string to an options-object hook; drops `isReconnecting`. | Correct call signature; thread `isReconnecting`. |
| 5.5 | Dead imports masked by `noUnusedLocals:false`. | Keep no-unused checks `true`; remove dead imports. |
| 5.6 | No visual verification of filters/header. | **Mandatory chrome-devtools gate:** header controls visible+clickable; drawer opens; each of OFF/CRT/NVG/FLIR toggles and its overlay appears; globe still drag/zoom interactive (overlays `pointer-events:none`). |
| 5.7 | Scope. | Pragmatic subset: keep CSS CRT/NVG/FLIR; clustering/LOD-binning, 3D buildings, dead-reckoning, occlusion-fade, cinematic drift are **stretch goals**, called out but not required. |

### PROMPT 6 (new) / spec 06 / plan 06 — Integration & Debug (sanity check)
A dedicated final pass that assumes prompts 1–5 are "done" and proves it — or fixes it.
Uses `systematic-debugging`. Checks:
- all `make` targets pass with `rtk` off `PATH`;
- DB dedup sanity: obs/entity ratio is bounded; the poll-twice idempotency test holds;
- WS connects, `initial_state` received, **every** category present in the snapshot;
- globe renders ≥1 marker for each of the 5 categories (chrome-devtools screenshots);
- header/drawer/filters visible & interactive; globe interactive under each filter;
- console error-free on load;
- code-quality sweep: no `rtk` in committed files, no empty catches, no `any` at
  integration boundaries, no `--passWithNoTests`, no dead RTK-Query layer, no
  stack-trace leaks;
- **then fix every issue found** and re-verify.

---

## 4. AGENTS.md changes (global)
- Reframe the RTK rule with the §2.1 boundary (agent shell only; never committed).
- Add "Verification is behavioral, not just unit tests" — the §2.8 DoD gate.
- Add: no stubs/placeholders; no silent catches; no CDN-hotlinked assets; no
  stack-trace leaks; keep no-unused + strict; ban `--passWithNoTests`.
- Add the shared contracts (port, WS path, category enum, palette, z-index).
- Add chrome-devtools visual-verification as a required step for any UI work.

## 5. Verification gate template (reused in each prompt/spec/plan)
Each prompt ends with a **Hard Requirements & Definition of Done** section; each plan
ends with an expanded **Verification & Final Audit** task containing the concrete,
checkable steps (commands + expected observations, including chrome-devtools checks)
for that step. The language is "verify by observing X", never "should work".

## 6. Out of scope
- The three original artifacts named in the brief are left untouched.
- No implementation of the app itself here — only the harness (prompts/specs/plans).
- Stretch-goal fidelity items (clustering, buildings, drift) are noted, not required.
