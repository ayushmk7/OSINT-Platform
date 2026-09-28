# PROMPT 5: Cinematic Filters & Performance Polish HUD

You are an expert Frontend & UI/UX Engineer specializing in React 18, TypeScript, Redux Toolkit, CSS3 animations, SVG/GLSL canvas post-processing filters, and Material UI (MUI).

Your task is to generate a Superpowers Spec and Implementation Plan, then execute Step 5 of the ReconVillage OSINT Platform: building cinematic post-processing visual overlays (CRT Scanlines, Night Vision Phosphor, FLIR Thermal Imaging), state management for visual filters and performance controls, header mode selectors, and a real-time FPS monitoring banner.

## Instructions & Constraints
- **Redux State Management for Visual Filters**:
  - `frontend/src/store/slices/filterSlice.ts`: Redux state slice defining visual filter modes (`none`, `crt`, `night_vision`, `flir`), active FPS monitor toggle (`fpsVisible`), LOD performance toggle (`lodEnabled`), and current FPS measurement (`currentFps`).
- **Cinematic Post-Processing Overlays**:
  - `frontend/src/components/filters/CrtOverlay.tsx` & `crt.css`: Retro CRT scanlines overlay, raster curvature vignette, subtle RGB chromatic aberration, and raster flicker.
  - `frontend/src/components/filters/NightVisionOverlay.tsx` & `night-vision.css`: Green-monochrome phosphor aesthetic filter (`#00ff66`), noise grain overlay, corner tactical reticles, crosshairs, and grid lines.
  - `frontend/src/components/filters/FlirThermalOverlay.tsx` & `flir.css`: FLIR thermal imaging mode with false-color ironbow / white-hot gradient canvas filter and color legend overlay.
  - **Pointer Events Constraint**: All visual overlay components MUST set `pointer-events: none` on wrapper elements to ensure full interactivity with the underlying 3D Globe canvas.
- **Tactical Filter Controls & Performance HUD**:
  - `frontend/src/components/FilterModeSelector.tsx`: MUI toggle button group positioned in the header bar for seamless switching between `OFF`, `CRT`, `NVG`, and `FLIR` modes.
  - `frontend/src/components/PerformanceControls.tsx`: Tactical HUD overlay displaying live FPS counter and Level-of-Detail (LOD) toggle switch to maintain smooth 60 FPS rendering on low-end GPUs.
- **Header/HUD must stay visible (critical)**: In the previous run the header controls (drawer
  button, title, filter selector) were invisible because an absolutely-positioned
  `TelemetryStatsBanner` (z-index 1100) painted over the `AppBar`. There must be **exactly ONE**
  top bar, with an explicit z-index contract: globe `0` < cinematic overlays `10`
  (`pointer-events: none`) < HUD/header `20` < drawers/modals (MUI default). The drawer button,
  title, connection chip, and filter selector must all be visible and clickable.
- **Typed hooks exist**: `FilterModeSelector` and `PerformanceControls` import
  `useAppDispatch`/`useAppSelector` from `../store` — these MUST have been created in step 4's
  store (they were referenced but never defined before, which is a compile error).
- **One theme**: import `tacticalTheme` from `../theme` (green-on-black). Do not reference a
  second `darkTheme` file.
- **Superpowers Alignment**: Create `docs/superpowers/specs/05-cinematic-filters-polish-spec.md` and `docs/superpowers/plans/05-cinematic-filters-polish-plan.md` first, then follow TDD to execute the plan.
- **RTK Usage (agent shell ONLY)**: Prefix *your own* shell commands with `rtk`. Never write `rtk` into any committed file.

## Format Requirements
1. First, create the technical spec file at `docs/superpowers/specs/05-cinematic-filters-polish-spec.md`.
2. Second, create the step-by-step TDD implementation plan at `docs/superpowers/plans/05-cinematic-filters-polish-plan.md`.
3. Finally, execute the implementation plan step-by-step, verifying with `rtk make test` and `rtk make lint`.

## Analysis Steps
1. Analyze visual filter CSS/SVG filter algorithms (CRT scanline repeat gradients, vignette radial gradients, phosphor color matrices, false-color thermal gradients).
2. Design Redux `filterSlice` state interface and actions (`setFilterMode`, `toggleFpsDisplay`, `toggleLod`, `updateFps`).
3. Construct `CrtOverlay`, `NightVisionOverlay`, and `FlirThermalOverlay` components with non-blocking pointer events (`pointer-events: none`).
4. Implement `FilterModeSelector` MUI header component with icons and active button highlighting.
5. Implement `PerformanceControls` component with requestAnimationFrame-based FPS measurement loop.
6. Construct comprehensive unit and component test suites (`filterSlice.test.ts`, `FilterOverlays.test.tsx`, `FilterModeSelector.test.tsx`, `PerformanceControls.test.tsx`).

## Input Data
=============================================
Project Target: ReconVillage Cinematic Post-Processing Overlays & Performance Polish
Stack: React 18, TypeScript, Redux Toolkit, Material UI (Dark Theme), CSS3 Animations, SVG Filters

Component & File Breakdown:
- `frontend/src/store/slices/filterSlice.ts`: Redux slice for filter state and performance toggles
- `frontend/src/components/filters/CrtOverlay.tsx` & `crt.css`: CRT scanlines, raster curvature & chromatic aberration
- `frontend/src/components/filters/NightVisionOverlay.tsx` & `night-vision.css`: Green phosphor, noise grain & HUD reticles
- `frontend/src/components/filters/FlirThermalOverlay.tsx` & `flir.css`: FLIR ironbow thermal false-color overlay
- `frontend/src/components/FilterModeSelector.tsx`: Header mode toggle button group
- `frontend/src/components/PerformanceControls.tsx`: Live FPS monitor counter and LOD performance toggle
=============================================

## Hard Requirements & Definition of Done

Step 5 is **done** only when verified with the **Chrome DevTools MCP** (the reported failure —
invisible header controls — is only catchable by looking at the running app):

1. **One header, everything visible & clickable.** Screenshot the app: the drawer button, the
   title, the connection chip, and the `FilterModeSelector` (OFF/CRT/NVG/FLIR) are all visible in
   a single top bar. Click the drawer button → the layer drawer opens. No control is hidden under
   another element.
2. **Z-index contract** enforced: globe `0` < overlays `10` (`pointer-events:none`) < header `20`
   < drawers. Toggle each filter (OFF→CRT→NVG→FLIR): the corresponding overlay appears, and the
   globe underneath **still drags/zooms** (overlays never intercept pointer events).
3. **Typed hooks** `useAppDispatch`/`useAppSelector` are imported from `../store` and compile.
4. **One theme** (`tacticalTheme`); no `darkTheme` reference; no dead/unused imports
   (`noUnusedLocals`/`noUnusedParameters` stay `true`).
5. **`useWebSocket` called correctly** (options object or no arg — not a bare string), and the
   connection status the banner shows reflects `isConnected`/`isReconnecting`.
6. Console has **zero errors** on load and while switching filters.
