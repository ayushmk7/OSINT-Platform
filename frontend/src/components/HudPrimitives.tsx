import { forwardRef, type ReactNode } from 'react';
import { Box, type BoxProps } from '@mui/material';
import { glassSurface, hud, eyebrow, monoValue } from '../theme';
import { colorForCategory, markerForCategory, markerForIcon } from './globeMarkers';

/** Floating translucent panel: the one surface every HUD element sits on. */
export const HudPanel = forwardRef<HTMLDivElement, BoxProps>(({ sx, ...rest }, ref) => (
  <Box ref={ref} {...rest} sx={[glassSurface, ...(Array.isArray(sx) ? sx : [sx])]} />
));
HudPanel.displayName = 'HudPanel';

/** Human names + one-line legend descriptions for every marker category. */
export const CATEGORY_META: Record<
  string,
  { label: string; singular: string; description: string }
> = {
  satellite: { label: 'Satellites', singular: 'Satellite', description: 'Orbital tracks' },
  aircraft: { label: 'Aircraft', singular: 'Aircraft', description: 'Military ADS-B' },
  geological: { label: 'Geological', singular: 'Seismic event', description: 'Seismic events' },
  radiation: { label: 'Radiation', singular: 'Radiation sensor', description: 'Safecast sensors' },
  maritime: { label: 'Maritime', singular: 'Vessel', description: 'Vessel positions' },
  atc_zone: { label: 'ATC zones', singular: 'ATC zone', description: 'Airport control zones' }
};

/** Layer name (plural), e.g. "ATC zones". */
export function categoryLabel(category: string): string {
  return CATEGORY_META[category]?.label ?? category.replace(/_/g, ' ');
}

/** Single-entity badge name, e.g. "ATC zone". */
export function categorySingular(category: string): string {
  return CATEGORY_META[category]?.singular ?? category.replace(/_/g, ' ');
}

/**
 * The layer's real globe marker (same rasterised PNG), falling back to a colour swatch. With an
 * `icon` (data-driven `display.icon`) it draws that registry glyph in `color`; without one it
 * draws the legacy category silhouette.
 */
export const CategoryGlyph = ({
  category,
  icon,
  color: colorOverride,
  size = 18
}: {
  category: string;
  icon?: string | null;
  color?: string;
  size?: number;
}) => {
  const color = colorOverride ?? colorForCategory(category);
  const src = icon ? markerForIcon(icon, color) : markerForCategory(category);
  return (
    <Box
      aria-hidden
      sx={{
        width: size + 10,
        height: size + 10,
        flexShrink: 0,
        borderRadius: '8px',
        display: 'grid',
        placeItems: 'center',
        bgcolor: `${color}14`,
        boxShadow: `inset 0 0 0 1px ${color}33`
      }}
    >
      {src ? (
        <Box component="img" src={src} alt="" sx={{ width: size, height: size }} />
      ) : (
        <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: color }} />
      )}
    </Box>
  );
};

/** Label-over-value readout used in the top bar. */
export const StatReadout = ({
  label,
  value,
  unit,
  ariaLabel
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  ariaLabel: string;
}) => (
  <Box role="group" aria-label={ariaLabel} sx={{ minWidth: 0 }}>
    <Box sx={eyebrow}>{label}</Box>
    <Box
      sx={{
        ...monoValue,
        fontSize: '0.875rem',
        fontWeight: 500,
        color: hud.textPrimary,
        lineHeight: 1.35,
        whiteSpace: 'nowrap'
      }}
    >
      {value}
      {unit && (
        <Box component="span" sx={{ color: hud.textMuted, ml: 0.5, fontSize: '0.75rem' }}>
          {unit}
        </Box>
      )}
    </Box>
  </Box>
);

/** Thin vertical hairline between groups inside a panel. */
export const PanelDivider = () => (
  <Box aria-hidden sx={{ width: '1px', alignSelf: 'stretch', my: 1, bgcolor: hud.hairline }} />
);
