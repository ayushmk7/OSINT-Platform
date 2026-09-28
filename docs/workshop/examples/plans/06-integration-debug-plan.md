# Implementation Plan: 06 - Full-Stack Integration, Sanity Check & Debug

This plan executes the final end-to-end verification of the MK-OSINT and fixes
any defect it surfaces. It uses the **systematic-debugging** skill for every fix and the **Chrome
DevTools MCP** for all visual/runtime evidence. "Done" means observed working, not "tests pass."

> Guiding rule: when a check fails, reproduce → root cause → fix → re-verify. Never patch a symptom
> (do not widen a `catch`, disable a lint rule, `--passWithNoTests`, or hardcode data to pass).

---

## Task 1: Boot & non-visual checks

- [ ] **Step 1.1: Portability & build (with `rtk` NOT on PATH)**
  ```
  grep -rn "rtk" Makefile package.json backend/package.json frontend/package.json   # expect: no output
  make build && make lint && make test                                              # expect: all exit 0
  ```
  Fix any target that fails (common cause: `rtk`/global binary assumed in a committed file — use
  `npm`/`npx`).

- [ ] **Step 1.2: Start the stack**
  ```
  make dev
  ```
  Confirm the backend logs `:4000 (ws /ws/telemetry)` and the Vite dev server prints its URL.

- [ ] **Step 1.3: Backend REST contracts**
  ```
  curl -s localhost:4000/api/sources | head
  curl -s "localhost:4000/api/entities?category=aircraft" | head
  curl -s "localhost:4000/api/observations?entity_id=<id>" | head
  ```
  Expect wrapped objects (`{ "sources": ... }`, `{ "total": ..., "entities": ... }`,
  `{ "total": ..., "observations": ... }`). Confirm no response contains a stack trace.

- [ ] **Step 1.4: Deduplication sanity (after ~2 min of ingestion)**
  ```
  sqlite3 mk-osint.db "SELECT count(*) FROM observations;"
  sqlite3 mk-osint.db "SELECT count(DISTINCT entity_id||timestamp) FROM observations;"
  sqlite3 mk-osint.db "SELECT count(*) FROM entities;"
  sqlite3 mk-osint.db "SELECT DISTINCT category FROM entities;"
  sqlite3 mk-osint.db "SELECT count(*) FROM entities WHERE latitude=0 AND longitude=0;"
  ```
  Expect: observations ≈ distinct(entity_id||timestamp); bounded obs/entity ratio; categories ⊆
  `{satellite, aircraft, geological, radiation, maritime}`; zero `(0,0)` rows.
  If observations ≫ distinct, the dedup (deterministic id / `recording.mode` / `INSERT OR IGNORE`)
  regressed — fix in the ingestion engine.

---

## Task 2: WebSocket & real-time (Chrome DevTools MCP)

- [ ] **Step 2.1: Socket connects and streams**
  Open the app in the browser (Chrome DevTools MCP). In the **Network** tab, confirm the
  `/ws/telemetry` socket opens (status 101) through the Vite `/ws` proxy. Inspect frames:
  - an `initial_state` frame arrives, and its `data.entities` includes **every** category present
    in the DB (not just aircraft);
  - `entity_update` frames arrive as ingestion proceeds;
  - there is **no** flood of `observation` messages.
  If the socket fails: check the Vite `/ws` proxy (`ws: true`) and that `index.ts` wired
  `scheduler.onEntityUpdate → broadcaster`.

---

## Task 3: Globe visual verification (Chrome DevTools MCP)

- [ ] **Step 3.1: Real map + all categories**
  Take a **screenshot**. Confirm:
  - the Cesium canvas shows a **real dark basemap** (zoom in — coastlines/terrain are recognizable),
    not a fixed sphere texture and not a blank globe;
  - tactical silhouette billboards are visible for **each** live category (satellite, aircraft,
    geological, radiation; maritime if a source exists) — "only aircraft" is a failure;
  - the browser **console has zero errors**.
  If markers are missing for a category: check the shared category enum (source YAML vs frontend)
  and the balanced initial snapshot.

- [ ] **Step 3.2: Selection + REST**
  Click a marker → the inspector opens with details, and the **observation history** list populates
  (this exercises the REST endpoint). Screenshot.

---

## Task 4: HUD / filters visual verification (Chrome DevTools MCP)

- [ ] **Step 4.1: Header controls all visible**
  Screenshot the top bar. Confirm ONE bar contains a visible, clickable drawer button, title,
  connection chip, and OFF/CRT/NVG/FLIR selector. Click the drawer button → the layer drawer opens
  (category filters + source toggles). If any control is hidden, check for a second absolutely-
  positioned banner over the `AppBar` and the z-index contract.

- [ ] **Step 4.2: Filters toggle; globe stays interactive**
  Switch OFF→CRT→NVG→FLIR; screenshot each. Confirm the overlay appears and the globe underneath
  **still drags/zooms** (overlays `pointer-events: none`). Console stays clean.

---

## Task 5: Code-quality sweep

- [ ] **Step 5.1: Automated greps**
  ```
  grep -rn "catch (_)\|catch {}\|catch ( _ )" backend/src frontend/src   # empty catches: fix each to log
  grep -rn ": any" frontend/src/components/GlobeView.tsx backend/src/websocket  # boundary any: type it
  grep -rn "err.stack\|\.stack" backend/src/api                          # stack leaks: remove
  grep -rn "useGet.*Query" frontend/src                                  # confirm RTK-Query hooks are USED
  grep -rn "passWithNoTests" backend frontend                            # expect none
  ```
  Fix everything these surface.

---

## Task 6: Report

- [ ] **Step 6.1: Pass/fail report with evidence**
  Produce a table mirroring the spec's verification matrix (§3): each check, status, and any fix
  applied with its root cause. Attach the Chrome DevTools screenshots (globe with multi-category
  markers; header with all controls; each filter overlay) and the DB dedup query output.

- [ ] **Step 6.2: Final gate**
  Re-run `make test` and `make lint` (0 errors), and confirm every matrix row is green with the
  running app observed working. Only then is the platform "done".
