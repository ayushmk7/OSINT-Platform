# Technical Specification: 05 - Cinematic Filters & Performance Polish HUD

## 1. Overview

This specification details the architecture for the cinematic post-processing visual filter system and performance monitoring HUD in the MK-OSINT. Built using React 18, Redux Toolkit, Material UI (MUI), and CSS3/SVG post-processing shaders, Step 5 transforms the live 3D geospatial dashboard into an immersive, military-grade tactical workstation.

The system provides three distinct post-processing visualization modes:
1. **Retro CRT Scanlines (`crt`)**: Simulates classic cathode-ray tube raster displays with curved screen vignettes, scanline frequency grids, and chromatic RGB color separation.
2. **Night Vision Phosphor (`night_vision`)**: Simulates green-monochrome phosphor night-vision goggles (NVG) with animated noise grain, corner HUD targeting reticles, central crosshairs, and tactical grid lines.
3. **FLIR Thermal Imaging (`flir`)**: Simulates Forward Looking Infrared (FLIR) thermal cameras utilizing an ironbow false-color palette canvas filter and thermal color legend bar.

Additionally, Step 5 introduces a real-time Performance HUD containing a live FPS counter and Level-of-Detail (LOD) rendering toggle to maintain high frame rates on lower-spec hardware.

---

## 2. System Architecture & UI Layer Stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Material UI App Header                             │
│  [ MK-OSINT ] [ Telemetry Stats ] [ Filter Mode Selector Toggle ] │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────┴──────────────────────────────────────┐
│                    Cinematic Overlay Container Layer                        │
│                 (All Overlays: pointer-events: none)                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Active Overlay (CrtOverlay | NightVisionOverlay | FlirThermalOverlay) │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────┴──────────────────────────────────────┐
│                        3D Globe Canvas & HUD Layer                          │
│  [ GlobeView (CesiumJS) ]            [ PerformanceControls (FPS & LOD) ]   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────┴──────────────────────────────────────┐
│                            Redux Store State                                │
│       [ filterSlice: mode, fpsVisible, lodEnabled, currentFps ]             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Z-index contract (fixes the "header/filters not visible" bug)
There is **exactly one** top bar (the step-4 `AppBar`); the step-5 `FilterModeSelector` is placed
*inside* it. Never add a second, absolutely-positioned banner over the `AppBar` — that is what hid
the drawer button, title, and filters in the previous run. Layers stack in this order:

| Layer | z-index | Notes |
|---|---|---|
| Globe canvas (CesiumJS) | 0 | fills the relative content container |
| Cinematic overlays (CRT/NVG/FLIR) | 10 | **`pointer-events: none`** — never intercept globe input |
| HUD / header (`AppBar`, `PerformanceControls`) | 20 | always visible & clickable |
| Drawers / modals | 1200 (MUI default) | above everything |

`TelemetryStatsBanner` is an **inline** row inside the single `AppBar`, not an absolute overlay.
The overlays' containers must set `pointer-events: none` so dragging/zooming the globe still works.

---

## 3. Redux Store & State Architecture (`frontend/src/store/slices/filterSlice.ts`)

The `filterSlice` controls the active visual mode, performance monitoring toggles, and live frame-rate telemetry.

### 3.1 State Type Definitions

```typescript
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
```

### 3.2 Slice Actions & Reducers

- `setFilterMode(mode: FilterMode)`: Sets the currently active cinematic overlay (`none`, `crt`, `night_vision`, or `flir`).
- `toggleFpsDisplay()`: Toggles the visibility of the real-time FPS counter in the Performance HUD.
- `toggleLod()`: Toggles the Level-of-Detail performance rendering mode.
- `updateFps(fps: number)`: Updates the current measured frame rate.

---

## 4. Visual Filter Algorithms & Component Specs

To ensure the 3D globe remains fully interactive (click, drag, zoom, hover), **all visual filter overlay wrapper elements MUST apply `pointer-events: none`**.

### 4.1 CRT Scanlines & Curvature Overlay (`CrtOverlay.tsx` / `crt.css`)

Simulates a vintage CRT monitor with raster line patterns, curvature vignette, and subtle RGB chromatic separation.

#### CSS Shader Specification:
- **Scanlines**: Repeating linear gradient background overlay:
  ```css
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.25),
    rgba(0, 0, 0, 0.25) 1px,
    transparent 1px,
    transparent 2px
  );
  ```
- **Curvature & Vignette**: Radial gradient simulation overlay creating edge darkness and convex lens illusion:
  ```css
  background: radial-gradient(
    circle at center,
    transparent 60%,
    rgba(0, 0, 0, 0.6) 90%,
    rgba(0, 0, 0, 0.95) 100%
  );
  ```
- **Raster Flicker**: Subtle keyframe opacity pulsation (`opacity: 0.97` to `1.0` at 60Hz) creating realistic screen phosphor refresh behavior.

### 4.2 Night Vision Phosphor & Reticles (`NightVisionOverlay.tsx` / `night-vision.css`)

Simulates tactical P43 green phosphor night-vision goggles equipped with targeting HUD overlays.

#### Visual Specification:
- **Phosphor Color Matrix Filter**: Full-screen backdrop color matrix filter mapping brightness to high-contrast green shades (`#00ff66` / `#003311`):
  ```css
  backdrop-filter: sepia(100%) hue-rotate(90deg) saturate(300%) contrast(150%) brightness(90%);
  ```
- **SVG Noise Grain Layer**: SVG `feTurbulence` noise pattern animated across the viewport to simulate thermal sensor gain noise.
- **Corner Reticles & Crosshair**: Absolute-positioned SVG HUD reticles in four corners with L-shaped target indicators, central target crosshairs, and pitch/roll grid ticks.

### 4.3 FLIR Thermal Imaging (`FlirThermalOverlay.tsx` / `flir.css`)

Simulates Forward Looking Infrared thermal sensors using a classic Ironbow false-color mapping spectrum.

#### Visual Specification:
- **Ironbow False Color Palette**: Maps luminance channels to a vibrant ironbow gradient (Black → Deep Indigo → Crimson → Vivid Orange → Bright Yellow → White):
  ```css
  backdrop-filter: invert(100%) hue-rotate(180deg) contrast(200%) saturate(250%);
  ```
- **Thermal Scale Legend**: Floating tactical HUD element in the lower-right corner displaying temperature color spectrum gradient bar (`-20°C` COLD to `+80°C` HOT) and FLIR sensor status indicators.

---

## 5. Control Components & Performance HUD

### 5.1 Filter Mode Selector (`FilterModeSelector.tsx`)

Positioned in the main navigation bar. Built using MUI `ToggleButtonGroup`.

- **Options**:
  - `OFF` (`none`): Standard high-definition dark mode view.
  - `CRT` (`crt`): Retro scanline filter mode with CRT icon.
  - `NVG` (`night_vision`): Night-vision phosphor mode with eye/scope icon.
  - `FLIR` (`flir`): Thermal imaging mode with flame/sensor icon.
- Connected directly to Redux store via `useAppDispatch` and `useAppSelector`.

### 5.2 Performance Controls & FPS Monitor (`PerformanceControls.tsx`)

Floating HUD panel located in the lower-left corner.

- **FPS Monitoring Engine**: Uses a `requestAnimationFrame` loop measuring deltas across a 1-second rolling window to compute exact FPS.
- **LOD Toggle**: MUI `Switch` control bound to `filterSlice.lodEnabled`. When enabled, downsamples geometry trail points on the 3D Globe for enhanced frame rates.

---

## 6. Performance Benchmarking Targets

- **Frame Rate Target**: Maintain $\ge 60$ FPS with active overlays on mid-tier GPUs.
- **Non-Blocking Pointer Layering**: 0ms interaction latency delay on globe mouse drag/zoom operations (`pointer-events: none`).
- **GPU Hardware Acceleration**: All CSS overlay animations enforce hardware layer promotion via `will-change: transform, opacity` and `transform: translateZ(0)`.

---

## 7. Hard Requirements & Definition of Done

Step 5 is **done** only when verified with the Chrome DevTools MCP:

1. **One header; all controls visible & clickable** — drawer button, title, connection chip, and
   `FilterModeSelector` (OFF/CRT/NVG/FLIR) in a single top bar. No absolutely-positioned banner
   over the `AppBar`.
2. **Z-index contract** (globe 0 < overlays 10 `pointer-events:none` < header 20 < drawers) holds:
   toggling each filter shows its overlay while the globe underneath still drags/zooms.
3. **Typed hooks** `useAppDispatch`/`useAppSelector` imported from `../store` and compile; the
   store still exports them after adding `filterReducer`.
4. **One theme** (`tacticalTheme`); no `darkTheme` reference anywhere.
5. **`useWebSocket`** called with an options object or no arg (not a bare string); the banner
   reflects `isConnected`/`isReconnecting`.
6. No unused imports (`noUnusedLocals`/`noUnusedParameters` = `true`); console clean while
   switching filters.
