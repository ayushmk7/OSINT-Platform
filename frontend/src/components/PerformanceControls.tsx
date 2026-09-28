import { useEffect, useRef, type FC } from 'react';
import { Box, FormControlLabel, Switch, Tooltip } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../store';
import { toggleLod, updateFps } from '../store/slices/filterSlice';
import { hud, monoValue } from '../theme';
import { HudPanel } from './HudPrimitives';

/**
 * Compact performance chip (bottom-right, positioned by App): live FPS read-out measured on a
 * `requestAnimationFrame` loop over a 1-second rolling window, plus the Level-of-Detail toggle
 * that downsamples the globe's render resolution on weaker GPUs.
 *
 * Z-INDEX CONTRACT: rendered inside App's HUD layer (20) — above the cinematic overlays (10) so a
 * filter never paints over the read-out.
 */
export const PerformanceControls: FC = () => {
  const dispatch = useAppDispatch();
  const fpsVisible = useAppSelector((state) => state.filter.fpsVisible);
  const lodEnabled = useAppSelector((state) => state.filter.lodEnabled);
  const currentFps = useAppSelector((state) => state.filter.currentFps);

  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());
  const animFrameId = useRef<number | null>(null);

  useEffect(() => {
    const calcFps = () => {
      frameCount.current += 1;
      const now = performance.now();
      const delta = now - lastTime.current;

      if (delta >= 1000) {
        dispatch(updateFps(Math.round((frameCount.current * 1000) / delta)));
        frameCount.current = 0;
        lastTime.current = now;
      }

      animFrameId.current = requestAnimationFrame(calcFps);
    };

    animFrameId.current = requestAnimationFrame(calcFps);

    return () => {
      if (animFrameId.current !== null) cancelAnimationFrame(animFrameId.current);
    };
  }, [dispatch]);

  const fpsColor = currentFps >= 55 ? hud.accent : currentFps >= 30 ? hud.warning : hud.danger;

  return (
    <HudPanel
      data-testid="performance-controls"
      sx={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        height: 36,
        pl: 1.25,
        pr: 0.5,
        borderRadius: '10px'
      }}
    >
      {fpsVisible && (
        <Tooltip title="Render frame rate">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: fpsColor }} />
            <Box
              sx={{ ...monoValue, fontSize: '0.75rem', color: hud.textPrimary, minWidth: '3.2em' }}
            >
              {`${currentFps} FPS`}
            </Box>
          </Box>
        </Tooltip>
      )}
      <Box aria-hidden sx={{ width: '1px', height: 18, bgcolor: hud.hairline }} />
      <Tooltip title="Level-of-detail mode: lowers render resolution on weaker GPUs">
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={lodEnabled}
              onChange={() => dispatch(toggleLod())}
              inputProps={{ 'aria-label': 'LOD Performance' }}
            />
          }
          label="LOD"
          labelPlacement="start"
          sx={{ m: 0, gap: 0.25 }}
          slotProps={{
            typography: { sx: { fontSize: '0.75rem', color: hud.textSecondary, fontWeight: 500 } }
          }}
        />
      </Tooltip>
    </HudPanel>
  );
};
