# PROMPT 4: Frontend 3D Globe Dashboard & Real-Time Telemetry HUD

You are an expert Full-Stack & Frontend Software Engineer specializing in React 18, TypeScript, Redux Toolkit, RTK Query, Material UI (MUI), WebSockets, and 3D geospatial visualization with **CesiumJS**.

Your task is to generate a Superpowers Spec and Implementation Plan, then execute Step 4 of the ReconVillage OSINT Platform: **extending the simple CesiumJS globe built in step 1** into a full React + Redux Toolkit + MUI + **CesiumJS** 3D Globe dashboard — adding state management, RTK Query endpoints, a real-time WebSocket hook, **tactical filled-silhouette markers on the existing globe**, layer controls, an entity inspector drawer, and a telemetry stats banner. You are building on the frontend students already have, not starting the globe from scratch.

> **This is the step that failed hardest before.** The previous run shipped a `GlobeView`
> that was a placeholder `<Box>` rendering the text "3D GLOBE ENGINE READY" — no globe engine,
> no markers, nothing. It "passed" because a unit test only checked that placeholder text
> existed. Under no circumstances is a stub acceptable here; the globe must actually render and
> you must verify it visually with the Chrome DevTools MCP.

## Instructions & Constraints
- **Redux Toolkit Store & State Management**:
  - `frontend/src/store/index.ts`: Configures Redux store combining `entitiesSlice`, `sourcesSlice`, and `osintApi` middleware.
  - `frontend/src/store/slices/entitiesSlice.ts`: State management for entity collection (`entities`), active layer filtering (`activeCategoryFilter`), entity selection (`selectedEntityId`), and real-time payload upserts.
  - `frontend/src/store/slices/sourcesSlice.ts`: State management for enabled data source layers (`enabledSourceIds`, toggle actions).
  - `frontend/src/store/api/osintApi.ts`: RTK Query endpoints querying REST API (`GET /api/sources`, `GET /api/entities`, `GET /api/observations`).
- **Real-Time Telemetry Hook**:
  - `frontend/src/hooks/useWebSocket.ts`: Custom React hook connecting to `/ws/telemetry`, handling connection state, auto-reconnect with backoff, heartbeat ping/pong handling, calculating message rate (msgs/sec), and dispatching `initial_state` and `entity_update` payloads directly to Redux.
- **3D Globe Visualization (CesiumJS — real map, not a fixed texture)**:
  - `frontend/src/components/GlobeView.tsx` **already exists from step 1** — a raw `Cesium.Viewer`
    in a `useEffect`/ref with the **Stadia "Alidade Smooth Dark"** basemap (no API key; Cesium Ion
    World Imagery is an optional upgrade when `VITE_CESIUM_ION_TOKEN` is set), default widgets off,
    black background, credit bar hidden, and an idle attract-mode spin. **Extend that same
    component** — do not recreate it — adding the Redux wiring, the `BillboardCollection`, and
    click-to-select. (`cesium` + `vite-plugin-cesium` are already installed and registered from
    step 1.)
  - Markers: a **tactical filled silhouette per category, drawn directly with Canvas 2D** (no
    icon library, no disc/ring) — `satellite`→diamond, `aircraft`→airplane, `geological`→seismic
    rings, `radiation`→trefoil, `maritime`→vessel — each a `drawX(ctx, color)` function that fills
    the shape in the category color with a black inset cutout and a center dot. Rasterize onto a
    **2× `<canvas>`** and use as a Cesium **billboard** with `Color.WHITE` (color is baked in);
    aircraft **and ships** rotate to `heading` (`alignedAxis = Cartesian3.UNIT_Z`). Position via
    `Cartesian3.fromDegrees(lon, lat, alt)`. Click a marker → select it (opens the inspector).
    - **The billboard image MUST be a raster PNG (or a `<canvas>`), NEVER an `image/svg+xml`
      data-URI.** Cesium's texture atlas decodes billboard images with `createImageBitmap()`,
      and Chromium's `createImageBitmap` **cannot decode SVG** — it throws
      `InvalidStateError: The source image could not be decoded.`, which stops Cesium's render
      loop and shows the overlay "An error occurred while rendering. Rendering has stopped."
      Drawing the silhouette straight to a `<canvas>` and using `canvas.toDataURL("image/png")`
      keeps it a raster PNG that decodes cleanly across browsers.
  - Categories are the shared enum exactly: `satellite | aircraft | geological | radiation | maritime`.
- **Tactical MUI HUD Components**:
  - `frontend/src/components/LayerControlDrawer.tsx`: MUI sidebar drawer to toggle layer visibility for data sources and entity categories.
  - `frontend/src/components/EntityDetailsDrawer.tsx`: Inspector drawer showing detailed metadata, coordinates, altitude, speed, heading, timestamp, and raw JSON telemetry history for the selected entity.
  - `frontend/src/components/TelemetryStatsBanner.tsx`: Top bar displaying live WebSocket connection status (Connected/Disconnected/Reconnecting), message rate gauge, and active entity count badge.
- **Superpowers Alignment**: Create `docs/superpowers/specs/04-frontend-globe-dashboard-spec.md` and `docs/superpowers/plans/04-frontend-globe-dashboard-plan.md` first, then follow TDD to execute the plan.
- **RTK Usage**: All shell commands must be prefixed with `rtk` (e.g., `rtk npm test`, `rtk tsc`, `rtk make test`).

## Format Requirements
1. First, create the technical spec file at `docs/superpowers/specs/04-frontend-globe-dashboard-spec.md`.
2. Second, create the step-by-step TDD implementation plan at `docs/superpowers/plans/04-frontend-globe-dashboard-plan.md`.
3. Finally, execute the implementation plan step-by-step, verifying with `rtk make test` and `rtk make lint`.

## Analysis Steps
1. Review REST API schemas (`/api/sources`, `/api/entities`, `/api/observations`) and WebSocket protocol events (`initial_state`, `entity_update`, `observation`).
2. Design Redux Toolkit slices (`entitiesSlice`, `sourcesSlice`) and RTK Query service (`osintApi`).
3. Formulate custom `useWebSocket` hook lifecycle for auto-reconnection and Redux store synchronization.
4. Establish 3D Globe rendering logic, category color mapping, and position trail arcs.
5. Construct MUI tactical dark theme HUD components (`LayerControlDrawer`, `EntityDetailsDrawer`, `TelemetryStatsBanner`).
6. Build comprehensive test suites (`entitiesSlice.test.ts`, `useWebSocket.test.ts`, `GlobeView.test.tsx`).

## Input Data
=============================================
Project Target: ReconVillage Frontend 3D Globe & OSINT Dashboard
Stack: Vite, React 18, TypeScript, Redux Toolkit, RTK Query, Material UI (green-on-black tactical dark theme), CesiumJS (+ vite-plugin-cesium), WebSockets. Markers are drawn with Canvas 2D (no icon library).

Component & File Breakdown:
- `frontend/src/store/index.ts`: Redux Store setup
- `frontend/src/store/slices/entitiesSlice.ts`: Entities state, filtering, selection
- `frontend/src/store/slices/sourcesSlice.ts`: Data source layer toggles
- `frontend/src/store/api/osintApi.ts`: RTK Query REST endpoints (/api/sources, /api/entities, /api/observations)
- `frontend/src/hooks/useWebSocket.ts`: Real-time WebSocket connection to /ws/telemetry
- `frontend/src/components/GlobeView.tsx`: Interactive CesiumJS globe with tactical filled-silhouette billboard markers (satellites, aircraft, earthquakes, radiation, ships)
- `frontend/src/components/LayerControlDrawer.tsx`: Sidebar drawer for layer toggles
- `frontend/src/components/EntityDetailsDrawer.tsx`: Tactical metadata inspector drawer (loads observation history via RTK Query `getObservations`)
- `frontend/src/components/TelemetryStatsBanner.tsx`: Top bar telemetry stats & connection status gauge
=============================================

## Hard Requirements & Definition of Done

Step 4 is **done** only when verified — including a **mandatory visual check with the Chrome
DevTools MCP** (this step's failures were all things "launch it and look" would have caught):

1. **Real CesiumJS globe** — `GlobeView` creates a `Cesium.Viewer` with the Stadia dark
   basemap. It is NOT a placeholder, NOT globe.gl, NOT a fixed sphere texture. `cesium` and
   `vite-plugin-cesium` are in `package.json`; `vite.config.ts` registers the cesium plugin.
2. **Markers render for EVERY category.** After connecting, the globe shows ≥1 tactical
   silhouette billboard for **each** of `satellite, aircraft, geological, radiation, maritime`
   (any category with a live source). "Only aircraft show" is a failure. Billboard images are
   raster PNG/canvas —
   `grep -rn "image/svg" frontend/src` returns **zero** matches (an SVG billboard crashes the
   Cesium render loop with `InvalidStateError: The source image could not be decoded.`).
3. **Visual verification (required).** Using the Chrome DevTools MCP: navigate to the app, take
   a screenshot, confirm the Cesium canvas is present and shows a real dark map, confirm markers
   of multiple colors/icons are visible, and confirm the browser **console has no errors**.
   Click a marker → the entity inspector opens with its details.
4. **WebSocket live.** The dashboard actually populates: `initial_state` fills the store and
   `entity_update` frames move markers. The `useWebSocket` hook derives `ws`/`wss` from
   `location.protocol` and connects on `/ws/telemetry` (through the Vite `/ws` proxy).
5. **REST exercised.** The inspector loads observation history via RTK Query `getObservations`
   (the REST layer is not dead code).
6. **Theme.** Uses the single green-on-black `tacticalTheme` from `frontend/src/theme.ts`
   (do not create a second theme file). No `any` at the Cesium boundary; no silent catches.
