import { useEffect, useRef, type FC } from 'react';
import { Chip, FormControlLabel, Switch, Paper } from '@mui/material';
import SpeedIcon from '@mui/icons-material/Speed';
import { useAppDispatch, useAppSelector } from '../store';
import { toggleLod, updateFps } from '../store/slices/filterSlice';

/**
 * Floating performance HUD (bottom-left of the globe container): live FPS read-out measured on a
 * `requestAnimationFrame` loop over a 1-second rolling window, plus the Level-of-Detail toggle
 * that downsamples the globe's render resolution on weaker GPUs.
 *
 * Z-INDEX CONTRACT: sits at 20 (HUD tier) — above the cinematic overlays (10) so a filter never
 * paints over the read-out, below the drawers/modals (MUI default 1200).
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

  return (
    <Paper
      elevation={4}
      data-testid="performance-controls"
      sx={{
        position: 'absolute',
        bottom: 24,
        left: 24,
        zIndex: 20,
        p: 1,
        px: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        backgroundColor: 'rgba(10, 10, 10, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(0, 255, 157, 0.25)'
      }}
    >
      {fpsVisible && (
        <Chip
          icon={<SpeedIcon fontSize="small" />}
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
