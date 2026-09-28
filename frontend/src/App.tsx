import { useEffect, useState, type FC } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useWebSocket } from './hooks/useWebSocket';
import { useAppSelector } from './store';
import { GlobeView } from './components/GlobeView';
import { TelemetryStatsBanner } from './components/TelemetryStatsBanner';
import { LayerControlDrawer } from './components/LayerControlDrawer';
import { EntityDetailsDrawer } from './components/EntityDetailsDrawer';
import { FilterModeSelector } from './components/FilterModeSelector';
import { GlobeStyleSelector } from './components/GlobeStyleSelector';
import { PerformanceControls } from './components/PerformanceControls';
import { IntelDock, type DockTab } from './components/IntelDock';
import { SearchBox } from './components/SearchBox';
import { HudPanel } from './components/HudPrimitives';
import { CrtOverlay } from './components/filters/CrtOverlay';
import { NightVisionOverlay } from './components/filters/NightVisionOverlay';
import { FlirThermalOverlay } from './components/filters/FlirThermalOverlay';

/** Top offset of the side panels on tablet/desktop: gutter + top bar (52) + 12px gap. */
const SIDE_TOP = 80;

/**
 * Full-bleed layout: the globe fills the viewport and every HUD element floats above it on a
 * glass panel. The HUD layer itself is `pointer-events: none`; only the panels opt back in, so
 * the globe stays draggable everywhere between them.
 *
 * Z-INDEX CONTRACT — top of the stack last:
 *   globe canvas            0   GlobeView
 *   cinematic overlays      10  CRT / NVG / FLIR, `pointer-events: none` (never eat globe input)
 *   HUD layer               20  top bar, layers, inspector, performance chip
 *   menus / tooltips        1300+ (MUI default)
 *
 * Right column (sm+): the intel dock (Feed / Signals / AI tabs); a selected entity's card
 * takes its place until closed. Phones (< sm): the search box gets its own row, the dock sits
 * under the top bar (collapsed to its tab strip by default), and layers and the inspector are
 * bottom sheets; the layers panel folds away whenever an entity or the dock is opened.
 */
export const App: FC = () => {
  const { isConnected, isReconnecting, messageRate } = useWebSocket();
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [layersOpen, setLayersOpen] = useState(() => !isPhone);
  const [dockOpen, setDockOpen] = useState(() => !isPhone);
  const [dockTab, setDockTab] = useState<DockTab>('feed');
  const filterMode = useAppSelector((state) => state.filter.filterMode);
  const selectedId = useAppSelector((state) => state.entities.selectedEntityId);

  useEffect(() => {
    if (isPhone && selectedId) {
      setLayersOpen(false);
      setDockOpen(false);
    }
  }, [isPhone, selectedId]);

  // Phones have room for one sheet at a time.
  const openDock = (open: boolean) => {
    setDockOpen(open);
    if (open && isPhone) setLayersOpen(false);
  };
  const openLayers = () => {
    setLayersOpen(true);
    if (isPhone) setDockOpen(false);
  };

  const dock = (
    <IntelDock tab={dockTab} onTabChange={setDockTab} open={dockOpen} onOpenChange={openDock} />
  );

  const gutter = { xs: 1, sm: 2 };
  const sheet = { left: 8, right: 8, bottom: 8, top: 'auto' } as const;

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        bgcolor: 'background.default'
      }}
    >
      <Box sx={{ position: 'absolute', inset: 0 }}>
        <GlobeView />
        {filterMode === 'crt' && <CrtOverlay />}
        {filterMode === 'night_vision' && <NightVisionOverlay />}
        {filterMode === 'flir' && <FlirThermalOverlay />}
      </Box>

      <Box
        data-testid="hud-layer"
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 20,
          pointerEvents: 'none',
          p: gutter
        }}
      >
        {/* Top bar: brand + telemetry on the left, view controls on the right. */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1
          }}
        >
          <TelemetryStatsBanner
            isConnected={isConnected}
            isReconnecting={isReconnecting}
            messageRate={messageRate}
          />
          <Box
            sx={{
              flex: { xs: '1 1 140px', md: '1 1 280px' },
              maxWidth: { md: 440 },
              mx: { md: 'auto' },
              minWidth: 0
            }}
          >
            <SearchBox />
          </Box>
          <HudPanel
            role="toolbar"
            aria-label="View controls"
            sx={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              p: '6px',
              ml: { xs: 'auto', md: 0 }
            }}
          >
            <FilterModeSelector />
            <GlobeStyleSelector />
          </HudPanel>
        </Box>

        {/* Layers / legend */}
        <Box
          sx={{
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: { xs: 'flex-end', sm: 'flex-start' },
            alignItems: 'flex-start',
            pointerEvents: 'none',
            left: { xs: 8, sm: 16 },
            right: { xs: layersOpen ? 8 : 'auto', sm: 'auto' },
            top: { xs: 'auto', sm: SIDE_TOP },
            bottom: { xs: 8, sm: 16 },
            width: { sm: 288 },
            maxHeight: { xs: '58%', sm: 'none' },
            zIndex: 2
          }}
        >
          <LayerControlDrawer
            open={layersOpen}
            onOpen={openLayers}
            onClose={() => setLayersOpen(false)}
          />
        </Box>

        {/* Right column (sm+): entity card when something is selected, else the intel dock.
            The dock stays mounted underneath so its tabs keep their data and filters. */}
        <Box
          sx={{
            position: 'absolute',
            display: { xs: 'none', sm: 'flex' },
            flexDirection: 'column',
            alignItems: 'flex-end',
            pointerEvents: 'none',
            right: 16,
            top: SIDE_TOP,
            bottom: 64,
            width: 360,
            zIndex: 2,
            visibility: selectedId ? 'hidden' : 'visible'
          }}
        >
          {!isPhone && dock}
        </Box>

        {/* Phones: the dock sits under the top bar. */}
        {isPhone && !selectedId && (
          <Box
            sx={{
              position: 'relative',
              mt: 1,
              display: 'flex',
              justifyContent: 'flex-end',
              height: dockOpen ? 'min(52vh, 460px)' : 'auto',
              pointerEvents: 'none',
              zIndex: 2
            }}
          >
            {dock}
          </Box>
        )}

        {/* Entity inspector */}
        <Box
          sx={{
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: { xs: 'flex-end', sm: 'flex-start' },
            pointerEvents: 'none',
            left: { xs: sheet.left, sm: 'auto' },
            right: { xs: sheet.right, sm: 16 },
            top: { xs: sheet.top, sm: SIDE_TOP },
            bottom: { xs: sheet.bottom, sm: 64 },
            width: { sm: 360 },
            maxHeight: { xs: '62%', sm: 'none' },
            zIndex: 3
          }}
        >
          <EntityDetailsDrawer />
        </Box>

        {/* Performance chip */}
        <Box
          sx={{
            position: 'absolute',
            right: { xs: 8, sm: 16 },
            bottom: { xs: 8, sm: 16 },
            zIndex: 1,
            pointerEvents: 'none'
          }}
        >
          <PerformanceControls />
        </Box>
      </Box>
    </Box>
  );
};

export default App;
