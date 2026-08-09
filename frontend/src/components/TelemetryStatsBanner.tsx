import type { FC } from 'react';
import { Box, Typography, Chip, Stack } from '@mui/material';
import { useAppSelector } from '../store';

export interface TelemetryStatsBannerProps {
  isConnected: boolean;
  isReconnecting: boolean;
  messageRate: number;
}

/**
 * INLINE row — designed to live INSIDE the single header AppBar. It is deliberately NOT
 * absolutely positioned (an absolute banner over the AppBar is what hid the drawer button).
 * It wraps instead of overflowing so a short/narrow viewport never clips the stats.
 */
export const TelemetryStatsBanner: FC<TelemetryStatsBannerProps> = ({
  isConnected,
  isReconnecting,
  messageRate
}) => {
  const entities = useAppSelector((state) => state.entities.entities);
  const activeEntityCount = Object.keys(entities).length;

  let statusLabel = 'OFFLINE';
  let statusColor: 'error' | 'warning' | 'success' = 'error';
  if (isConnected) {
    statusLabel = 'CONNECTED';
    statusColor = 'success';
  } else if (isReconnecting) {
    statusLabel = 'RECONNECTING';
    statusColor = 'warning';
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexGrow: 1,
        flexWrap: 'wrap',
        minWidth: 0
      }}
    >
      <Typography
        variant="h6"
        noWrap
        sx={{ color: '#00ff9d', fontWeight: 'bold', letterSpacing: '0.1em', fontSize: '0.95rem' }}
      >
        RECONVILLAGE OSINT CORE
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Chip label={statusLabel} color={statusColor} size="small" variant="outlined" />
        <Typography variant="body2" sx={{ color: '#888' }}>
          STREAM: <strong style={{ color: '#00ff9d' }}>{messageRate} msgs/s</strong>
        </Typography>
        <Typography variant="body2" sx={{ color: '#888' }}>
          ENTITIES: <strong style={{ color: '#ff006e' }}>{activeEntityCount}</strong>
        </Typography>
      </Stack>
    </Box>
  );
};
