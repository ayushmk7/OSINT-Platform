import { useEffect, useState, type FC, type ReactNode } from 'react';
import { Box, IconButton, Button, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useAppDispatch, useAppSelector } from '../store';
import { setSelectedEntityId, parseEntityMetadata } from '../store/slices/entitiesSlice';
import { useGetObservationsQuery } from '../store/api/osintApi';
import { colorForCategory, ATC_ZONE_CATEGORY } from './globeMarkers';
import { hud, eyebrow, monoValue } from '../theme';
import { HudPanel, CategoryGlyph, categorySingular } from './HudPrimitives';

const OBSERVATION_LIMIT = 25;

/** Render a metadata value as text, or an em-dash when the field is absent. */
function fieldText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function formatCoord(value: number, pos: string, neg: string): string {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? pos : neg}`;
}

/** "12s ago" / "4m ago" / "3h ago" / "2d ago". */
export function relativeTime(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const Section: FC<{ title: string; aside?: ReactNode; children: ReactNode }> = ({
  title,
  aside,
  children
}) => (
  <Box component="section" sx={{ px: 2, py: 1.75, borderTop: `1px solid ${hud.hairline}` }}>
    <Box sx={{ ...eyebrow, display: 'flex', alignItems: 'center', mb: 1.25 }}>
      <Box component="h3" sx={{ m: 0, font: 'inherit' }}>
        {title}
      </Box>
      {aside && <Box sx={{ ml: 'auto', letterSpacing: 0, textTransform: 'none' }}>{aside}</Box>}
    </Box>
    {children}
  </Box>
);

/** One label/value cell of the key-facts grid. */
const Fact: FC<{ label: string; children: ReactNode; wide?: boolean }> = ({
  label,
  children,
  wide
}) => (
  <Box sx={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
    <Box sx={{ fontSize: '0.6875rem', color: hud.textSecondary, mb: 0.25 }}>{label}</Box>
    <Box
      sx={{
        ...monoValue,
        fontSize: '0.8125rem',
        color: hud.textPrimary,
        overflowWrap: 'anywhere'
      }}
    >
      {children}
    </Box>
  </Box>
);

/** Metadata key/value rows. */
const KeyValueTable: FC<{ rows: [string, ReactNode][] }> = ({ rows }) => (
  <Box
    component="dl"
    sx={{
      m: 0,
      display: 'grid',
      gridTemplateColumns: 'minmax(96px, 38%) 1fr',
      columnGap: 1.5,
      rowGap: 0.75,
      fontSize: '0.75rem'
    }}
  >
    {rows.map(([k, v]) => (
      <Box key={k} sx={{ display: 'contents' }}>
        <Box component="dt" sx={{ color: hud.textSecondary, overflowWrap: 'anywhere' }}>
          {k}
        </Box>
        <Box
          component="dd"
          sx={{ m: 0, ...monoValue, color: hud.textPrimary, overflowWrap: 'anywhere' }}
        >
          {v}
        </Box>
      </Box>
    ))}
  </Box>
);

/**
 * Entity inspector: a non-modal floating card (the globe behind stays visible and clickable).
 * Positioning is owned by the parent (App); this renders nothing when no entity is selected.
 */
export const EntityDetailsDrawer: FC = () => {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((state) => state.entities.selectedEntityId);
  const entity = useAppSelector((state) =>
    selectedId ? (state.entities.entities[selectedId] ?? null) : null
  );
  const now = useNow(1000);

  // Load observation history over REST — this is what exercises the step-3 API.
  const { data: obsData, isFetching } = useGetObservationsQuery(
    { entity_id: selectedId ?? '', limit: OBSERVATION_LIMIT },
    { skip: !selectedId }
  );

  // Escape closes the inspector.
  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch(setSelectedEntityId(null));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, dispatch]);

  const handleClose = () => dispatch(setSelectedEntityId(null));

  if (!entity) return null;

  const observations = obsData?.observations ?? [];
  // Speed/heading live on observations, not on the entity row — take the newest sample.
  const latest = observations[0];

  const color = colorForCategory(entity.category);
  const isAtcZone = entity.category === ATC_ZONE_CATEGORY;
  const meta = parseEntityMetadata(entity.metadata);
  // Link-out ONLY — LiveATC's terms forbid third-party embedding of the streams themselves, so
  // this opens their own public search page in a new tab. Never an <audio> element.
  const liveatcUrl = typeof meta.liveatc_url === 'string' ? meta.liveatc_url : null;
  const atcKeys = new Set([
    'icao',
    'iata_code',
    'municipality',
    'airport_type',
    'radius_km',
    'zone_note',
    'liveatc_url'
  ]);
  const metaRows: [string, ReactNode][] = Object.entries(meta)
    .filter(([k]) => !(isAtcZone && atcKeys.has(k)))
    .map(([k, v]) => [k.replace(/_/g, ' '), fieldText(v)]);
  const updated = new Date(entity.timestamp);

  return (
    <HudPanel
      component="aside"
      aria-label="Entity details"
      sx={{
        pointerEvents: 'auto',
        width: '100%',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, p: 2, pb: 1.75 }}>
        <CategoryGlyph category={entity.category} size={20} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              px: 0.9,
              borderRadius: '5px',
              fontSize: '0.6875rem',
              fontWeight: 600,
              color,
              bgcolor: `${color}1a`,
              border: `1px solid ${color}40`
            }}
          >
            {categorySingular(entity.category)}
          </Box>
          <Box
            component="h2"
            sx={{
              m: 0,
              mt: 0.75,
              fontSize: '1rem',
              fontWeight: 600,
              lineHeight: 1.3,
              letterSpacing: '-0.01em',
              overflowWrap: 'anywhere'
            }}
          >
            {entity.name}
          </Box>
          <Box
            sx={{
              ...monoValue,
              fontSize: '0.6875rem',
              color: hud.textMuted,
              mt: 0.25,
              overflowWrap: 'anywhere'
            }}
          >
            {entity.id}
          </Box>
        </Box>
        <Tooltip title="Close (Esc)">
          <IconButton
            size="small"
            onClick={handleClose}
            aria-label="close inspector"
            sx={{ color: hud.textSecondary, mt: -0.5, mr: -0.75 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
        {/*
          Deliberately ABOVE the generic facts: the LiveATC link-out is the point of this layer,
          and on short viewports anything lower falls past the fold of the card's scroll.
        */}
        {isAtcZone && (
          <Section title="ATC control zone">
            <KeyValueTable
              rows={[
                ['ICAO', fieldText(meta.icao)],
                ['IATA', fieldText(meta.iata_code)],
                ['Municipality', fieldText(meta.municipality)],
                ['Airport type', fieldText(meta.airport_type)],
                ['Zone radius', meta.radius_km === undefined ? '—' : `${String(meta.radius_km)} km`]
              ]}
            />
            {typeof meta.zone_note === 'string' && (
              <Box sx={{ fontSize: '0.75rem', color: hud.textSecondary, mt: 1.25 }}>
                {meta.zone_note}
              </Box>
            )}
            {liveatcUrl && (
              <Button
                component="a"
                href={liveatcUrl}
                target="_blank"
                rel="noopener noreferrer"
                fullWidth
                startIcon={<HeadphonesIcon />}
                endIcon={<OpenInNewIcon sx={{ fontSize: '14px !important' }} />}
                sx={{
                  mt: 1.5,
                  height: 34,
                  borderRadius: '8px',
                  color,
                  bgcolor: `${color}14`,
                  border: `1px solid ${color}40`,
                  '&:hover': { bgcolor: `${color}24` }
                }}
              >
                Listen to ATC (LiveATC.net)
              </Button>
            )}
            <Box sx={{ fontSize: '0.6875rem', color: hud.textMuted, mt: 1 }}>
              Opens LiveATC.net in a new tab — audio is never embedded or proxied here.
            </Box>
          </Section>
        )}

        <Section title="Position">
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <Fact label="Latitude">{`${entity.latitude.toFixed(4)}°`}</Fact>
            <Fact label="Longitude">{`${entity.longitude.toFixed(4)}°`}</Fact>
            <Fact label="Altitude">{`${entity.altitude.toLocaleString()} m`}</Fact>
            <Fact label="Speed">{latest ? `${latest.speed.toLocaleString()} kt` : '—'}</Fact>
            <Fact label="Heading">{latest ? `${latest.heading.toFixed(1)}°` : '—'}</Fact>
            <Fact label="Source">{entity.source_id}</Fact>
          </Box>
          <Box sx={{ ...monoValue, fontSize: '0.6875rem', color: hud.textMuted, mt: 1.25 }}>
            {formatCoord(entity.latitude, 'N', 'S')}, {formatCoord(entity.longitude, 'E', 'W')}
          </Box>
        </Section>

        <Section title="Last update">
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Box sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
              {relativeTime(entity.timestamp, now)}
            </Box>
            <Box
              component="time"
              dateTime={entity.timestamp}
              sx={{ ...monoValue, fontSize: '0.6875rem', color: hud.textSecondary }}
            >
              {Number.isNaN(updated.getTime())
                ? entity.timestamp
                : updated.toISOString().replace('T', ' ').slice(0, 19) + 'Z'}
            </Box>
          </Box>
        </Section>

        {metaRows.length > 0 && (
          <Section title="Metadata">
            <KeyValueTable rows={metaRows} />
          </Section>
        )}

        <Section
          title="Observation history"
          aside={
            <Box component="span" sx={{ ...monoValue, color: hud.textMuted }}>
              {observations.length > 0 ? `${Math.min(observations.length, 10)} latest` : ''}
            </Box>
          }
        >
          {observations.length > 0 ? (
            <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
              {observations.slice(0, 10).map((o) => (
                <Box
                  component="li"
                  key={o.id}
                  sx={{
                    ...monoValue,
                    display: 'flex',
                    gap: 1.5,
                    fontSize: '0.6875rem',
                    py: 0.4,
                    color: hud.textSecondary
                  }}
                >
                  <Box component="span" sx={{ color: hud.textMuted }}>
                    {new Date(o.timestamp).toLocaleTimeString([], { hour12: false })}
                  </Box>
                  <span>
                    {o.latitude.toFixed(3)}, {o.longitude.toFixed(3)}
                  </span>
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ fontSize: '0.75rem', color: hud.textMuted }}>
              {isFetching ? 'Loading observations…' : 'No observations yet.'}
            </Box>
          )}
        </Section>
      </Box>
    </HudPanel>
  );
};
