# Technical Specification: 04 - Frontend 3D Globe Dashboard & Real-Time Telemetry HUD

## 1. Overview
This specification details the frontend architecture for the ReconVillage OSINT Platform. The frontend is built using Vite, React 18, TypeScript, Redux Toolkit (RTK) & RTK Query, Material UI (MUI) green-on-black tactical dark theme, WebSockets, and **CesiumJS** (bundled with `vite-plugin-cesium`) for 3D geospatial visualization. The frontend connects to the backend REST API (`/api/sources`, `/api/entities`, `/api/observations`) and streams real-time WebSocket telemetry updates from `/ws/telemetry`, visualizing global intelligence targets (satellites, aircraft, earthquakes, radiation, ships) as **tactical filled-silhouette billboards on a real dark map**.

> The globe MUST be a functioning CesiumJS viewer over a real slippy-map basemap — never a
> placeholder component and never a single fixed sphere texture. Verify it renders visually
> (Chrome DevTools MCP), not just that a unit test passes.

---

## 2. System Architecture & Data Flow

```
                                  [ WebSocket Telemetry Server (/ws/telemetry) ]
                                                        │
                                                        ▼ (entity_update, initial_state)
[ Backend REST API ] <──RTK Query (osintApi)──> [ useWebSocket Hook ]
       │                                                │
       ▼                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Redux Toolkit Store                              │
│  ├─ entitiesSlice (entities map, selectedEntityId, activeCategoryFilter)   │
│  └─ sourcesSlice  (sources map, enabledSourceIds)                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
   [ TelemetryStatsBanner ]   [ LayerControlDrawer ]    [ EntityDetailsDrawer ]
  (Status, Msgs/s, Count)     (Layer Toggles, Filters)   (Metadata, Telemetry)
                                       │
                                       ▼
                              [ GlobeView (3D) ]
                        (3D Earth, Markers, Trails)
```

---

## 3. Redux Toolkit Store & State Architecture

### 3.1 Store Configuration (`frontend/src/store/index.ts`)
Combines `entitiesSlice`, `sourcesSlice`, and the `osintApi` RTK Query service middleware.

```typescript
import { configureStore } from '@reduxjs/toolkit';
import entitiesReducer from './slices/entitiesSlice';
import sourcesReducer from './slices/sourcesSlice';
import { osintApi } from './api/osintApi';

export const store = configureStore({
  reducer: {
    entities: entitiesReducer,
    sources: sourcesReducer,
    [osintApi.reducerPath]: osintApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(osintApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### 3.2 Entities Slice (`frontend/src/store/slices/entitiesSlice.ts`)
Manages the collection of tracked entities, active category filter, and selected entity identifier.

```typescript
export interface EntityRecord {
  id: string;
  source_id: string;
  category: 'satellite' | 'aircraft' | 'geological' | 'radiation' | 'maritime' | string;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: string;
  metadata?: string | Record<string, any>;
  trail?: Array<{ latitude: number; longitude: number; altitude: number; timestamp: string }>;
}

export interface EntitiesState {
  entities: Record<string, EntityRecord>;
  selectedEntityId: string | null;
  activeCategoryFilter: string | null;
}

const initialState: EntitiesState = {
  entities: {},
  selectedEntityId: null,
  activeCategoryFilter: null,
};
```

#### Slice Actions & Reducers:
- `setInitialEntities(entities: EntityRecord[])`: Replaces or populates entities dictionary.
- `upsertEntity(entity: EntityRecord)`: Upserts a single entity record, preserving historical trajectory trails (up to 20 coordinates).
- `setSelectedEntityId(id: string | null)`: Updates currently selected entity ID for inspection.
- `setActiveCategoryFilter(category: string | null)`: Toggles active category filter.

### 3.3 Sources Slice (`frontend/src/store/slices/sourcesSlice.ts`)
Manages state for available and enabled OSINT data source layers.

```typescript
export interface SourceRecord {
  id: string;
  name: string;
  type: string;
  transport: string;
  url: string;
  update_interval_sec: number;
  enabled: number | boolean;
}

export interface SourcesState {
  sources: Record<string, SourceRecord>;
  enabledSourceIds: string[];
}

const initialState: SourcesState = {
  sources: {},
  enabledSourceIds: [],
};
```

#### Slice Actions & Reducers:
- `setSources(sources: SourceRecord[])`: Populates data sources map and enables all sources by default.
- `toggleSourceEnabled(sourceId: string)`: Enables or disables a specific data source layer.

### 3.4 RTK Query API Service (`frontend/src/store/api/osintApi.ts`)
Provides endpoints for asynchronous REST data fetching.

```typescript
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const osintApi = createApi({
  reducerPath: 'osintApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    getSources: builder.query<{ sources: SourceRecord[] }, void>({
      query: () => '/sources',
    }),
    getEntities: builder.query<{ total: number; entities: EntityRecord[] }, { category?: string }>({
      query: (params) => ({
        url: '/entities',
        params,
      }),
    }),
    getObservations: builder.query<{ observations: any[] }, { entity_id: string }>({
      query: ({ entity_id }) => `/observations?entity_id=${entity_id}`,
    }),
  }),
});

export const { useGetSourcesQuery, useGetEntitiesQuery, useGetObservationsQuery } = osintApi;
```

---

## 4. Real-Time Telemetry Hook (`frontend/src/hooks/useWebSocket.ts`)

The `useWebSocket` custom hook encapsulates connection lifecycle, automatic reconnection with backoff, heartbeat ping/pong management, message throughput calculation, and store synchronization.

```typescript
export interface WebSocketState {
  isConnected: boolean;
  isReconnecting: boolean;
  messageRate: number; // msgs per second
  lastSeenTimestamp: string | null;
}
```

### Hook Specification:
1. Connects to `ws://${window.location.host}/ws/telemetry` (or configurable WebSocket endpoint).
2. Sets `isConnected = true` upon open connection.
3. Listens for inbound JSON payloads:
   - `initial_state`: Dispatches `setInitialEntities` and `setSources` to Redux store.
   - `entity_update`: Dispatches `upsertEntity` to Redux store.
   - `ping`: Responds with `{ type: "pong" }`.
4. Tracks message throughput in a rolling 1-second sliding window to calculate real-time `messageRate`.
5. On close or error, sets `isConnected = false`, `isReconnecting = true`, and attempts automatic reconnect after backoff delay (default 3,000 ms).

---

## 5. 3D Globe Visualization Engine — CesiumJS (`frontend/src/components/GlobeView.tsx`)

`GlobeView.tsx` **already exists from step 1** — a raw `Cesium.Viewer` (created in a `useEffect`,
held in a ref) over a real dark basemap, with an idle attract-mode spin. Step 4 **extends that
same component**: it keeps the step-1 viewer, basemap, and spin, and adds a `BillboardCollection`
with one tactical filled-silhouette billboard per entity plus click-to-select. This is an extension, not a rebuild.

### 5.1 Viewer & basemap (built in step 1 — reuse, don't recreate)
- Created once: `new Cesium.Viewer(container, {...})` with all default widgets disabled
  (`baseLayerPicker/timeline/animation/geocoder/homeButton/sceneModePicker/navigationHelpButton/
  fullscreenButton/infoBox/selectionIndicator: false`), `requestRenderMode: true`,
  `maximumRenderTimeChange: 0.5`, `scene3DOnly: true`, `shouldAnimate: true`, `shadows: false`.
- Basemap `baseLayer`: `new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url:
  'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png', maximumLevel: 18 }))`.
  Build it in a factory (StrictMode double-invokes effects). Optional: if `VITE_CESIUM_ION_TOKEN`
  is set, use Cesium Ion World Imagery instead.
- Container background `#000`; hide the credit bar (`.cesium-viewer-bottom { display: none }`).
- Bundle with `vite-plugin-cesium` (adds `cesium()` to `vite.config.ts`).

### 5.2 Category → tactical shape → color

Markers are **filled tactical silhouettes drawn directly with Canvas 2D** — no icon library, no
disc or ring border. Each category maps to a `drawX(ctx, color)` function; the shape itself is the
marker, filled in the category color with a black inset cutout for an embossed, outlined look plus
a center dot (command-and-control aesthetic).

| Category | Tactical shape | Color |
| :--- | :--- | :--- |
| `satellite` | diamond (radar-tracked asset) | `#00f3ff` |
| `aircraft` | top-down airplane (rotates to heading) | `#ffaa00` |
| `geological` | earthquake epicenter (concentric seismic rings) | `#ff0055` |
| `radiation` | radiation trefoil | `#ffcc00` |
| `maritime` | top-down vessel (rotates to heading) | `#4fc3f7` |

Each silhouette is rendered onto an offscreen `<canvas>` at **2× for crispness** and returned as a
PNG data-URL (`canvas.toDataURL("image/png")`), used as the Cesium billboard `image` (cache one
per category). The color is **baked into the pixels**, so the billboard uses `Color.WHITE` and the
drawn colors come through unchanged. Unknown categories fall back to a neutral filled dot.

> **Billboard images MUST be raster (PNG/canvas), NEVER `image/svg+xml`.** Cesium's texture atlas
> decodes billboard images with `createImageBitmap()`, and Chromium's `createImageBitmap` cannot
> decode SVG — it throws `InvalidStateError: The source image could not be decoded.` and Cesium
> halts its render loop ("An error occurred while rendering. Rendering has stopped."). Drawing the
> silhouette straight to a `<canvas>` keeps it a raster PNG and fully synchronous (no async image
> load).

### 5.3 Rendering & interaction
- **Billboards**: one `BillboardCollection` on `viewer.scene.primitives`. Each entity → one
  billboard at `Cesium.Cartesian3.fromDegrees(lon, lat, alt)`, keyed by entity id in a
  `Map<string, Billboard>` for incremental upserts. Store `entity.id` on the billboard so picks
  can resolve it.
- **Heading**: aircraft **and maritime** billboards set `rotation` from their travel heading
  (both silhouettes point north) with `alignedAxis = Cesium.Cartesian3.UNIT_Z`.
- **Selection**: a `ScreenSpaceEventHandler` LEFT_CLICK does `viewer.scene.pick`; if it hit a
  billboard, dispatch `setSelectedEntityId(id)` and highlight it (scale up / brighten). The
  entity inspector shows the live coordinate readout.
- **Filtering**: an entity's billboard is shown only if it passes `activeCategoryFilter` and its
  `source_id` is in `enabledSourceIds`; otherwise `billboard.show = false` (do not destroy/recreate).
- **No stubs, no silent catches**: any Cesium/init error is logged (never `catch {}`).

---

## 6. Tactical MUI HUD Components & Dark Theme Design System

### 6.1 Theme (`frontend/src/theme.ts`) — reuse the one from step 1
Use the **single** `tacticalTheme` created in step 1. Do NOT create a second theme file here.
It is the green-on-black tactical identity (accent `#00ff9d` on `#000000`/`#0a0a0a`, secondary
`#ff006e`, monospace `JetBrains Mono`). The per-category marker colors (§5.2) are applied to the
Cesium billboards, not to the MUI palette.

### 6.2 Top Telemetry Stats Banner (`frontend/src/components/TelemetryStatsBanner.tsx`)
Top navigation banner displaying:
- **Platform Title**: `RECONVILLAGE OSINT CORE v1.0`
- **Connection Status Badge**:
  - `CONNECTED` (Green Chip)
  - `RECONNECTING` (Amber Chip)
  - `OFFLINE` (Red Chip)
- **Telemetry Stream Rate**: Message rate counter (e.g. `48 msgs/sec`)
- **Active Entities Gauge**: Count of active entities currently in store (e.g. `1,250 Entities`)

### 6.3 Layer Control Drawer (`frontend/src/components/LayerControlDrawer.tsx`)
Collapsible left-hand drawer containing:
- **Category Filter Toggles**: Buttons/Checkboxes to filter by category (`satellite`, `aircraft`, `geological`, `radiation`, `maritime`).
- **Data Source Layer Checkboxes**: List of registered OSINT sources with toggle switches to enable/disable specific data layers.

### 6.4 Entity Details Inspector Drawer (`frontend/src/components/EntityDetailsDrawer.tsx`)
Collapsible right-hand drawer opened when `selectedEntityId` is non-null:
- **Header**: Entity Name, Category Badge, Entity ID.
- **Geospatial Metrics**: Latitude, Longitude, Altitude, Speed, Heading, Last Updated Timestamp.
- **Observation history (uses REST)**: fetches recent observations via the RTK Query
  `useGetObservationsQuery({ entity_id })` hook and lists them. This is what makes the REST API
  from step 3 a real, exercised dependency instead of dead code.
- **Source Attribute JSON Viewer**: Formatted view of entity metadata.
- **Close Action**: Dispatches `setSelectedEntityId(null)`.

---

## 7. Testing & Verification Plan

- **Slice Unit Tests (`frontend/src/store/slices/__tests__/slices.test.ts`)**:
  - Test `entitiesSlice` upsert, filtering, and selection state updates.
  - Test `sourcesSlice` toggle and layer state mutations.
- **Hook Unit Tests (`frontend/src/hooks/__tests__/useWebSocket.test.ts`)**:
  - Test connection lifecycle, message processing, auto-reconnect, and rate calculation using `jest-websocket-mock` or mock WS server.
- **Component Unit Tests (`frontend/src/components/__tests__/components.test.tsx`)**:
  - Test `TelemetryStatsBanner` renders connection status chips and rate.
  - Test `LayerControlDrawer` triggers layer toggle dispatches on user click.
  - Test `EntityDetailsDrawer` renders metadata when entity is selected.
  - Test `GlobeView` mounts and builds its category→marker map (mock Cesium if needed). Do NOT
    assert on placeholder text — there is no placeholder.
- **Full Verification**: Execute `rtk make test` and `rtk make lint`.

### 7.1 Mandatory visual verification (Chrome DevTools MCP)
Unit tests cannot see the globe. Before declaring step 4 done, with the full stack running:
1. Navigate to the app; take a screenshot.
2. Confirm the Cesium canvas exists and shows a real dark map (recognizable coastlines on zoom),
   not a blank sphere or flat texture.
3. Confirm billboards are visible for **every** category that has live data (not only aircraft).
4. Confirm the browser **console has zero errors**.
5. Click a marker → the inspector opens with details; observation history loads.

---

## 8. Hard Requirements & Definition of Done

1. `GlobeView` is the **step-1 globe, extended** — a real `Cesium.Viewer` with the Stadia dark
   basemap (`cesium` + `vite-plugin-cesium` already in `package.json`; `cesium()` already in
   `vite.config.ts` from step 1). No stub, no globe.gl, no regression to a placeholder.
2. `@reduxjs/toolkit` + `react-redux` are dependencies; the store exposes typed
   `useAppDispatch`/`useAppSelector` hooks (`store/hooks.ts`).
3. Markers render for all live categories; category strings match the shared enum exactly.
   Billboard images are raster PNG/canvas — `grep -rn "image/svg" frontend/src` → zero matches
   (an SVG billboard throws `InvalidStateError: The source image could not be decoded.` and
   stops the Cesium render loop).
4. Visual verification (§7.1) passes — screenshot + all categories + zero console errors.
5. `useWebSocket` derives `ws`/`wss` from `location.protocol`, connects on `/ws/telemetry`, and
   the store populates from `initial_state`/`entity_update`.
6. Inspector loads observation history via RTK Query (REST is exercised).
7. Single green-on-black `tacticalTheme`; no `any` at the Cesium boundary; no silent catches.
