# Implementation Plan: 04 - Frontend 3D Globe Dashboard & Real-Time Telemetry HUD

This step-by-step TDD implementation plan details the creation of the Vite + React + Redux Toolkit + MUI + 3D Globe dashboard, real-time WebSocket telemetry hook, layer control drawer, entity details inspector, top telemetry stats banner, and interactive 3D Globe visualization.

---

## Task 1: Redux Toolkit Store, Slices & RTK Query API Service

- [ ] **Step 1.1: Create Sources Slice (`frontend/src/store/slices/sourcesSlice.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/store/slices/sourcesSlice.ts`
  ```typescript
  import { createSlice, PayloadAction } from '@reduxjs/toolkit';

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

  const sourcesSlice = createSlice({
    name: 'sources',
    initialState,
    reducers: {
      setSources(state, action: PayloadAction<SourceRecord[]>) {
        state.sources = {};
        state.enabledSourceIds = [];
        action.payload.forEach((src) => {
          state.sources[src.id] = src;
          if (src.enabled) {
            state.enabledSourceIds.push(src.id);
          }
        });
      },
      toggleSourceEnabled(state, action: PayloadAction<string>) {
        const sourceId = action.payload;
        const index = state.enabledSourceIds.indexOf(sourceId);
        if (index >= 0) {
          state.enabledSourceIds.splice(index, 1);
        } else {
          state.enabledSourceIds.push(sourceId);
        }
      },
    },
  });

  export const { setSources, toggleSourceEnabled } = sourcesSlice.actions;
  export default sourcesSlice.reducer;
  ```

- [ ] **Step 1.2: Create Entities Slice (`frontend/src/store/slices/entitiesSlice.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/store/slices/entitiesSlice.ts`
  ```typescript
  import { createSlice, PayloadAction } from '@reduxjs/toolkit';

  export interface EntityRecord {
    id: string;
    source_id: string;
    category: string;
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

  const entitiesSlice = createSlice({
    name: 'entities',
    initialState,
    reducers: {
      setInitialEntities(state, action: PayloadAction<EntityRecord[]>) {
        state.entities = {};
        action.payload.forEach((ent) => {
          state.entities[ent.id] = {
            ...ent,
            trail: [{ latitude: ent.latitude, longitude: ent.longitude, altitude: ent.altitude, timestamp: ent.timestamp }],
          };
        });
      },
      upsertEntity(state, action: PayloadAction<EntityRecord>) {
        const ent = action.payload;
        const existing = state.entities[ent.id];
        const newTrail = existing?.trail ? [...existing.trail] : [];
        newTrail.push({ latitude: ent.latitude, longitude: ent.longitude, altitude: ent.altitude, timestamp: ent.timestamp });
        if (newTrail.length > 20) {
          newTrail.shift();
        }

        state.entities[ent.id] = {
          ...ent,
          trail: newTrail,
        };
      },
      setSelectedEntityId(state, action: PayloadAction<string | null>) {
        state.selectedEntityId = action.payload;
      },
      setActiveCategoryFilter(state, action: PayloadAction<string | null>) {
        state.activeCategoryFilter = action.payload;
      },
    },
  });

  export const { setInitialEntities, upsertEntity, setSelectedEntityId, setActiveCategoryFilter } = entitiesSlice.actions;
  export default entitiesSlice.reducer;
  ```

- [ ] **Step 1.3: Create RTK Query Service (`frontend/src/store/api/osintApi.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/store/api/osintApi.ts`
  ```typescript
  import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
  import { SourceRecord } from '../slices/sourcesSlice';
  import { EntityRecord } from '../slices/entitiesSlice';

  export const osintApi = createApi({
    reducerPath: 'osintApi',
    baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
    endpoints: (builder) => ({
      getSources: builder.query<{ sources: SourceRecord[] }, void>({
        query: () => '/sources',
      }),
      getEntities: builder.query<{ total: number; entities: EntityRecord[] }, { category?: string } | void>({
        query: (params) => ({
          url: '/entities',
          params: params || {},
        }),
      }),
      getObservations: builder.query<{ observations: any[] }, { entity_id: string }>({
        query: ({ entity_id }) => `/observations?entity_id=${entity_id}`,
      }),
    }),
  });

  export const { useGetSourcesQuery, useGetEntitiesQuery, useGetObservationsQuery } = osintApi;
  ```

- [ ] **Step 1.4: Configure Redux Store (`frontend/src/store/index.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/store/index.ts`
  ```typescript
  import { configureStore } from '@reduxjs/toolkit';
  import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
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

  // Typed hooks — later steps (and step 5) import these from '../store'. They MUST exist here,
  // or FilterModeSelector/PerformanceControls fail to compile.
  export const useAppDispatch: () => AppDispatch = useDispatch;
  export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
  ```

- [ ] **Step 1.4b: Add frontend dependencies and the Vitest test environment**

  `cesium` + `vite-plugin-cesium` are **already installed** and `cesium()` is **already
  registered** in `frontend/vite.config.ts` from **step 1** (that's where the globe was built).
  Here you add only the state, data-fetching, and test packages (markers are drawn with Canvas 2D
  — no icon library needed):
  ```
  rtk npm install --prefix frontend @reduxjs/toolkit react-redux
  rtk npm install --prefix frontend -D jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
  ```

  Then add the Vitest `test` block to the **existing** `frontend/vite.config.ts` — leave the
  step-1 `cesium()` plugin and the `/api` + `/ws` proxies exactly as they are:
  ```typescript
  /// <reference types="vitest" />
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';
  import cesium from 'vite-plugin-cesium';         // already added in step 1

  export default defineConfig({
    plugins: [react(), cesium()],                   // cesium() from step 1 — keep it
    server: {
      port: 3000,
      proxy: {
        '/api': { target: 'http://localhost:4000', changeOrigin: true },
        '/ws': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
      },
    },
    test: {                                         // NEW in step 4 (component tests need a DOM)
      globals: true,           // describe/it/expect available without imports
      environment: 'jsdom',    // DOM for React component tests
      setupFiles: './src/test/setup.ts',
    },
  });
  ```

  File: `frontend/src/test/setup.ts`
  ```typescript
  import '@testing-library/jest-dom';
  ```

  > **Frontend tests run under Vitest, not Jest.** Use `vi.fn`/`vi.mock` (`import { vi } from
  > 'vitest'`) — any `jest.fn`/`jest.mock` shown in a plan example must be written as `vi.*`.
  > (Backend tests use Jest; there `jest.*` is correct.)

- [ ] **Step 1.5: Write Unit Tests for Slices (`frontend/src/store/slices/__tests__/slices.test.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/store/slices/__tests__/slices.test.ts`
  ```typescript
  import entitiesReducer, { setInitialEntities, upsertEntity, setSelectedEntityId, setActiveCategoryFilter } from '../entitiesSlice';
  import sourcesReducer, { setSources, toggleSourceEnabled } from '../sourcesSlice';

  describe('Redux Slices', () => {
    describe('entitiesSlice', () => {
      it('handles setInitialEntities', () => {
        const state = entitiesReducer(undefined, setInitialEntities([
          { id: 'sat1', source_id: 'iss', category: 'satellite', name: 'ISS', latitude: 10, longitude: 20, altitude: 400, timestamp: '2026-07-26T00:00:00Z' }
        ]));
        expect(state.entities['sat1']).toBeDefined();
        expect(state.entities['sat1'].name).toBe('ISS');
      });

      it('handles upsertEntity and trail tracking', () => {
        let state = entitiesReducer(undefined, upsertEntity(
          { id: 'sat1', source_id: 'iss', category: 'satellite', name: 'ISS', latitude: 10, longitude: 20, altitude: 400, timestamp: '2026-07-26T00:00:00Z' }
        ));
        expect(state.entities['sat1'].trail?.length).toBe(1);

        state = entitiesReducer(state, upsertEntity(
          { id: 'sat1', source_id: 'iss', category: 'satellite', name: 'ISS', latitude: 12, longitude: 22, altitude: 400, timestamp: '2026-07-26T00:01:00Z' }
        ));
        expect(state.entities['sat1'].latitude).toBe(12);
        expect(state.entities['sat1'].trail?.length).toBe(2);
      });

      it('handles entity selection & category filter', () => {
        let state = entitiesReducer(undefined, setSelectedEntityId('sat1'));
        expect(state.selectedEntityId).toBe('sat1');

        state = entitiesReducer(state, setActiveCategoryFilter('aircraft'));
        expect(state.activeCategoryFilter).toBe('aircraft');
      });
    });

    describe('sourcesSlice', () => {
      it('handles setSources and toggleSourceEnabled', () => {
        let state = sourcesReducer(undefined, setSources([
          { id: 'src1', name: 'USGS', type: 'earthquake', transport: 'http', url: 'http://', update_interval_sec: 60, enabled: 1 }
        ]));
        expect(state.sources['src1']).toBeDefined();
        expect(state.enabledSourceIds).toContain('src1');

        state = sourcesReducer(state, toggleSourceEnabled('src1'));
        expect(state.enabledSourceIds).not.toContain('src1');
      });
    });
  });
  ```

- [ ] **Step 1.6: Run Slice Unit Tests**
  Run: `rtk npm test frontend/src/store/slices/__tests__/slices.test.ts`
  Expected Output: Slices unit tests pass cleanly.

---

## Task 2: Custom WebSocket Telemetry Hook (`useWebSocket.ts`)

- [ ] **Step 2.1: Implement WebSocket Telemetry Hook (`frontend/src/hooks/useWebSocket.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/hooks/useWebSocket.ts`
  ```typescript
  import { useEffect, useState, useRef } from 'react';
  import { useDispatch } from 'react-redux';
  import { setInitialEntities, upsertEntity } from '../store/slices/entitiesSlice';
  import { setSources } from '../store/slices/sourcesSlice';

  export interface UseWebSocketOptions {
    url?: string;
    reconnectInterval?: number;
  }

  export function useWebSocket(options: UseWebSocketOptions = {}) {
    const dispatch = useDispatch();
    const [isConnected, setIsConnected] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [messageRate, setMessageRate] = useState(0);
    const messageCountRef = useRef(0);
    const socketRef = useRef<WebSocket | null>(null);

    // Derive ws/wss from the page protocol; connect through the Vite /ws proxy in dev.
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = options.url || `${wsProto}://${window.location.host}/ws/telemetry`;
    const reconnectInterval = options.reconnectInterval || 3000;

    useEffect(() => {
      let isMounted = true;
      let reconnectTimer: NodeJS.Timeout;

      const connect = () => {
        try {
          const ws = new WebSocket(wsUrl);
          socketRef.current = ws;

          ws.onopen = () => {
            if (!isMounted) return;
            setIsConnected(true);
            setIsReconnecting(false);
          };

          ws.onmessage = (event) => {
            if (!isMounted) return;
            messageCountRef.current += 1;
            try {
              const payload = JSON.parse(event.data);
              if (payload.type === 'initial_state' && payload.data) {
                if (payload.data.entities) {
                  dispatch(setInitialEntities(payload.data.entities));
                }
                if (payload.data.sources) {
                  dispatch(setSources(payload.data.sources));
                }
              } else if (payload.type === 'entity_update' && payload.data) {
                dispatch(upsertEntity(payload.data));
              } else if (payload.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
              }
            } catch (err) {
              console.error('Failed to parse WebSocket message:', err);
            }
          };

          ws.onclose = () => {
            if (!isMounted) return;
            setIsConnected(false);
            setIsReconnecting(true);
            reconnectTimer = setTimeout(connect, reconnectInterval);
          };

          ws.onerror = () => {
            ws.close();
          };
        } catch (err) {
          setIsConnected(false);
          setIsReconnecting(true);
          reconnectTimer = setTimeout(connect, reconnectInterval);
        }
      };

      connect();

      // Rate measurement interval (every second)
      const rateInterval = setInterval(() => {
        setMessageRate(messageCountRef.current);
        messageCountRef.current = 0;
      }, 1000);

      return () => {
        isMounted = false;
        clearInterval(rateInterval);
        clearTimeout(reconnectTimer);
        if (socketRef.current) {
          socketRef.current.close();
        }
      };
    }, [wsUrl, reconnectInterval, dispatch]);

    return { isConnected, isReconnecting, messageRate };
  }
  ```

- [ ] **Step 2.2: Write Unit Tests for `useWebSocket` Hook (`frontend/src/hooks/__tests__/useWebSocket.test.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/hooks/__tests__/useWebSocket.test.ts`
  ```typescript
  import { renderHook, act } from '@testing-library/react';
  import { Provider } from 'react-redux';
  import { vi } from 'vitest';
  import React from 'react';
  import { store } from '../../store';
  import { useWebSocket } from '../useWebSocket';

  describe('useWebSocket hook', () => {
    let mockWs: any;

    beforeEach(() => {
      mockWs = {
        send: vi.fn(),
        close: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      (globalThis as any).WebSocket = vi.fn(() => mockWs);
    });

    it('connects and handles initial_state message', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      );

      const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/test' }), { wrapper });

      act(() => {
        if (mockWs.onopen) mockWs.onopen();
      });
      expect(result.current.isConnected).toBe(true);

      act(() => {
        if (mockWs.onmessage) {
          mockWs.onmessage({
            data: JSON.stringify({
              type: 'initial_state',
              data: {
                sources: [{ id: 's1', name: 'Source 1', enabled: 1 }],
                entities: [{ id: 'e1', name: 'Entity 1', category: 'satellite', latitude: 0, longitude: 0, altitude: 100 }],
              },
            }),
          });
        }
      });

      const state = store.getState();
      expect(state.entities.entities['e1']).toBeDefined();
      expect(state.sources.sources['s1']).toBeDefined();
    });
  });
  ```

- [ ] **Step 2.3: Run Hook Unit Tests**
  Run: `rtk npm test frontend/src/hooks/__tests__/useWebSocket.test.ts`
  Expected Output: `useWebSocket` hook tests pass.

---

## Task 3: MUI Theme & Tactical HUD Components

- [ ] **Step 3.1: Reuse the single theme from step 1**

  `frontend/src/theme.ts` (`tacticalTheme`, green-on-black) already exists from step 1. Do NOT
  create a second theme file and do NOT redefine it here — import `tacticalTheme` from
  `./theme` wherever a theme is needed. (A `darkTheme` vs `tacticalTheme` split was a real bug.)

- [ ] **Step 3.2: Implement Telemetry Stats Banner (`frontend/src/components/TelemetryStatsBanner.tsx`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/components/TelemetryStatsBanner.tsx`
  ```typescript
  import React from 'react';
  import { Box, Typography, Chip, Stack } from '@mui/material';
  import { useSelector } from 'react-redux';
  import { RootState } from '../store';

  interface TelemetryStatsBannerProps {
    isConnected: boolean;
    isReconnecting: boolean;
    messageRate: number;
  }

  export const TelemetryStatsBanner: React.FC<TelemetryStatsBannerProps> = ({
    isConnected,
    isReconnecting,
    messageRate,
  }) => {
    const entities = useSelector((state: RootState) => state.entities.entities);
    const activeEntityCount = Object.keys(entities).length;

    let statusLabel = 'OFFLINE';
    let statusColor: 'error' | 'warning' | 'success' = 'error';

    if (isConnected) {
      statusLabel = 'CONNECTED';
      statusColor = 'success';
    } else if (isReconnecting) {
      statusLabel = 'RECONNECTING';
      statusColor = 'warning';
    }

    // INLINE row — designed to live INSIDE the single header AppBar. It is NOT absolutely
    // positioned (an absolute banner over the AppBar is what hid the drawer button + filters).
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexGrow: 1 }}>
        <Typography variant="h6" sx={{ color: '#00ff9d', fontWeight: 'bold', letterSpacing: 1 }}>
          MK-OSINT OSINT CORE
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Stack direction="row" spacing={2} alignItems="center">
          <Chip label={statusLabel} color={statusColor} size="small" variant="outlined" />
          <Typography variant="body2" sx={{ color: '#888' }}>
            STREAM: <strong style={{ color: '#00ff9d' }}>{messageRate} msgs/s</strong>
          </Typography>
          <Typography variant="body2" sx={{ color: '#888' }}>
            ENTITIES: <strong style={{ color: '#ff006e' }}>{activeEntityCount}</strong>
          </Typography>
        </Stack>
      </Box>
    );
  };
  ```

- [ ] **Step 3.3: Implement Layer Control Drawer (`frontend/src/components/LayerControlDrawer.tsx`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/components/LayerControlDrawer.tsx`
  ```typescript
  import React from 'react';
  import { Drawer, Box, Typography, Checkbox, FormControlLabel, FormGroup, Divider, ButtonGroup, Button } from '@mui/material';
  import { useSelector, useDispatch } from 'react-redux';
  import { RootState } from '../store';
  import { toggleSourceEnabled } from '../store/slices/sourcesSlice';
  import { setActiveCategoryFilter } from '../store/slices/entitiesSlice';

  interface LayerControlDrawerProps {
    open: boolean;
    onClose: () => void;
  }

  const CATEGORIES = ['satellite', 'aircraft', 'geological', 'radiation', 'maritime'];

  export const LayerControlDrawer: React.FC<LayerControlDrawerProps> = ({ open, onClose }) => {
    const dispatch = useDispatch();
    const sources = useSelector((state: RootState) => state.sources.sources);
    const enabledSourceIds = useSelector((state: RootState) => state.sources.enabledSourceIds);
    const activeCategory = useSelector((state: RootState) => state.entities.activeCategoryFilter);

    return (
      <Drawer anchor="left" open={open} onClose={onClose} PaperProps={{ sx: { width: 300, bgcolor: '#111827', color: '#fff', pt: 8 } }}>
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ color: '#00f3ff', mb: 2 }}>
            LAYER CONTROLS
          </Typography>

          <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
            CATEGORY FILTERS
          </Typography>
          <ButtonGroup size="small" orientation="vertical" fullWidth sx={{ mb: 3 }}>
            <Button
              variant={activeCategory === null ? 'contained' : 'outlined'}
              onClick={() => dispatch(setActiveCategoryFilter(null))}
            >
              ALL CATEGORIES
            </Button>
            {CATEGORIES.map((cat) => (
              <Button
                key={cat}
                variant={activeCategory === cat ? 'contained' : 'outlined'}
                onClick={() => dispatch(setActiveCategoryFilter(cat))}
                sx={{ textTransform: 'uppercase' }}
              >
                {cat}
              </Button>
            ))}
          </ButtonGroup>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 2 }} />

          <Typography variant="subtitle2" sx={{ color: '#9ca3af', mb: 1 }}>
            DATA SOURCES
          </Typography>
          <FormGroup>
            {Object.values(sources).map((src) => (
              <FormControlLabel
                key={src.id}
                control={
                  <Checkbox
                    checked={enabledSourceIds.includes(src.id)}
                    onChange={() => dispatch(toggleSourceEnabled(src.id))}
                    sx={{ color: '#00f3ff', '&.Mui-checked': { color: '#00f3ff' } }}
                  />
                }
                label={src.name}
              />
            ))}
          </FormGroup>
        </Box>
      </Drawer>
    );
  };
  ```

- [ ] **Step 3.4: Implement Entity Details Inspector (`frontend/src/components/EntityDetailsDrawer.tsx`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/components/EntityDetailsDrawer.tsx`
  ```typescript
  import React from 'react';
  import { Drawer, Box, Typography, IconButton, Chip, Divider, Table, TableBody, TableCell, TableRow } from '@mui/material';
  import CloseIcon from '@mui/icons-material/Close';
  import { useSelector, useDispatch } from 'react-redux';
  import { RootState } from '../store';
  import { setSelectedEntityId } from '../store/slices/entitiesSlice';
  import { useGetObservationsQuery } from '../store/api/osintApi';

  export const EntityDetailsDrawer: React.FC = () => {
    const dispatch = useDispatch();
    const selectedId = useSelector((state: RootState) => state.entities.selectedEntityId);
    const entity = useSelector((state: RootState) =>
      selectedId ? state.entities.entities[selectedId] : null
    );

    // Load observation history over REST (this is what exercises the step-3 API).
    const { data: obsData } = useGetObservationsQuery(
      { entity_id: selectedId ?? '' },
      { skip: !selectedId }
    );

    const handleClose = () => dispatch(setSelectedEntityId(null));

    if (!entity) return null;

    return (
      <Drawer
        anchor="right"
        open={Boolean(entity)}
        onClose={handleClose}
        PaperProps={{ sx: { width: 360, bgcolor: '#111827', color: '#fff', pt: 8 } }}
      >
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ color: '#00f3ff' }}>
              ENTITY INSPECTOR
            </Typography>
            <IconButton onClick={handleClose} sx={{ color: '#9ca3af' }}>
              <CloseIcon />
            </IconButton>
          </Box>

          <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}>
            {entity.name}
          </Typography>
          <Chip label={entity.category.toUpperCase()} color="primary" size="small" sx={{ mb: 2 }} />

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 2 }} />

          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ color: '#9ca3af', border: 0 }}>ID</TableCell>
                <TableCell sx={{ color: '#fff', border: 0 }}>{entity.id}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: '#9ca3af', border: 0 }}>LATITUDE</TableCell>
                <TableCell sx={{ color: '#00ff66', border: 0 }}>{entity.latitude.toFixed(4)}°</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: '#9ca3af', border: 0 }}>LONGITUDE</TableCell>
                <TableCell sx={{ color: '#00ff66', border: 0 }}>{entity.longitude.toFixed(4)}°</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: '#9ca3af', border: 0 }}>ALTITUDE</TableCell>
                <TableCell sx={{ color: '#ffaa00', border: 0 }}>{entity.altitude.toLocaleString()} m</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ color: '#9ca3af', border: 0 }}>LAST UPDATE</TableCell>
                <TableCell sx={{ color: '#fff', border: 0 }}>{new Date(entity.timestamp).toLocaleTimeString()}</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          {entity.metadata && (
            <Box sx={{ mt: 3, p: 1.5, bgcolor: '#0a0e17', borderRadius: 1, border: '1px solid rgba(0,243,255,0.2)' }}>
              <Typography variant="caption" sx={{ color: '#00f3ff', display: 'block', mb: 1 }}>
                RAW METADATA
              </Typography>
              <pre style={{ margin: 0, fontSize: '0.75rem', overflowX: 'auto', color: '#9ca3af' }}>
                {typeof entity.metadata === 'string' ? entity.metadata : JSON.stringify(entity.metadata, null, 2)}
              </pre>
            </Box>
          )}

          <Box sx={{ mt: 3 }}>
            <Typography variant="caption" sx={{ color: '#00ff9d', display: 'block', mb: 1 }}>
              OBSERVATION HISTORY (REST)
            </Typography>
            {(obsData?.observations ?? []).slice(0, 10).map((o: any) => (
              <Typography key={o.id} variant="caption" sx={{ display: 'block', color: '#9ca3af' }}>
                {new Date(o.timestamp).toLocaleTimeString()} — {o.latitude.toFixed(3)}, {o.longitude.toFixed(3)}
              </Typography>
            ))}
            {(!obsData || obsData.observations.length === 0) && (
              <Typography variant="caption" sx={{ color: '#666' }}>No observations yet.</Typography>
            )}
          </Box>
        </Box>
      </Drawer>
    );
  };
  ```

- [ ] **Step 3.5: Write Component Unit Tests (`frontend/src/components/__tests__/components.test.tsx`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/components/__tests__/components.test.tsx`
  ```typescript
  import React from 'react';
  import { render, screen } from '@testing-library/react';
  import { Provider } from 'react-redux';
  import { ThemeProvider } from '@mui/material/styles';
  import { store } from '../../store';
  import { tacticalTheme } from '../../theme';
  import { TelemetryStatsBanner } from '../TelemetryStatsBanner';
  import { LayerControlDrawer } from '../LayerControlDrawer';
  import { EntityDetailsDrawer } from '../EntityDetailsDrawer';
  import { setSelectedEntityId, upsertEntity } from '../../store/slices/entitiesSlice';

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <Provider store={store}>
        <ThemeProvider theme={tacticalTheme}>{ui}</ThemeProvider>
      </Provider>
    );
  };

  describe('Tactical HUD Components', () => {
    test('TelemetryStatsBanner renders connection status and rates', () => {
      renderWithProviders(<TelemetryStatsBanner isConnected={true} isReconnecting={false} messageRate={42} />);
      expect(screen.getByText('CONNECTED')).toBeInTheDocument();
      expect(screen.getByText('42 msgs/s')).toBeInTheDocument();
    });

    test('LayerControlDrawer renders category filter options', () => {
      renderWithProviders(<LayerControlDrawer open={true} onClose={() => {}} />);
      expect(screen.getByText('LAYER CONTROLS')).toBeInTheDocument();
      expect(screen.getByText('ALL CATEGORIES')).toBeInTheDocument();
    });

    test('EntityDetailsDrawer renders selected entity attributes', () => {
      store.dispatch(upsertEntity({
        id: 'test_sat',
        source_id: 'iss',
        category: 'satellite',
        name: 'Test Satellite',
        latitude: 12.34,
        longitude: 56.78,
        altitude: 400000,
        timestamp: new Date().toISOString(),
      }));
      store.dispatch(setSelectedEntityId('test_sat'));

      renderWithProviders(<EntityDetailsDrawer />);
      expect(screen.getByText('Test Satellite')).toBeInTheDocument();
      expect(screen.getByText('12.3400°')).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 3.6: Run Component Unit Tests**
  Run: `rtk npm test frontend/src/components/__tests__/components.test.tsx`
  Expected Output: Component unit tests pass.

---

## Task 4: Interactive 3D Globe Component (`GlobeView.tsx`) & Main App Integration

- [ ] **Step 4.1: Extend the step-1 globe with live markers & interaction (`GlobeView.tsx`)**

  `frontend/src/components/GlobeView.tsx` **already exists from step 1** — a real `Cesium.Viewer`
  with the Stadia dark basemap and an idle attract-mode spin. You are **extending that same
  component**, not creating it: keep the step-1 viewer setup (`makeBaseLayer`, the disabled
  widgets, the spin) and add on top of it — wire it to the Redux store, add a `BillboardCollection`
  with one marker per entity, and add click-to-select. Do NOT regress it to a placeholder. The
  full component listed below is the **step-1 globe plus** those additions (the new pieces are the
  store selectors, `billboardsRef`/`byId`, the `LEFT_CLICK` pick handler, and the second effect
  that upserts billboards).

  First, category marker helpers (`frontend/src/components/globeMarkers.ts`) — **tactical filled
  silhouettes drawn directly with Canvas 2D** (no icon library, no disc/ring border), one per
  category, rasterized to a crisp PNG. Solid fill in the category color + a black inset cutout
  gives an embossed, outlined look; rotatable shapes (flight, ship) point north so `GlobeView`
  can rotate them to heading. (Still a raster PNG — see the CRITICAL note in `makeMarker` below.)

  ```typescript
  // Tactical filled-silhouette markers drawn directly with Canvas 2D — no icon library, no disc.
  // Each drawX() fills a solid silhouette in the category color, with a black inset cutout for an
  // embossed "outlined" feel plus a center dot. Ported from the MK-OSINT command-center icon
  // set. Rotatable shapes (flight, ship) point north (heading 0) so GlobeView can rotate them.
  type IconDrawFn = (ctx: CanvasRenderingContext2D, color: string) => void;

  const ICON_SIZE = 32; // logical drawing grid (CX = CY = 16)
  const CANVAS_SCALE = 2; // render at 2x so billboards stay crisp when Cesium scales them
  const CX = ICON_SIZE / 2;
  const CY = ICON_SIZE / 2;

  // satellite — diamond / rhombus (radar-tracked asset)
  function drawSatelliteIcon(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.fillStyle = color;
    const R = 11;
    ctx.beginPath();
    ctx.moveTo(CX, CY - R); ctx.lineTo(CX + R, CY); ctx.lineTo(CX, CY + R); ctx.lineTo(CX - R, CY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000000';
    const IR = 6;
    ctx.beginPath();
    ctx.moveTo(CX, CY - IR); ctx.lineTo(CX + IR, CY); ctx.lineTo(CX, CY + IR); ctx.lineTo(CX - IR, CY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(CX, CY, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // aircraft — top-down airplane, nose north (rotates to heading)
  function drawFlightIcon(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(CX, 3); ctx.lineTo(CX + 2, 8); ctx.lineTo(CX + 2, 22); ctx.lineTo(CX + 3, 27);
    ctx.lineTo(CX - 3, 27); ctx.lineTo(CX - 2, 22); ctx.lineTo(CX - 2, 8);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(CX, 12); ctx.lineTo(CX + 13, 18); ctx.lineTo(CX + 12, 20); ctx.lineTo(CX, 15);
    ctx.lineTo(CX - 12, 20); ctx.lineTo(CX - 13, 18);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(CX, 24); ctx.lineTo(CX + 6, 28); ctx.lineTo(CX + 5, 29); ctx.lineTo(CX, 26);
    ctx.lineTo(CX - 5, 29); ctx.lineTo(CX - 6, 28);
    ctx.closePath(); ctx.fill();
  }

  // geological — earthquake epicenter: concentric seismic rings + solid core
  function drawEarthquakeIcon(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(CX, CY, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(CX, CY, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(CX, CY, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // radiation — trefoil hazard
  function drawRadiationIcon(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(CX, CY, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(CX, CY, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    const innerR = 3.5, outerR = 10, bladeArc = Math.PI / 3;
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(CX, CY, outerR, angle - bladeArc / 2, angle + bladeArc / 2);
      ctx.arc(CX, CY, innerR, angle + bladeArc / 2, angle - bladeArc / 2, true);
      ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(CX, CY, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // maritime — top-down vessel: pointed bow (north), wide hull, flat stern (rotates to heading)
  function drawShipIcon(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(CX, 3); ctx.lineTo(CX + 8, 12); ctx.lineTo(CX + 8, 28); ctx.lineTo(CX - 8, 28); ctx.lineTo(CX - 8, 12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(CX, 8); ctx.lineTo(CX + 5, 14); ctx.lineTo(CX + 5, 26); ctx.lineTo(CX - 5, 26); ctx.lineTo(CX - 5, 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(CX - 3, 17, 6, 6);
    ctx.beginPath(); ctx.arc(CX, CY + 4, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  // fallback — filled dot
  function drawDefaultIcon(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(CX, CY, 6, 0, Math.PI * 2); ctx.fill();
  }

  export interface MarkerStyle {
    draw: IconDrawFn;
    color: string;
  }

  const STYLE: Record<string, MarkerStyle> = {
    satellite: { draw: drawSatelliteIcon, color: '#00f3ff' },
    aircraft: { draw: drawFlightIcon, color: '#ffaa00' },
    geological: { draw: drawEarthquakeIcon, color: '#ff0055' },
    radiation: { draw: drawRadiationIcon, color: '#ffcc00' },
    maritime: { draw: drawShipIcon, color: '#4fc3f7' },
  };
  const FALLBACK: MarkerStyle = { draw: drawDefaultIcon, color: '#9ca3af' };

  // Pure category → { draw, color } mapping. No DOM — this is what the unit test targets.
  export function styleForCategory(category: string): MarkerStyle {
    return STYLE[category] ?? FALLBACK;
  }

  // Rasterize the category silhouette onto a 2x canvas and return a PNG data-URL.
  //
  // CRITICAL — the billboard image must be a RASTER PNG, never an "image/svg+xml" data-URI.
  // Cesium's texture atlas decodes billboard images with createImageBitmap(), and Chromium's
  // createImageBitmap CANNOT decode SVG: it throws
  //     InvalidStateError: The source image could not be decoded.
  // which stops Cesium's render loop ("An error occurred while rendering. Rendering has
  // stopped."). A <canvas> (PNG) decodes cleanly. The color is baked into the pixels, so the
  // Cesium billboard uses Color.WHITE and the drawn colors come through unchanged.
  function makeMarker(draw: IconDrawFn, color: string): string {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE * CANVAS_SCALE;
    canvas.height = ICON_SIZE * CANVAS_SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return ''; // headless/jsdom has no 2D context; markers are verified visually.
    ctx.scale(CANVAS_SCALE, CANVAS_SCALE);
    draw(ctx, color);
    return canvas.toDataURL('image/png');
  }

  const cache: Record<string, string> = {};
  export function markerForCategory(category: string): string {
    if (!cache[category]) {
      const s = styleForCategory(category);
      cache[category] = makeMarker(s.draw, s.color);
    }
    return cache[category];
  }

  // Bearing (radians, clockwise from north) between two lat/lon points — for aircraft heading.
  export function bearingRad(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return Math.atan2(y, x);
  }
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/components/GlobeView.tsx`
  ```typescript
  import { useEffect, useRef, type FC } from 'react';
  import { Box } from '@mui/material';
  import * as Cesium from 'cesium';
  import 'cesium/Build/Cesium/Widgets/widgets.css';
  import { useAppDispatch, useAppSelector } from '../store';
  import { setSelectedEntityId } from '../store/slices/entitiesSlice';
  import { markerForCategory, bearingRad } from './globeMarkers';

  // Real dark slippy-map basemap — NO API key required. (Optional upgrade: if
  // VITE_CESIUM_ION_TOKEN is set, set Cesium.Ion.defaultAccessToken and drop baseLayer to use
  // Cesium Ion World Imagery instead.) Built by a factory: StrictMode double-invokes effects.
  function makeBaseLayer(): Cesium.ImageryLayer {
    return new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png',
        maximumLevel: 18,
        credit: 'Stadia Maps, OpenMapTiles, OpenStreetMap',
      })
    );
  }

  // Idle attract-mode spin carried over from step 1 (radians/tick ~60fps); stops on interaction.
  const SPIN_PER_TICK = 0.0015;

  export const GlobeView: FC = () => {
    const dispatch = useAppDispatch();
    const entities = useAppSelector((s) => s.entities.entities);
    const activeCategory = useAppSelector((s) => s.entities.activeCategoryFilter);
    const enabledSources = useAppSelector((s) => s.sources.enabledSourceIds);
    const selectedId = useAppSelector((s) => s.entities.selectedEntityId);

    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Cesium.Viewer | null>(null);
    const billboardsRef = useRef<Cesium.BillboardCollection | null>(null);
    const byId = useRef<Map<string, Cesium.Billboard>>(new Map());

    // Mount once: create the viewer, billboard layer, and click handler.
    useEffect(() => {
      if (!containerRef.current) return;
      let viewer: Cesium.Viewer;
      try {
        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: makeBaseLayer(),
          baseLayerPicker: false, timeline: false, animation: false, geocoder: false,
          homeButton: false, sceneModePicker: false, navigationHelpButton: false,
          fullscreenButton: false, infoBox: false, selectionIndicator: false,
          requestRenderMode: true, maximumRenderTimeChange: 0.5,
          scene3DOnly: true, shouldAnimate: true, shadows: false,
        });
      } catch (err) {
        console.error('Cesium viewer failed to initialize:', err); // never swallow silently
        return;
      }

      viewer.scene.backgroundColor = Cesium.Color.BLACK;
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';

      const billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
      billboardsRef.current = billboards;
      viewerRef.current = viewer;

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
      handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = viewer.scene.pick(movement.position);
        if (picked && typeof picked.id === 'string') {
          dispatch(setSelectedEntityId(picked.id)); // billboard.id holds the entity id
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Idle attract-mode spin (from step 1): rotate until the user grabs the globe, then stop.
      // LEFT_DOWN fires before LEFT_CLICK, so clicking a marker stops the spin AND selects it.
      let spinning = true;
      const onTick = () => {
        if (spinning) viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -SPIN_PER_TICK);
      };
      viewer.clock.onTick.addEventListener(onTick);
      const stopSpin = () => { spinning = false; };
      handler.setInputAction(stopSpin, Cesium.ScreenSpaceEventType.LEFT_DOWN);
      handler.setInputAction(stopSpin, Cesium.ScreenSpaceEventType.WHEEL);

      return () => {
        viewer.clock.onTick.removeEventListener(onTick);
        handler.destroy();
        byId.current.clear();
        billboardsRef.current = null;
        viewerRef.current = null;
        if (!viewer.isDestroyed()) viewer.destroy();
      };
    }, [dispatch]);

    // Upsert billboards whenever entities / filters / selection change.
    useEffect(() => {
      const viewer = viewerRef.current;
      const billboards = billboardsRef.current;
      if (!viewer || !billboards) return;
      const map = byId.current;
      const visibleIds = new Set<string>();

      for (const entity of Object.values(entities)) {
        const visible =
          (!activeCategory || entity.category === activeCategory) &&
          (enabledSources.length === 0 || enabledSources.includes(entity.source_id));
        if (!visible) continue;
        visibleIds.add(entity.id);

        const position = Cesium.Cartesian3.fromDegrees(
          entity.longitude, entity.latitude, entity.altitude || 0
        );
        let bb = map.get(entity.id);
        if (!bb) {
          bb = billboards.add({
            id: entity.id,
            position,
            image: markerForCategory(entity.category),
            color: Cesium.Color.WHITE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
          map.set(entity.id, bb);
        } else {
          bb.position = position;
          bb.show = true;
        }
        // Markers are drawn on a 2x (64px) canvas; display at ~32px, 1.5x when selected.
        bb.scale = (entity.id === selectedId ? 1.5 : 1.0) * 0.5;

        // Aircraft & ships: rotate to travel heading derived from the last two trail points.
        // (Both silhouettes point north, so the same rotation applies.)
        if (
          (entity.category === 'aircraft' || entity.category === 'maritime') &&
          entity.trail &&
          entity.trail.length >= 2
        ) {
          const a = entity.trail[entity.trail.length - 2];
          const b = entity.trail[entity.trail.length - 1];
          bb.rotation = -bearingRad(a.latitude, a.longitude, b.latitude, b.longitude);
          bb.alignedAxis = Cesium.Cartesian3.UNIT_Z;
        }
      }

      for (const [id, bb] of map) {
        if (!visibleIds.has(id)) bb.show = false;
      }
      viewer.scene.requestRender();
    }, [entities, activeCategory, enabledSources, selectedId]);

    return (
      <Box
        ref={containerRef}
        data-testid="globe-view-container"
        sx={{ width: '100%', height: '100%', position: 'absolute', inset: 0, bgcolor: '#000' }}
      />
    );
  };
  ```

- [ ] **Step 4.2: Unit-test the marker logic (`frontend/src/components/__tests__/globeMarkers.test.ts`)**

  Cesium requires WebGL, and marker rasterization needs a real `<canvas>` 2D context — neither
  exists in jsdom — so the **globe and its rendered PNG markers are verified visually** (Step 4.4,
  Chrome DevTools MCP), never by asserting placeholder text. What we CAN unit-test is the pure
  category→style mapping and the bearing math. **Do not assert the marker is an SVG data-URI** —
  that is exactly the bug (SVG billboards crash Cesium); a passing "starts with data:image/svg+xml"
  test is a false green.

  ```typescript
  import { styleForCategory, bearingRad } from '../globeMarkers';

  describe('globe markers', () => {
    // Rasterization needs a real <canvas> 2D context (jsdom has none), so the PNG output is
    // verified visually in Step 4.4. Here we test the pure category → { icon, color } mapping.
    it('maps each known category to a distinct draw fn + color', () => {
      const sat = styleForCategory('satellite');
      const air = styleForCategory('aircraft');
      expect(sat.color).not.toEqual(air.color);
      expect(sat.draw).not.toBe(air.draw); // a distinct silhouette per category
    });

    it('falls back to a neutral style for unknown categories', () => {
      expect(styleForCategory('unknown-xyz').color).toBe('#9ca3af');
    });

    it('computes an eastward bearing near +90°', () => {
      const deg = (bearingRad(0, 0, 0, 1) * 180) / Math.PI;
      expect(deg).toBeGreaterThan(80);
      expect(deg).toBeLessThan(100);
    });
  });
  ```

  > Note: the frontend test runner is Vitest. If a plan test uses `jest.*` helpers, either enable
  > `globals: true` with the Jest-compatible API in `vitest.config.ts` or use `vi.*`. Keep the
  > runner consistent across the frontend suites.

- [ ] **Step 4.3: Assemble App Root (`frontend/src/App.tsx` & `frontend/src/main.tsx`)**

  Single-header layout: ONE `AppBar` holding the drawer button + the (now inline) stats banner,
  and a `position: relative` container that the globe fills. (Step 5 adds the filter selector and
  overlays into this same structure.)

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/App.tsx`
  ```typescript
  import { useState, type FC } from 'react';
  import { Box, AppBar, Toolbar, IconButton } from '@mui/material';
  import MenuIcon from '@mui/icons-material/Menu';
  import { useWebSocket } from './hooks/useWebSocket';
  import { GlobeView } from './components/GlobeView';
  import { TelemetryStatsBanner } from './components/TelemetryStatsBanner';
  import { LayerControlDrawer } from './components/LayerControlDrawer';
  import { EntityDetailsDrawer } from './components/EntityDetailsDrawer';

  export const App: FC = () => {
    const { isConnected, isReconnecting, messageRate } = useWebSocket();
    const [drawerOpen, setDrawerOpen] = useState(false);

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <AppBar position="static" color="default" elevation={1} sx={{ zIndex: 20 }}>
          <Toolbar variant="dense" sx={{ gap: 1 }}>
            <IconButton edge="start" color="inherit" onClick={() => setDrawerOpen(true)} aria-label="open layers">
              <MenuIcon />
            </IconButton>
            <TelemetryStatsBanner
              isConnected={isConnected}
              isReconnecting={isReconnecting}
              messageRate={messageRate}
            />
          </Toolbar>
        </AppBar>

        <Box sx={{ position: 'relative', flexGrow: 1, overflow: 'hidden' }}>
          <GlobeView />
        </Box>

        <LayerControlDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <EntityDetailsDrawer />
      </Box>
    );
  };

  export default App;
  ```

  Update `main.tsx` to add the Redux `<Provider>` (step 1's `main.tsx` had none, so any
  `useSelector` would throw). Keep the single `ThemeProvider`/`CssBaseline` here too:

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/main.tsx`
  ```tsx
  import React from 'react';
  import ReactDOM from 'react-dom/client';
  import { Provider } from 'react-redux';
  import { ThemeProvider, CssBaseline } from '@mui/material';
  import { store } from './store';
  import { tacticalTheme } from './theme';
  import App from './App';

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <ThemeProvider theme={tacticalTheme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </Provider>
    </React.StrictMode>
  );
  ```

- [ ] **Step 4.4: Verification & Definition of Done**

  - Run: `rtk make test` → all suites pass (including `globeMarkers.test.ts`).
  - Run: `rtk make lint` → 0 errors; `rtk grep -rn ": any" frontend/src/components/GlobeView.tsx`
    shows none; no empty catches.

  - [ ] **Mandatory visual verification with the Chrome DevTools MCP** (unit tests cannot see the
    globe — this is the gate that catches the failures the previous run shipped):
    1. Start the full stack (`rtk make dev`); wait for the backend to ingest some data.
    2. Navigate the browser to the frontend URL; take a **screenshot**.
    3. Confirm a **Cesium canvas** exists and shows a real dark map (zoom in — coastlines/terrain
       are recognizable), NOT a blank sphere and NOT a flat night-lights texture.
    4. Confirm **billboards are visible for every category that has live data** (satellite,
       aircraft, geological, radiation; maritime if a source exists) — not only aircraft.
    5. Read the browser **console**: it must have **zero errors**.
    6. Click a marker → the entity inspector opens; observation history populates.

  Do not mark step 4 complete until the screenshot shows the real globe with multiple categories
  of markers and the console is clean.
