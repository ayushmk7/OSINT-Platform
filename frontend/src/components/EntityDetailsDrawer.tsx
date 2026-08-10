import type { FC } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Chip,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Button
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import { useAppDispatch, useAppSelector } from '../store';
import { setSelectedEntityId, parseEntityMetadata } from '../store/slices/entitiesSlice';
import { useGetObservationsQuery } from '../store/api/osintApi';
import { colorForCategory, ATC_ZONE_CATEGORY } from './globeMarkers';
import { HUD_HEADER_HEIGHT } from '../theme';

const OBSERVATION_LIMIT = 25;

/** Render a metadata value as text, or an em-dash when the field is absent. */
function fieldText(value: unknown): string {
  return value === undefined || value === null || value === '' ? '—' : String(value);
}

/** `metadata` arrives as a JSON string from SQLite; render it, but never crash on bad JSON. */
function formatMetadata(metadata: string | Record<string, unknown> | undefined): string {
  if (metadata === undefined) return '';
  if (typeof metadata !== 'string') return JSON.stringify(metadata, null, 2);
  try {
    return JSON.stringify(JSON.parse(metadata), null, 2);
  } catch {
    return metadata; // not JSON — show the raw string rather than hiding it
  }
}

export const EntityDetailsDrawer: FC = () => {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((state) => state.entities.selectedEntityId);
  const entity = useAppSelector((state) =>
    selectedId ? (state.entities.entities[selectedId] ?? null) : null
  );

  // Load observation history over REST — this is what exercises the step-3 API.
  const { data: obsData, isFetching } = useGetObservationsQuery(
    { entity_id: selectedId ?? '', limit: OBSERVATION_LIMIT },
    { skip: !selectedId }
  );

  const handleClose = () => dispatch(setSelectedEntityId(null));

  if (!entity) return null;

  const observations = obsData?.observations ?? [];
  // Speed/heading live on observations, not on the entity row — take the newest sample.
  const latest = observations[0];

  const isAtcZone = entity.category === ATC_ZONE_CATEGORY;
  const meta = parseEntityMetadata(entity.metadata);
  // Link-out ONLY — LiveATC's terms forbid third-party embedding of the streams themselves, so
  // this opens their own public search page in a new tab. Never an <audio> element.
  const liveatcUrl = typeof meta.liveatc_url === 'string' ? meta.liveatc_url : null;
  const atcColor = colorForCategory(ATC_ZONE_CATEGORY);

  return (
    <Drawer
      anchor="right"
      open={Boolean(entity)}
      onClose={handleClose}
      // Non-modal floating panel: no backdrop, and pointer events pass through the root so the
      // globe behind stays visible AND clickable (a modal inspector would dim the map and swallow
      // clicks on the HUD — including the layer button).
      hideBackdrop
      ModalProps={{ disableScrollLock: true, disableEnforceFocus: true }}
      sx={{ pointerEvents: 'none' }}
      PaperProps={{
        // Column layout + an internally scrolling body: at ≈650px viewport height the metadata
        // and observation list scroll inside the panel instead of running off-screen.
        sx: {
          pointerEvents: 'auto',
          width: 380,
          maxWidth: '92vw',
          top: HUD_HEADER_HEIGHT,
          height: `calc(100% - ${HUD_HEADER_HEIGHT}px)`,
          maxHeight: `calc(100vh - ${HUD_HEADER_HEIGHT}px)`,
          bgcolor: '#0a0a0a',
          color: '#fff',
          borderLeft: '1px solid #1f2937',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 2,
          py: 1.5,
          flexShrink: 0
        }}
      >
        <Typography variant="h6" sx={{ color: 'primary.main', letterSpacing: '0.1em' }}>
          ENTITY INSPECTOR
        </Typography>
        <IconButton onClick={handleClose} aria-label="close inspector" sx={{ color: '#9ca3af' }}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />

      <Box sx={{ p: 2, flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1, wordBreak: 'break-word' }}>
          {entity.name}
        </Typography>
        <Chip
          label={entity.category.toUpperCase()}
          size="small"
          sx={{
            mb: 2,
            bgcolor: 'transparent',
            color: colorForCategory(entity.category),
            border: `1px solid ${colorForCategory(entity.category)}`
          }}
        />

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 2 }} />

        {/*
          Deliberately ABOVE the generic attribute table: the LiveATC link-out is the point of
          this layer, and at a ~650px viewport anything below the 8 standard rows falls past the
          fold of the drawer's internal scroll.
        */}
        {isAtcZone && (
          <Box
            sx={{
              mb: 3,
              p: 1.5,
              bgcolor: '#000',
              borderRadius: 1,
              border: `1px solid ${atcColor}55`
            }}
          >
            <Typography variant="caption" sx={{ color: atcColor, display: 'block', mb: 1 }}>
              ATC CONTROL ZONE
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ color: '#9ca3af', border: 0 }}>ICAO</TableCell>
                  <TableCell sx={{ color: '#fff', border: 0 }}>{fieldText(meta.icao)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ color: '#9ca3af', border: 0 }}>IATA</TableCell>
                  <TableCell sx={{ color: '#fff', border: 0 }}>
                    {fieldText(meta.iata_code)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ color: '#9ca3af', border: 0 }}>MUNICIPALITY</TableCell>
                  <TableCell sx={{ color: '#fff', border: 0 }}>
                    {fieldText(meta.municipality)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ color: '#9ca3af', border: 0 }}>AIRPORT TYPE</TableCell>
                  <TableCell sx={{ color: '#fff', border: 0 }}>
                    {fieldText(meta.airport_type)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ color: '#9ca3af', border: 0 }}>ZONE RADIUS</TableCell>
                  <TableCell sx={{ color: atcColor, border: 0 }}>
                    {meta.radius_km === undefined ? '—' : `${String(meta.radius_km)} km`}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {typeof meta.zone_note === 'string' && (
              <Typography
                variant="caption"
                sx={{ display: 'block', color: '#9ca3af', mt: 1, fontStyle: 'italic' }}
              >
                {meta.zone_note}
              </Typography>
            )}

            {liveatcUrl && (
              <Button
                component="a"
                href={liveatcUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="outlined"
                fullWidth
                startIcon={<HeadphonesIcon />}
                sx={{
                  mt: 1.5,
                  color: atcColor,
                  borderColor: atcColor,
                  '&:hover': { borderColor: atcColor, bgcolor: `${atcColor}22` }
                }}
              >
                Listen to ATC (LiveATC.net)
              </Button>
            )}
            <Typography variant="caption" sx={{ display: 'block', color: '#666', mt: 1 }}>
              Opens LiveATC.net in a new tab — audio is never embedded or proxied here.
            </Typography>
          </Box>
        )}

        <Table size="small">
          <TableBody>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', border: 0 }}>ID</TableCell>
              <TableCell sx={{ color: '#fff', border: 0, wordBreak: 'break-all' }}>
                {entity.id}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', border: 0 }}>SOURCE</TableCell>
              <TableCell sx={{ color: '#fff', border: 0 }}>{entity.source_id}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', border: 0 }}>LATITUDE</TableCell>
              <TableCell sx={{ color: '#00ff9d', border: 0 }}>
                {entity.latitude.toFixed(4)}°
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', border: 0 }}>LONGITUDE</TableCell>
              <TableCell sx={{ color: '#00ff9d', border: 0 }}>
                {entity.longitude.toFixed(4)}°
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', border: 0 }}>ALTITUDE</TableCell>
              <TableCell sx={{ color: '#ffaa00', border: 0 }}>
                {entity.altitude.toLocaleString()} m
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', border: 0 }}>SPEED</TableCell>
              <TableCell sx={{ color: '#ffaa00', border: 0 }}>
                {latest ? `${latest.speed.toLocaleString()} kt` : '—'}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', border: 0 }}>HEADING</TableCell>
              <TableCell sx={{ color: '#ffaa00', border: 0 }}>
                {latest ? `${latest.heading.toFixed(1)}°` : '—'}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', border: 0 }}>LAST UPDATE</TableCell>
              <TableCell sx={{ color: '#fff', border: 0 }}>
                {new Date(entity.timestamp).toLocaleTimeString()}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {entity.metadata && (
          <Box
            sx={{
              mt: 3,
              p: 1.5,
              bgcolor: '#000',
              borderRadius: 1,
              border: '1px solid rgba(0,255,157,0.2)'
            }}
          >
            <Typography variant="caption" sx={{ color: 'primary.main', display: 'block', mb: 1 }}>
              RAW METADATA
            </Typography>
            <pre
              style={{
                margin: 0,
                fontSize: '0.7rem',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#9ca3af'
              }}
            >
              {formatMetadata(entity.metadata)}
            </pre>
          </Box>
        )}

        <Box sx={{ mt: 3 }}>
          <Typography variant="caption" sx={{ color: 'primary.main', display: 'block', mb: 1 }}>
            OBSERVATION HISTORY (REST)
          </Typography>
          {observations.slice(0, 10).map((o) => (
            <Typography key={o.id} variant="caption" sx={{ display: 'block', color: '#9ca3af' }}>
              {new Date(o.timestamp).toLocaleTimeString()} — {o.latitude.toFixed(3)},{' '}
              {o.longitude.toFixed(3)}
            </Typography>
          ))}
          {observations.length === 0 && (
            <Typography variant="caption" sx={{ color: '#666' }}>
              {isFetching ? 'Loading observations…' : 'No observations yet.'}
            </Typography>
          )}
        </Box>
      </Box>
    </Drawer>
  );
};
