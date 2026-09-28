import { useMemo, useState, type FC } from 'react';
import {
  Box,
  ButtonBase,
  Collapse,
  FormControlLabel,
  IconButton,
  InputBase,
  Switch,
  Tooltip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useAppDispatch, useAppSelector } from '../store';
import { toggleSourceEnabled } from '../store/slices/sourcesSlice';
import { setActiveCategoryFilter } from '../store/slices/entitiesSlice';
import { hud, eyebrow, monoValue } from '../theme';
import { HudPanel, CategoryGlyph } from './HudPrimitives';
import { buildLegend, countByLayer, filterLegend, type LegendLayer } from './legend';

export interface LayerControlDrawerProps {
  /** Expanded panel vs. the collapsed "Layers" launcher. */
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
}

const numberFormat = new Intl.NumberFormat('en-US');

/** Show the quick-filter box once the legend has more layers than fit comfortably. */
const FILTER_MIN_LAYERS = 8;

/**
 * Persistent Layers panel, doubling as the map legend. The legend is built from the sources'
 * `layer` blocks, grouped by `layer.group` (collapsible), each row showing the layer's real
 * marker glyph, name + description and live count; clicking a row isolates that layer id (the
 * same `activeCategoryFilter` the globe reads), clicking it again shows everything. Scales to
 * dozens of layers: the list scrolls, groups collapse, and a quick filter narrows it.
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  // Live per-layer counts, so a layer that is on but empty is visibly different from one that
  // is simply switched off.
  const { groups, total, layerCount } = useMemo(() => {
    const counts = countByLayer(entities, sources);
    const all = buildLegend(sources, counts);
    return {
      groups: all,
      total: Object.keys(entities).length,
      layerCount: all.reduce((n, g) => n + g.layers.length, 0)
    };
  }, [entities, sources]);
  const visibleGroups = useMemo(() => filterLegend(groups, query), [groups, query]);
  const filtering = query.trim() !== '';

  // Indicator sources draw nothing on the globe, so they get no toggle here.
  const sourceList = Object.values(sources).filter((src) => src.kind !== 'indicator');

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

        {layerCount >= FILTER_MIN_LAYERS && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              mx: 1,
              mb: 1,
              px: 1,
              height: 30,
              borderRadius: '8px',
              bgcolor: hud.surfaceHover,
              border: `1px solid ${hud.hairline}`
            }}
          >
            <SearchIcon sx={{ fontSize: 16, color: hud.textMuted }} />
            <InputBase
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${layerCount} layers`}
              inputProps={{ 'aria-label': 'filter layers' }}
              sx={{ flexGrow: 1, fontSize: '0.8125rem', color: hud.textPrimary }}
            />
          </Box>
        )}

        {visibleGroups.map((group) => {
          const isOpen = filtering || !collapsed[group.name];
          return (
            <Box key={group.name} sx={{ mb: 0.5 }}>
              <ButtonBase
                onClick={() => setCollapsed((c) => ({ ...c, [group.name]: !c[group.name] }))}
                aria-expanded={isOpen}
                aria-label={`${group.name} group`}
                sx={{
                  ...eyebrow,
                  width: '100%',
                  px: 1,
                  py: 0.5,
                  borderRadius: '6px',
                  gap: 0.5,
                  '&:hover': { bgcolor: hud.surfaceHover }
                }}
              >
                <ExpandMoreIcon
                  sx={{
                    fontSize: 14,
                    transition: 'transform 150ms',
                    transform: isOpen ? 'none' : 'rotate(-90deg)'
                  }}
                />
                <span>{group.name}</span>
                <Box component="span" sx={{ color: hud.textMuted, letterSpacing: 0 }}>
                  · {group.layers.length}
                </Box>
                <Box
                  component="span"
                  sx={{ ml: 'auto', ...monoValue, letterSpacing: 0, color: hud.textSecondary }}
                >
                  {numberFormat.format(group.count)}
                </Box>
              </ButtonBase>
              <Collapse in={isOpen} unmountOnExit>
                <Box role="list" sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {group.layers.map((layer) => (
                    <LegendRow
                      key={layer.id}
                      layer={layer}
                      activeCategory={activeCategory}
                      onToggle={(id) =>
                        dispatch(setActiveCategoryFilter(activeCategory === id ? null : id))
                      }
                    />
                  ))}
                </Box>
              </Collapse>
            </Box>
          );
        })}
        {filtering && visibleGroups.length === 0 && (
          <Box sx={{ fontSize: '0.75rem', color: hud.textMuted, px: 1, py: 1 }}>
            No layer matches “{query.trim()}”.
          </Box>
        )}

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
            {sourceList.filter((src) => enabledSourceIds.includes(src.id)).length}/
            {sourceList.length}
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

/** One legend row: glyph, name + description, live count. Click isolates the layer. */
const LegendRow: FC<{
  layer: LegendLayer;
  activeCategory: string | null;
  onToggle: (id: string) => void;
}> = ({ layer, activeCategory, onToggle }) => {
  const isActive = activeCategory === layer.id;
  const isHidden = activeCategory !== null && !isActive;
  const { color, count } = layer;
  return (
    <Box role="listitem">
      <ButtonBase
        aria-pressed={isActive}
        onClick={() => onToggle(layer.id)}
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
        <CategoryGlyph category={layer.id} icon={layer.icon} color={color} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Box
            sx={{
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: hud.textPrimary,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {layer.name}
          </Box>
          {layer.description && (
            <Box
              sx={{
                fontSize: '0.6875rem',
                color: hud.textSecondary,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {layer.description}
            </Box>
          )}
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
};
