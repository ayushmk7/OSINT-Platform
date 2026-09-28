import type { FC, MouseEvent } from 'react';
import { ToggleButtonGroup, ToggleButton, Typography, Box, Tooltip } from '@mui/material';
import RadarIcon from '@mui/icons-material/Radar';
import PublicIcon from '@mui/icons-material/Public';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import PolylineIcon from '@mui/icons-material/Polyline';
import TerrainIcon from '@mui/icons-material/Terrain';
import BlurOnIcon from '@mui/icons-material/BlurOn';
import { useAppDispatch, useAppSelector } from '../store';
import { setGlobeStyle } from '../store/slices/filterSlice';
import { GLOBE_STYLES, GLOBE_STYLE_LABELS, type GlobeStyle } from './globeStyles';

const STYLE_ICONS: Record<GlobeStyle, FC<{ fontSize?: 'small' }>> = {
  tactical: RadarIcon,
  blue_marble: PublicIcon,
  night_lights: NightsStayIcon,
  neon_vector: PolylineIcon,
  terrain_relief: TerrainIcon,
  holographic: BlurOnIcon
};

/**
 * Live base-look switch for the globe, sitting inline in the single header `AppBar` next to the
 * cinematic FilterModeSelector and using the same toggle-group language. Icon-only buttons (with
 * tooltips + aria-labels) keep six options inside the header at laptop widths.
 *
 * Switching only swaps the globe's own imagery/overlays — markers, ATC zones, camera and the
 * WebSocket feed are untouched (see GlobeStyleController).
 */
export const GlobeStyleSelector: FC = () => {
  const dispatch = useAppDispatch();
  const activeStyle = useAppSelector((state) => state.filter.globeStyle);

  const handleStyleChange = (_event: MouseEvent<HTMLElement>, newStyle: GlobeStyle | null) => {
    // ToggleButtonGroup emits `null` when the active button is re-clicked; keep the current style.
    if (newStyle !== null) dispatch(setGlobeStyle(newStyle));
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
      <Typography
        variant="caption"
        noWrap
        sx={{ color: 'text.secondary', fontWeight: 'bold', display: { xs: 'none', xl: 'block' } }}
      >
        GLOBE:
      </Typography>
      <ToggleButtonGroup
        value={activeStyle}
        exclusive
        onChange={handleStyleChange}
        size="small"
        aria-label="globe style"
        sx={{
          '& .MuiToggleButton-root': {
            color: '#9ca3af',
            borderColor: '#1f2937',
            px: 0.75,
            py: 0.25
          },
          '& .Mui-selected': {
            color: '#00d3ff !important',
            borderColor: 'rgba(0,211,255,0.5) !important',
            bgcolor: 'rgba(0,211,255,0.12) !important'
          }
        }}
      >
        {GLOBE_STYLES.map((style) => {
          const Icon = STYLE_ICONS[style];
          const label = GLOBE_STYLE_LABELS[style];
          return (
            <ToggleButton key={style} value={style} aria-label={label}>
              <Tooltip title={label}>
                <Icon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
    </Box>
  );
};
