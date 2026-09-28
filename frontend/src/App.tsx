import { useState, type FC } from 'react';
import { Box, AppBar, Toolbar, IconButton } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { HUD_HEADER_HEIGHT } from './theme';
import { useWebSocket } from './hooks/useWebSocket';
import { useAppSelector } from './store';
import { GlobeView } from './components/GlobeView';
import { TelemetryStatsBanner } from './components/TelemetryStatsBanner';
import { LayerControlDrawer } from './components/LayerControlDrawer';
import { EntityDetailsDrawer } from './components/EntityDetailsDrawer';
import { FilterModeSelector } from './components/FilterModeSelector';
import { GlobeStyleSelector } from './components/GlobeStyleSelector';
import { PerformanceControls } from './components/PerformanceControls';
import { CrtOverlay } from './components/filters/CrtOverlay';
import { NightVisionOverlay } from './components/filters/NightVisionOverlay';
import { FlirThermalOverlay } from './components/filters/FlirThermalOverlay';

/**
 * Single-header layout: ONE AppBar (drawer button + inline stats banner + filter selector)
 * stacked above a `position: relative` container that the globe fills. Because the header is
 * `static` inside a flex column, the globe is always exactly the remaining height — nothing
 * overlaps at any viewport size, and the drawers scroll internally rather than overflowing a
 * short window.
 *
 * Z-INDEX CONTRACT (step 5) — top of the stack last:
 *   globe canvas            0   GlobeView, fills the relative content container
 *   cinematic overlays      10  CRT / NVG / FLIR, `pointer-events: none` (never eat globe input)
 *   HUD                     20  PerformanceControls
 *   drawers / modals        1200 (MUI default)
 *   header AppBar           modal + 1 — the step-4 fix: telemetry read-outs must stay visible
 *                           and clickable even while a drawer is open.
 */
export const App: FC = () => {
  const { isConnected, isReconnecting, messageRate } = useWebSocket();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const filterMode = useAppSelector((state) => state.filter.filterMode);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden'
      }}
    >
      <AppBar
        position="static"
        color="default"
        elevation={0}
        sx={{
          // Above the drawers (which render at zIndex.modal): the telemetry readouts must stay
          // visible while a side panel is open, at every viewport size.
          zIndex: (theme) => theme.zIndex.modal + 1,
          flexShrink: 0,
          background: 'rgba(0,0,0,0.85)',
          // Inset shadow, not a border: a border adds 1px and the header would overlap the drawers.
          boxShadow: 'inset 0 -1px 0 #1f2937'
        }}
      >
        {/* Exactly HUD_HEADER_HEIGHT, one row: the drawers are pinned at `top: HUD_HEADER_HEIGHT`,
            so a header that wrapped taller would slide over the top of the inspector. */}
        <Toolbar
          variant="dense"
          sx={{
            gap: 1,
            height: HUD_HEADER_HEIGHT,
            minHeight: HUD_HEADER_HEIGHT,
            flexWrap: 'nowrap',
            overflowX: 'auto',
            overflowY: 'hidden'
          }}
        >
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => setDrawerOpen(true)}
            aria-label="open layers"
          >
            <MenuIcon />
          </IconButton>
          <TelemetryStatsBanner
            isConnected={isConnected}
            isReconnecting={isReconnecting}
            messageRate={messageRate}
          />
          <FilterModeSelector />
          <GlobeStyleSelector />
        </Toolbar>
      </AppBar>

      <Box sx={{ position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'hidden' }}>
        <GlobeView />
        {filterMode === 'crt' && <CrtOverlay />}
        {filterMode === 'night_vision' && <NightVisionOverlay />}
        {filterMode === 'flir' && <FlirThermalOverlay />}
        <PerformanceControls />
      </Box>

      <LayerControlDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <EntityDetailsDrawer />
    </Box>
  );
};

export default App;
