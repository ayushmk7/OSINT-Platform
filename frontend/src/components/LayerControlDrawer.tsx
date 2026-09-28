import { useMemo, useState, type FC } from 'react';
import {
  Box,
  ButtonBase,
  Collapse,
  FormControlLabel,
  IconButton,
  Switch,
  Tooltip
} from '@mui/material';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useAppDispatch, useAppSelector } from '../store';
import { toggleSourceEnabled } from '../store/slices/sourcesSlice';
import { setActiveCategoryFilter } from '../store/slices/entitiesSlice';
import { MARKER_CATEGORIES, colorForCategory } from './globeMarkers';
import { hud, eyebrow, monoValue } from '../theme';
import { HudPanel, CategoryGlyph, CATEGORY_META, categoryLabel } from './HudPrimitives';

export interface LayerControlDrawerProps {
  /** Expanded panel vs. the collapsed "Layers" launcher. */
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
}

const numberFormat = new Intl.NumberFormat('en-US');

/**
 * Persistent Layers panel, doubling as the map legend. Each row shows the category's real
 * marker glyph, its name + description and live count; clicking a row isolates that layer
 * (the same `activeCategoryFilter` the globe reads), clicking it again shows everything.
 * Data-source switches below map 1:1 to `toggleSourceEnabled`.
 *
 * Positioning is owned by the parent (App) — this component only renders the surface.
 */
export const LayerControlDrawer: FC<LayerControlDrawerProps> = ({ open, onClose, onOpen }) => {
  const dispatch = useAppDispatch();
  const sources = useAppSelector((state) => state.sources.sources);
  const enabledSourceIds = useAppSelector((state) => state.sources.enabledSourceIds);
  const activeCategory = useAppSelector((state) => state.entities.activeCategoryFilter);
  const entities = useAppSelector((state) => state.entities.entities);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  // Live per-layer counts, so a layer that is on but empty is visibly different from one that
  // is simply switched off.
  const { counts, total } = useMemo(() => {
    const tally: Record<string, number> = {};
    let n = 0;
    for (const ent of Object.values(entities)) {
      tally[ent.category] = (tally[ent.category] ?? 0) + 1;
      n += 1;
    }
    return { counts: tally, total: n };
  }, [entities]);

  const sourceList = Object.values(sources);

  if (!open) {
    return (
      <HudPanel sx={{ pointerEvents: 'auto', display: 'inline-flex' }}>
        <ButtonBase
          onClick={onOpen}
          aria-label="open layer controls"
          sx={{
            height: 44,
            px: 1.5,
            gap: 1,
            borderRadius: `${hud.radius}px`,
            color: hud.textPrimary,
            fontSize: '0.8125rem',
            fontWeight: 500
          }}
        >
          <LayersOutlinedIcon sx={{ fontSize: 18, color: hud.accent }} />
          Layers
          <Box
            component="span"
            sx={{ ...monoValue, color: hud.textSecondary, fontSize: '0.75rem' }}
          >
            {numberFormat.format(total)}
          </Box>
        </ButtonBase>
      </HudPanel>
    );
  }

  return (
    <HudPanel
      component="aside"
      aria-label="Layer controls"
      sx={{
        pointerEvents: 'auto',
        width: '100%',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 2,
          pr: 1,
          height: 48,
          flexShrink: 0,
          borderBottom: `1px solid ${hud.hairline}`
        }}
      >
        <LayersOutlinedIcon sx={{ fontSize: 18, color: hud.accent }} />
        <Box component="h2" sx={{ m: 0, fontSize: '0.875rem', fontWeight: 600, flexGrow: 1 }}>
          Layers
        </Box>
        {activeCategory !== null && (
          <ButtonBase
            onClick={() => dispatch(setActiveCategoryFilter(null))}
            sx={{
              fontSize: '0.75rem',
              color: hud.accent,
              px: 1,
              height: 26,
              borderRadius: '6px',
              '&:hover': { bgcolor: hud.accentSoft }
            }}
          >
            Show all
          </ButtonBase>
        )}
        <Tooltip title="Collapse panel">
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="collapse layer controls"
            sx={{ color: hud.textSecondary }}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', p: 1 }}>
        <Box sx={{ ...eyebrow, px: 1, pt: 0.5, pb: 1, display: 'flex' }}>
          <span>Map legend</span>
          <Box component="span" sx={{ ml: 'auto', ...monoValue, letterSpacing: 0 }}>
            {numberFormat.format(total)}
          </Box>
        </Box>

        <Box role="list" sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {MARKER_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat;
            const isHidden = activeCategory !== null && !isActive;
            const count = counts[cat] ?? 0;
            const color = colorForCategory(cat);
            return (
              <Box role="listitem" key={cat}>
                <ButtonBase
                  aria-pressed={isActive}
                  onClick={() => dispatch(setActiveCategoryFilter(isActive ? null : cat))}
                  sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    px: 1,
                    py: 0.75,
                    borderRadius: '8px',
                    textAlign: 'left',
                    opacity: isHidden ? 0.42 : 1,
                    bgcolor: isActive ? `${color}14` : 'transparent',
                    boxShadow: isActive ? `inset 0 0 0 1px ${color}40` : 'none',
                    transition: 'background-color 120ms, opacity 120ms',
                    '&:hover': { bgcolor: isActive ? `${color}1f` : hud.surfaceHover, opacity: 1 }
                  }}
                >
                  <CategoryGlyph category={cat} />
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Box
                      sx={{
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        color: hud.textPrimary,
                        lineHeight: 1.3
                      }}
                    >
                      {categoryLabel(cat)}
                    </Box>
                    <Box sx={{ fontSize: '0.6875rem', color: hud.textSecondary, lineHeight: 1.3 }}>
                      {CATEGORY_META[cat]?.description ?? 'Tracked entities'}
                    </Box>
                  </Box>
                  <Box
                    component="span"
                    sx={{
                      ...monoValue,
                      fontSize: '0.75rem',
                      color: count > 0 ? hud.textPrimary : hud.textMuted
                    }}
                  >
                    {numberFormat.format(count)}
                  </Box>
                </ButtonBase>
              </Box>
            );
          })}
        </Box>

        <Box sx={{ height: '1px', bgcolor: hud.hairline, mx: 1, my: 1.25 }} />

        <ButtonBase
          onClick={() => setSourcesOpen((v) => !v)}
          aria-expanded={sourcesOpen}
          sx={{ ...eyebrow, width: '100%', px: 1, py: 0.75, borderRadius: '6px', gap: 0.5 }}
        >
          <span>Data sources</span>
          <Box
            component="span"
            sx={{ ml: 'auto', ...monoValue, letterSpacing: 0, color: hud.textSecondary }}
          >
            {enabledSourceIds.length}/{sourceList.length}
          </Box>
          <ExpandMoreIcon
            sx={{
              fontSize: 16,
              transition: 'transform 150ms',
              transform: sourcesOpen ? 'rotate(180deg)' : 'none'
            }}
          />
        </ButtonBase>
        <Collapse in={sourcesOpen}>
          <Box sx={{ display: 'flex', flexDirection: 'column', px: 1, pb: 0.5 }}>
            {sourceList.map((src) => (
              <FormControlLabel
                key={src.id}
                labelPlacement="start"
                control={
                  <Switch
                    size="small"
                    checked={enabledSourceIds.includes(src.id)}
                    onChange={() => dispatch(toggleSourceEnabled(src.id))}
                  />
                }
                label={src.name}
                slotProps={{
                  typography: {
                    sx: {
                      fontSize: '0.8125rem',
                      color: hud.textPrimary,
                      flexGrow: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }
                  }
                }}
                sx={{ m: 0, justifyContent: 'space-between', gap: 1, minHeight: 34 }}
              />
            ))}
            {sourceList.length === 0 && (
              <Box sx={{ fontSize: '0.75rem', color: hud.textMuted, py: 1 }}>
                Awaiting source list from telemetry stream…
              </Box>
            )}
          </Box>
        </Collapse>
      </Box>
    </HudPanel>
  );
};
