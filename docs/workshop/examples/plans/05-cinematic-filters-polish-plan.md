# Implementation Plan: 05 - Cinematic Filters & Performance Polish HUD

This step-by-step TDD plan details the creation of Redux filter state management, retro CRT scanline overlays, green phosphor Night Vision overlays, FLIR thermal imaging overlays, header mode toggle controls, performance monitoring HUD, and full application polish.

---

## Task 1: Redux Filter State Slice Initialization

- [ ] **Step 1.1: Write Unit Test for `filterSlice`**

  File: `frontend/src/store/slices/__tests__/filterSlice.test.ts`
  ```typescript
  import filterReducer, {
    setFilterMode,
    toggleFpsDisplay,
    toggleLod,
    updateFps,
    FilterState,
  } from '../filterSlice';

  describe('filterSlice Reducer', () => {
    const initialState: FilterState = {
      filterMode: 'none',
      fpsVisible: true,
      lodEnabled: false,
      currentFps: 60,
    };

    it('should return default initial state', () => {
      expect(filterReducer(undefined, { type: 'unknown' })).toEqual(initialState);
    });

    it('should handle setFilterMode', () => {
      let state = filterReducer(initialState, setFilterMode('crt'));
      expect(state.filterMode).toBe('crt');

      state = filterReducer(state, setFilterMode('night_vision'));
      expect(state.filterMode).toBe('night_vision');

      state = filterReducer(state, setFilterMode('flir'));
      expect(state.filterMode).toBe('flir');
    });

    it('should handle toggleFpsDisplay', () => {
      const state = filterReducer(initialState, toggleFpsDisplay());
      expect(state.fpsVisible).toBe(false);

      const restored = filterReducer(state, toggleFpsDisplay());
      expect(restored.fpsVisible).toBe(true);
    });

    it('should handle toggleLod', () => {
      const state = filterReducer(initialState, toggleLod());
      expect(state.lodEnabled).toBe(true);

      const restored = filterReducer(state, toggleLod());
      expect(restored.lodEnabled).toBe(false);
    });

    it('should handle updateFps', () => {
      const state = filterReducer(initialState, updateFps(58));
      expect(state.currentFps).toBe(58);
    });
  });
  ```

- [ ] **Step 1.2: Implement `filterSlice.ts`**

  File: `frontend/src/store/slices/filterSlice.ts`
  ```typescript
  import { createSlice, PayloadAction } from '@reduxjs/toolkit';

  export type FilterMode = 'none' | 'crt' | 'night_vision' | 'flir';

  export interface FilterState {
    filterMode: FilterMode;
    fpsVisible: boolean;
    lodEnabled: boolean;
    currentFps: number;
  }

  const initialState: FilterState = {
    filterMode: 'none',
    fpsVisible: true,
    lodEnabled: false,
    currentFps: 60,
  };

  export const filterSlice = createSlice({
    name: 'filter',
    initialState,
    reducers: {
      setFilterMode: (state, action: PayloadAction<FilterMode>) => {
        state.filterMode = action.payload;
      },
      toggleFpsDisplay: (state) => {
        state.fpsVisible = !state.fpsVisible;
      },
      toggleLod: (state) => {
        state.lodEnabled = !state.lodEnabled;
      },
      updateFps: (state, action: PayloadAction<number>) => {
        state.currentFps = action.payload;
      },
    },
  });

  export const { setFilterMode, toggleFpsDisplay, toggleLod, updateFps } = filterSlice.actions;
  export default filterSlice.reducer;
  ```

- [ ] **Step 1.3: Update Redux Store to Include `filterSlice`**

  File: `frontend/src/store/index.ts`

  > Add the `filter` reducer but **keep** the typed hooks created in step 4 — `FilterModeSelector`
  > and `PerformanceControls` import `useAppDispatch`/`useAppSelector` from `../store`.

  ```typescript
  import { configureStore } from '@reduxjs/toolkit';
  import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
  import entitiesReducer from './slices/entitiesSlice';
  import sourcesReducer from './slices/sourcesSlice';
  import filterReducer from './slices/filterSlice';
  import { osintApi } from './api/osintApi';

  export const store = configureStore({
    reducer: {
      entities: entitiesReducer,
      sources: sourcesReducer,
      filter: filterReducer,
      [osintApi.reducerPath]: osintApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(osintApi.middleware),
  });

  export type RootState = ReturnType<typeof store.getState>;
  export type AppDispatch = typeof store.dispatch;

  export const useAppDispatch: () => AppDispatch = useDispatch;
  export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
  ```

- [ ] **Step 1.4: Run Filter Slice Tests**
  Run: `rtk npm test -- --testPathPattern=filterSlice`
  Expected Output: 4 passing tests in `filterSlice.test.ts`.

---

## Task 2: Retro CRT Scanlines & Curvature Overlay

- [ ] **Step 2.1: Create CRT Overlay CSS**

  File: `frontend/src/components/filters/crt.css`
  ```css
  .crt-overlay-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 999;
    overflow: hidden;
  }

  .crt-scanlines {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.3),
      rgba(0, 0, 0, 0.3) 1px,
      transparent 1px,
      transparent 2px
    );
    pointer-events: none;
  }

  .crt-vignette {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: radial-gradient(
      circle at center,
      transparent 55%,
      rgba(0, 0, 0, 0.5) 85%,
      rgba(0, 0, 0, 0.95) 100%
    );
    pointer-events: none;
  }

  .crt-flicker {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(18, 16, 16, 0.02);
    opacity: 0.95;
    animation: crtFlicker 0.15s infinite;
    pointer-events: none;
  }

  @keyframes crtFlicker {
    0% { opacity: 0.97; }
    50% { opacity: 1.0; }
    100% { opacity: 0.98; }
  }
  ```

- [ ] **Step 2.2: Implement `CrtOverlay.tsx` Component**

  File: `frontend/src/components/filters/CrtOverlay.tsx`
  ```tsx
  import React from 'react';
  import './crt.css';

  export const CrtOverlay: React.FC = () => {
    return (
      <div className="crt-overlay-container" data-testid="crt-overlay">
        <div className="crt-scanlines" />
        <div className="crt-vignette" />
        <div className="crt-flicker" />
      </div>
    );
  };
  ```

---

## Task 3: Night Vision Tactical Phosphor & HUD Reticles Overlay

- [ ] **Step 3.1: Create Night Vision CSS**

  File: `frontend/src/components/filters/night-vision.css`
  ```css
  .nvg-overlay-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 999;
    overflow: hidden;
  }

  .nvg-phosphor-tint {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 255, 102, 0.12);
    backdrop-filter: sepia(100%) hue-rotate(90deg) contrast(140%) brightness(90%);
    pointer-events: none;
  }

  .nvg-reticle-corner {
    position: absolute;
    width: 40px;
    height: 40px;
    border: 2px solid #00ff66;
    pointer-events: none;
    opacity: 0.8;
  }

  .nvg-top-left {
    top: 24px;
    left: 24px;
    border-right: none;
    border-bottom: none;
  }

  .nvg-top-right {
    top: 24px;
    right: 24px;
    border-left: none;
    border-bottom: none;
  }

  .nvg-bottom-left {
    bottom: 24px;
    left: 24px;
    border-right: none;
    border-top: none;
  }

  .nvg-bottom-right {
    bottom: 24px;
    right: 24px;
    border-left: none;
    border-top: none;
  }

  .nvg-center-crosshair {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 60px;
    height: 60px;
    transform: translate(-50%, -50%);
    pointer-events: none;
    opacity: 0.7;
  }

  .nvg-center-crosshair::before,
  .nvg-center-crosshair::after {
    content: '';
    position: absolute;
    background: #00ff66;
  }

  .nvg-center-crosshair::before {
    top: 29px;
    left: 0;
    width: 60px;
    height: 2px;
  }

  .nvg-center-crosshair::after {
    top: 0;
    left: 29px;
    width: 2px;
    height: 60px;
  }
  ```

- [ ] **Step 3.2: Implement `NightVisionOverlay.tsx` Component**

  File: `frontend/src/components/filters/NightVisionOverlay.tsx`
  ```tsx
  import React from 'react';
  import './night-vision.css';

  export const NightVisionOverlay: React.FC = () => {
    return (
      <div className="nvg-overlay-container" data-testid="night-vision-overlay">
        <div className="nvg-phosphor-tint" />
        <div className="nvg-reticle-corner nvg-top-left" />
        <div className="nvg-reticle-corner nvg-top-right" />
        <div className="nvg-reticle-corner nvg-bottom-left" />
        <div className="nvg-reticle-corner nvg-bottom-right" />
        <div className="nvg-center-crosshair" />
      </div>
    );
  };
  ```

---

## Task 4: FLIR Thermal Imaging Gradient Canvas Overlay

- [ ] **Step 4.1: Create FLIR Overlay CSS**

  File: `frontend/src/components/filters/flir.css`
  ```css
  .flir-overlay-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 999;
    overflow: hidden;
  }

  .flir-thermal-tint {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(255, 80, 0, 0.08);
    backdrop-filter: invert(90%) hue-rotate(180deg) contrast(180%) saturate(220%);
    pointer-events: none;
  }

  .flir-legend {
    position: absolute;
    bottom: 32px;
    right: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: rgba(0, 0, 0, 0.75);
    border: 1px solid rgba(255, 128, 0, 0.6);
    padding: 8px 12px;
    border-radius: 4px;
    pointer-events: none;
    color: #ff9900;
    font-family: monospace;
    font-size: 11px;
  }

  .flir-gradient-bar {
    width: 120px;
    height: 12px;
    margin: 4px 0;
    background: linear-gradient(
      to right,
      #000033,
      #4b0082,
      #ff0000,
      #ff7f00,
      #ffff00,
      #ffffff
    );
    border: 1px solid #444;
  }
  ```

- [ ] **Step 4.2: Implement `FlirThermalOverlay.tsx` Component**

  File: `frontend/src/components/filters/FlirThermalOverlay.tsx`
  ```tsx
  import React from 'react';
  import './flir.css';

  export const FlirThermalOverlay: React.FC = () => {
    return (
      <div className="flir-overlay-container" data-testid="flir-thermal-overlay">
        <div className="flir-thermal-tint" />
        <div className="flir-legend">
          <span>FLIR THERMAL SPECTRUM</span>
          <div className="flir-gradient-bar" />
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <span>-20°C</span>
            <span>+80°C</span>
          </div>
        </div>
      </div>
    );
  };
  ```

---

## Task 5: Header Filter Mode Selector

- [ ] **Step 5.1: Write Unit Test for `FilterModeSelector`**

  File: `frontend/src/components/__tests__/FilterModeSelector.test.tsx`
  ```tsx
  import React from 'react';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { Provider } from 'react-redux';
  import { store } from '../../store';
  import { FilterModeSelector } from '../FilterModeSelector';

  describe('FilterModeSelector Component', () => {
    it('renders all filter mode toggle options', () => {
      render(
        <Provider store={store}>
          <FilterModeSelector />
        </Provider>
      );

      expect(screen.getByText('OFF')).toBeInTheDocument();
      expect(screen.getByText('CRT')).toBeInTheDocument();
      expect(screen.getByText('NVG')).toBeInTheDocument();
      expect(screen.getByText('FLIR')).toBeInTheDocument();
    });

    it('dispatches filter mode changes on button click', () => {
      render(
        <Provider store={store}>
          <FilterModeSelector />
        </Provider>
      );

      fireEvent.click(screen.getByText('CRT'));
      expect(store.getState().filter.filterMode).toBe('crt');

      fireEvent.click(screen.getByText('NVG'));
      expect(store.getState().filter.filterMode).toBe('night_vision');

      fireEvent.click(screen.getByText('OFF'));
      expect(store.getState().filter.filterMode).toBe('none');
    });
  });
  ```

- [ ] **Step 5.2: Implement `FilterModeSelector.tsx` Component**

  File: `frontend/src/components/FilterModeSelector.tsx`
  ```tsx
  import React from 'react';
  import { ToggleButtonGroup, ToggleButton, Typography, Box } from '@mui/material';
  import { Tv, Visibility, LocalFireDepartment, PowerSettingsNew } from '@mui/icons-material';
  import { useAppDispatch, useAppSelector } from '../store';
  import { setFilterMode, FilterMode } from '../store/slices/filterSlice';

  export const FilterModeSelector: React.FC = () => {
    const dispatch = useAppDispatch();
    const activeMode = useAppSelector((state) => state.filter.filterMode);

    const handleModeChange = (
      _event: React.MouseEvent<HTMLElement>,
      newMode: FilterMode | null
    ) => {
      if (newMode !== null) {
        dispatch(setFilterMode(newMode));
      }
    };

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'bold' }}>
          VISUAL FILTER:
        </Typography>
        <ToggleButtonGroup
          value={activeMode}
          exclusive
          onChange={handleModeChange}
          size="small"
          aria-label="cinematic filter mode"
        >
          <ToggleButton value="none" aria-label="off">
            <PowerSettingsNew fontSize="small" sx={{ mr: 0.5 }} />
            OFF
          </ToggleButton>
          <ToggleButton value="crt" aria-label="crt">
            <Tv fontSize="small" sx={{ mr: 0.5 }} />
            CRT
          </ToggleButton>
          <ToggleButton value="night_vision" aria-label="night vision">
            <Visibility fontSize="small" sx={{ mr: 0.5 }} />
            NVG
          </ToggleButton>
          <ToggleButton value="flir" aria-label="flir thermal">
            <LocalFireDepartment fontSize="small" sx={{ mr: 0.5 }} />
            FLIR
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
    );
  };
  ```

- [ ] **Step 5.3: Run `FilterModeSelector` Component Tests**
  Run: `rtk npm test -- --testPathPattern=FilterModeSelector`
  Expected Output: 2 passing tests in `FilterModeSelector.test.tsx`.

---

## Task 6: Performance Controls & Live FPS Monitor

- [ ] **Step 6.1: Write Unit Test for `PerformanceControls`**

  File: `frontend/src/components/__tests__/PerformanceControls.test.tsx`
  ```tsx
  import React from 'react';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { Provider } from 'react-redux';
  import { store } from '../../store';
  import { PerformanceControls } from '../PerformanceControls';

  describe('PerformanceControls Component', () => {
    it('renders FPS counter badge and LOD switch', () => {
      render(
        <Provider store={store}>
          <PerformanceControls />
        </Provider>
      );

      expect(screen.getByText(/FPS/i)).toBeInTheDocument();
      expect(screen.getByText(/LOD Performance/i)).toBeInTheDocument();
    });

    it('toggles LOD mode when switch is clicked', () => {
      render(
        <Provider store={store}>
          <PerformanceControls />
        </Provider>
      );

      const lodSwitch = screen.getByRole('checkbox', { name: /LOD Performance/i });
      expect(store.getState().filter.lodEnabled).toBe(false);

      fireEvent.click(lodSwitch);
      expect(store.getState().filter.lodEnabled).toBe(true);
    });
  });
  ```

- [ ] **Step 6.2: Implement `PerformanceControls.tsx` Component**

  File: `frontend/src/components/PerformanceControls.tsx`
  ```tsx
  import React, { useEffect, useRef } from 'react';
  import { Box, Chip, FormControlLabel, Switch, Paper } from '@mui/material';
  import { Speed } from '@mui/icons-material';
  import { useAppDispatch, useAppSelector } from '../store';
  import { toggleLod, updateFps } from '../store/slices/filterSlice';

  export const PerformanceControls: React.FC = () => {
    const dispatch = useAppDispatch();
    const { fpsVisible, lodEnabled, currentFps } = useAppSelector((state) => state.filter);

    const frameCount = useRef(0);
    const lastTime = useRef(performance.now());
    const animFrameId = useRef<number | null>(null);

    useEffect(() => {
      const calcFps = () => {
        frameCount.current += 1;
        const now = performance.now();
        const delta = now - lastTime.current;

        if (delta >= 1000) {
          const fps = Math.round((frameCount.current * 1000) / delta);
          dispatch(updateFps(fps));
          frameCount.current = 0;
          lastTime.current = now;
        }

        animFrameId.current = requestAnimationFrame(calcFps);
      };

      animFrameId.current = requestAnimationFrame(calcFps);

      return () => {
        if (animFrameId.current !== null) {
          cancelAnimationFrame(animFrameId.current);
        }
      };
    }, [dispatch]);

    return (
      <Paper
        elevation={4}
        sx={{
          position: 'absolute',
          bottom: 24,
          left: 24,
          p: 1,
          px: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          backgroundColor: 'rgba(18, 24, 38, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(0, 240, 255, 0.2)',
          zIndex: 1000,
        }}
      >
        {fpsVisible && (
          <Chip
            icon={<Speed fontSize="small" />}
            label={`${currentFps} FPS`}
            color={currentFps >= 55 ? 'success' : currentFps >= 30 ? 'warning' : 'error'}
            size="small"
            variant="outlined"
          />
        )}
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={lodEnabled}
              onChange={() => dispatch(toggleLod())}
              inputProps={{ 'aria-label': 'LOD Performance' }}
            />
          }
          label="LOD Performance"
          slotProps={{ typography: { variant: 'caption', color: 'text.secondary' } }}
        />
      </Paper>
    );
  };
  ```

- [ ] **Step 6.3: Run `PerformanceControls` Component Tests**
  Run: `rtk npm test -- --testPathPattern=PerformanceControls`
  Expected Output: 2 passing tests in `PerformanceControls.test.tsx`.

---

## Task 7: Comprehensive Overlay Test Suite & App Dashboard Integration

- [ ] **Step 7.1: Write Integration Test Suite for Filter Overlays**

  File: `frontend/src/components/filters/__tests__/FilterOverlays.test.tsx`
  ```tsx
  import React from 'react';
  import { render, screen } from '@testing-library/react';
  import { Provider } from 'react-redux';
  import { configureStore } from '@reduxjs/toolkit';
  import filterReducer, { FilterMode } from '../../../store/slices/filterSlice';
  import { CrtOverlay } from '../CrtOverlay';
  import { NightVisionOverlay } from '../NightVisionOverlay';
  import { FlirThermalOverlay } from '../FlirThermalOverlay';

  const createTestStore = (mode: FilterMode) =>
    configureStore({
      reducer: { filter: filterReducer },
      preloadedState: {
        filter: {
          filterMode: mode,
          fpsVisible: true,
          lodEnabled: false,
          currentFps: 60,
        },
      },
    });

  describe('Cinematic Filter Overlay Components', () => {
    it('renders CRT overlay correctly', () => {
      render(
        <Provider store={createTestStore('crt')}>
          <CrtOverlay />
        </Provider>
      );
      expect(screen.getByTestId('crt-overlay')).toBeInTheDocument();
    });

    it('renders Night Vision overlay correctly', () => {
      render(
        <Provider store={createTestStore('night_vision')}>
          <NightVisionOverlay />
        </Provider>
      );
      expect(screen.getByTestId('night-vision-overlay')).toBeInTheDocument();
    });

    it('renders FLIR Thermal overlay correctly', () => {
      render(
        <Provider store={createTestStore('flir')}>
          <FlirThermalOverlay />
        </Provider>
      );
      expect(screen.getByTestId('flir-thermal-overlay')).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 7.2: Integrate Overlays and Controls into Main `App.tsx`**

  Extend the step-4 single-header layout by adding `FilterModeSelector` into the **same** `AppBar`
  and the overlays/`PerformanceControls` into the **same** relative content container. Do NOT add a
  second top bar. Theme/Provider stay in `main.tsx` (one theme). `useWebSocket` takes an options
  object or no arg — never a bare string. The inline `TelemetryStatsBanner` already renders the
  title, so there is no separate title `Typography` (that would duplicate it).

  File: `frontend/src/App.tsx`
  ```tsx
  import { useState, type FC } from 'react';
  import { Box, AppBar, Toolbar, IconButton } from '@mui/material';
  import { Layers as LayersIcon } from '@mui/icons-material';
  import { GlobeView } from './components/GlobeView';
  import { LayerControlDrawer } from './components/LayerControlDrawer';
  import { EntityDetailsDrawer } from './components/EntityDetailsDrawer';
  import { TelemetryStatsBanner } from './components/TelemetryStatsBanner';
  import { FilterModeSelector } from './components/FilterModeSelector';
  import { PerformanceControls } from './components/PerformanceControls';
  import { CrtOverlay } from './components/filters/CrtOverlay';
  import { NightVisionOverlay } from './components/filters/NightVisionOverlay';
  import { FlirThermalOverlay } from './components/filters/FlirThermalOverlay';
  import { useWebSocket } from './hooks/useWebSocket';
  import { useAppSelector } from './store';

  export const App: FC = () => {
    const [layerDrawerOpen, setLayerDrawerOpen] = useState(false);
    const { isConnected, isReconnecting, messageRate } = useWebSocket(); // options object or none
    const filterMode = useAppSelector((state) => state.filter.filterMode);

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        {/* ONE header (z 20). The inline banner + drawer button + filter selector all live here. */}
        <AppBar position="static" color="default" elevation={1} sx={{ zIndex: 20 }}>
          <Toolbar variant="dense" sx={{ gap: 1 }}>
            <IconButton edge="start" color="inherit" onClick={() => setLayerDrawerOpen(true)} aria-label="open layers">
              <LayersIcon />
            </IconButton>
            <TelemetryStatsBanner
              isConnected={isConnected}
              isReconnecting={isReconnecting}
              messageRate={messageRate}
            />
            <FilterModeSelector />
          </Toolbar>
        </AppBar>

        {/* Relative content container: globe (z 0) < overlays (z 10, pointer-events:none) < HUD */}
        <Box sx={{ position: 'relative', flexGrow: 1, overflow: 'hidden' }}>
          <GlobeView />
          {filterMode === 'crt' && <CrtOverlay />}
          {filterMode === 'night_vision' && <NightVisionOverlay />}
          {filterMode === 'flir' && <FlirThermalOverlay />}
          <PerformanceControls />
        </Box>

        <LayerControlDrawer open={layerDrawerOpen} onClose={() => setLayerDrawerOpen(false)} />
        <EntityDetailsDrawer />
      </Box>
    );
  };

  export default App;
  ```

- [ ] **Step 7.3: Verification & Definition of Done**

  - Run: `rtk make test` and `rtk make lint` → all suites pass, 0 lint errors (no unused imports;
    `noUnusedLocals`/`noUnusedParameters` stay `true`).
  - Confirm one theme only: `rtk grep -rn "darkTheme" frontend/src` returns nothing.

  - [ ] **Mandatory visual verification with the Chrome DevTools MCP** (the reported bug —
    invisible header controls — is only catchable by looking):
    1. Start the full stack (`rtk make dev`); navigate to the app; **screenshot**.
    2. Confirm ALL header controls are visible in ONE top bar and clickable: drawer button,
       title, connection chip, and the OFF/CRT/NVG/FLIR `FilterModeSelector`.
    3. Click the drawer button → the layer drawer opens (category filters + source toggles visible).
    4. Toggle each filter OFF→CRT→NVG→FLIR: screenshot each; confirm the overlay appears AND the
       globe underneath still drags/zooms (overlays are `pointer-events: none`).
    5. Confirm the browser **console has zero errors** throughout.
