# PROMPT 6: Full-Stack Integration, Sanity Check & Debug

You are an expert Full-Stack Software Engineer and SRE specializing in end-to-end verification,
systematic debugging, and browser-based visual validation with the Chrome DevTools MCP.

Your task is to generate a Superpowers Spec and Implementation Plan, then execute Step 6 of the
MK-OSINT: a **final integration pass** that assumes steps 1–5 are "done" and
**proves it end-to-end — or fixes whatever is broken.** This step exists because the previous run
marked every task complete while the running app was broken; passing unit tests is not proof.

## Method

Use the **systematic-debugging** skill. For every failing check: reproduce it, find the root
cause (do not patch symptoms), fix it, then re-verify. Use the **Chrome DevTools MCP** for all
visual/runtime checks — screenshots, DOM/canvas inspection, console errors, and the Network tab.

## Instructions & Constraints — the verification matrix

Boot the full stack (`make dev`, with `rtk` NOT on `PATH`) and verify each item. Any failure is a
bug to fix, not a note to leave behind.

1. **Portability & build**
   - `grep -rn "rtk" Makefile package.json backend/package.json frontend/package.json` → zero matches.
   - `make help/build/test/lint/format` all succeed; `make dev` brings up both servers.
   - No `--passWithNoTests`; `tsconfig` keeps `strict` + `noUnusedLocals` + `noUnusedParameters`.

2. **Backend REST**
   - `curl -s localhost:4000/api/sources` → `{ "sources": [...] }` (wrapped).
   - `/api/entities` and `/api/observations` return wrapped objects; category filter works.
   - No error response contains a stack trace.

3. **Ingestion & deduplication**
   - After ~2 min of live ingestion: `observations` count ≈ `count(DISTINCT entity_id||timestamp)`;
     the observations/entities ratio is bounded (not thousands per entity).
   - The scheduler reads `recording.mode`; the idempotency test passes.
   - `entities.category` values ⊆ `{satellite, aircraft, geological, radiation, maritime}`.
   - No entities plotted at `(0,0)`.

4. **WebSocket real-time**
   - Browser connects to `/ws/telemetry` (through the Vite `/ws` proxy) — Network tab shows the
     socket open, `initial_state` received, then `entity_update` frames.
   - The `initial_state` snapshot contains **every** category present in the DB.
   - No per-record `observation` flood.

5. **Globe (CesiumJS) — visual**
   - The Cesium canvas renders a real dark map (recognizable coastlines on zoom), not a fixed
     texture or blank sphere.
   - There is ≥1 tactical silhouette billboard for **each** live category — not only aircraft.
   - Clicking a marker opens the inspector; observation history loads over REST.

6. **HUD / filters — visual**
   - One top bar; drawer button, title, connection chip, and OFF/CRT/NVG/FLIR selector all visible
     and clickable. Drawer opens.
   - Each filter toggles its overlay; the globe underneath still drags/zooms (overlays
     `pointer-events: none`).

7. **Code-quality sweep**
   - No empty `catch` blocks (`grep -rn "catch" backend/src frontend/src` → each logs).
   - No `any` at integration boundaries (Cesium, WS, ingestion).
   - No dead RTK-Query layer — the REST hooks are actually used.
   - No `console`-error output on load.

## Format Requirements
1. First, create `docs/superpowers/specs/06-integration-debug-spec.md`.
2. Second, create `docs/superpowers/plans/06-integration-debug-plan.md`.
3. Then execute: run the matrix, fix each failure (systematic-debugging), re-verify, and capture
   Chrome DevTools screenshots as evidence.

## Analysis Steps
1. Enumerate the verification matrix above as a checklist (one item per check).
2. Boot the stack; run the non-visual checks (grep/curl/make/DB queries) first.
3. Run the visual checks with the Chrome DevTools MCP; screenshot each.
4. For each failure: reproduce → root cause → fix → re-verify. Never patch a symptom.
5. Produce a short pass/fail report with screenshots and the fixes applied.

## Input Data
=============================================
Project Target: MK-OSINT — final integration & debug pass
Preconditions: Steps 1–5 implemented.
Tools: make, curl, sqlite3, Chrome DevTools MCP (screenshots, console, network), systematic-debugging.
Backend port: 4000. Frontend dev: 3000. WS path: /ws/telemetry. Vite proxies /api and /ws (ws:true).
Categories: satellite | aircraft | geological | radiation | maritime.
=============================================

## Hard Requirements & Definition of Done

Step 6 is **done** only when:
1. Every item in the verification matrix passes, evidenced by Chrome DevTools screenshots (globe
   with markers of multiple categories; header with all controls; each filter overlay) and a clean
   browser console.
2. Every issue found during the pass has been **fixed and re-verified** (not merely logged).
3. A short written report lists each check, its status, and any fix applied.
