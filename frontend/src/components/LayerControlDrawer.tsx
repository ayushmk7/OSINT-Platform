import type { FC } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Divider,
  ButtonGroup,
  Button
} from '@mui/material';
import { useAppDispatch, useAppSelector } from '../store';
import { toggleSourceEnabled } from '../store/slices/sourcesSlice';
import { setActiveCategoryFilter } from '../store/slices/entitiesSlice';
import { MARKER_CATEGORIES, colorForCategory } from './globeMarkers';
import { HUD_HEADER_HEIGHT } from '../theme';

export interface LayerControlDrawerProps {
  open: boolean;
  onClose: () => void;
}

export const LayerControlDrawer: FC<LayerControlDrawerProps> = ({ open, onClose }) => {
  const dispatch = useAppDispatch();
  const sources = useAppSelector((state) => state.sources.sources);
  const enabledSourceIds = useAppSelector((state) => state.sources.enabledSourceIds);
  const activeCategory = useAppSelector((state) => state.entities.activeCategoryFilter);

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      PaperProps={{
        // Column layout + an internally scrolling body: on a short viewport (≈650px) the
        // controls scroll inside the panel instead of overflowing past the window edge.
        sx: {
          width: 300,
          maxWidth: '85vw',
          top: HUD_HEADER_HEIGHT,
          height: `calc(100% - ${HUD_HEADER_HEIGHT}px)`,
          maxHeight: `calc(100vh - ${HUD_HEADER_HEIGHT}px)`,
          bgcolor: '#0a0a0a',
          color: '#fff',
          borderRight: '1px solid #1f2937',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      <Box sx={{ px: 2, pt: 2, pb: 1, flexShrink: 0 }}>
        <Typography variant="h6" sx={{ color: 'primary.main', letterSpacing: '0.1em' }}>
          LAYER CONTROLS
        </Typography>
      </Box>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />

      <Box sx={{ p: 2, flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
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
          {MARKER_CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? 'contained' : 'outlined'}
              onClick={() => dispatch(setActiveCategoryFilter(cat))}
              sx={{ textTransform: 'uppercase', justifyContent: 'flex-start', gap: 1 }}
            >
              <Box
                component="span"
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '2px',
                  bgcolor: colorForCategory(cat),
                  flexShrink: 0
                }}
              />
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
                  size="small"
                  sx={{ color: 'primary.main', '&.Mui-checked': { color: 'primary.main' } }}
                />
              }
              label={src.name}
              slotProps={{ typography: { variant: 'body2' } }}
            />
          ))}
          {Object.keys(sources).length === 0 && (
            <Typography variant="caption" sx={{ color: '#666' }}>
              Awaiting source list from telemetry stream…
            </Typography>
          )}
        </FormGroup>
      </Box>
    </Drawer>
  );
};
