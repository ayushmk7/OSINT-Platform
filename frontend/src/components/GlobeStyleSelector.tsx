import { useState, type FC, type MouseEvent } from 'react';
import { Box, Button, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip } from '@mui/material';
import RadarIcon from '@mui/icons-material/Radar';
import PublicIcon from '@mui/icons-material/Public';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import PolylineIcon from '@mui/icons-material/Polyline';
import TerrainIcon from '@mui/icons-material/Terrain';
import BlurOnIcon from '@mui/icons-material/BlurOn';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { SvgIconComponent } from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../store';
import { setGlobeStyle } from '../store/slices/filterSlice';
import { GLOBE_STYLES, GLOBE_STYLE_LABELS, type GlobeStyle } from './globeStyles';
import { hud, eyebrow } from '../theme';

const STYLE_ICONS: Record<GlobeStyle, SvgIconComponent> = {
  tactical: RadarIcon,
  blue_marble: PublicIcon,
  night_lights: NightsStayIcon,
  neon_vector: PolylineIcon,
  terrain_relief: TerrainIcon,
  holographic: BlurOnIcon
};

/**
 * Base-map picker: a compact trigger showing the active style by name, opening a named list.
 * Switching only swaps the globe's own imagery/overlays — markers, ATC zones, camera and the
 * WebSocket feed are untouched (see GlobeStyleController).
 */
export const GlobeStyleSelector: FC = () => {
  const dispatch = useAppDispatch();
  const activeStyle = useAppSelector((state) => state.filter.globeStyle);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);
  const ActiveIcon = STYLE_ICONS[activeStyle];

  const choose = (style: GlobeStyle) => {
    dispatch(setGlobeStyle(style));
    setAnchor(null);
  };

  return (
    <>
      <Tooltip title="Base map style">
        <Button
          id="globe-style-trigger"
          aria-label="globe style"
          aria-haspopup="menu"
          aria-expanded={open ? 'true' : undefined}
          aria-controls={open ? 'globe-style-menu' : undefined}
          onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
          startIcon={<ActiveIcon sx={{ fontSize: '16px !important', color: hud.accent }} />}
          endIcon={<ExpandMoreIcon sx={{ fontSize: '16px !important', color: hud.textMuted }} />}
          sx={{
            height: 36,
            px: 1.25,
            borderRadius: '9px',
            color: hud.textPrimary,
            fontSize: '0.75rem',
            fontWeight: 500,
            bgcolor: 'rgba(255,255,255,0.035)',
            whiteSpace: 'nowrap',
            minWidth: 0,
            '& .MuiButton-startIcon': { mr: { xs: 0, md: 0.75 } },
            '& .MuiButton-endIcon': { ml: 0.5 },
            '&:hover': { bgcolor: hud.surfaceHover }
          }}
        >
          <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
            {GLOBE_STYLE_LABELS[activeStyle]}
          </Box>
        </Button>
      </Tooltip>
      <Menu
        id="globe-style-menu"
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 210 } } }}
        MenuListProps={{ 'aria-labelledby': 'globe-style-trigger' }}
      >
        <Box sx={{ ...eyebrow, px: 1.25, pt: 0.75, pb: 0.75 }}>Base map</Box>
        {GLOBE_STYLES.map((style) => {
          const Icon = STYLE_ICONS[style];
          const selected = style === activeStyle;
          return (
            <MenuItem
              key={style}
              role="menuitemradio"
              aria-checked={selected}
              selected={selected}
              onClick={() => choose(style)}
            >
              <ListItemIcon sx={{ minWidth: '30px !important' }}>
                <Icon sx={{ fontSize: 17, color: selected ? hud.accent : hud.textSecondary }} />
              </ListItemIcon>
              <ListItemText
                primary={GLOBE_STYLE_LABELS[style]}
                primaryTypographyProps={{ fontSize: '0.8125rem', fontWeight: selected ? 600 : 400 }}
              />
              {selected && <CheckIcon sx={{ fontSize: 16, color: hud.accent, ml: 2 }} />}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
};
