import type { FC } from 'react';
import { Box, Tooltip } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { useAppSelector } from '../store';
import { hud } from '../theme';
import { HudPanel, StatReadout, PanelDivider } from './HudPrimitives';

export interface TelemetryStatsBannerProps {
  isConnected: boolean;
  isReconnecting: boolean;
  messageRate: number;
}

const pulse = keyframes`
  0%   { box-shadow: 0 0 0 0 rgba(62, 230, 168, 0.55); }
  70%  { box-shadow: 0 0 0 6px rgba(62, 230, 168, 0); }
  100% { box-shadow: 0 0 0 0 rgba(62, 230, 168, 0); }
`;

const numberFormat = new Intl.NumberFormat('en-US');

/** "MK" logo mark: a small accent tile with a reticle behind the monogram. */
const BrandMark: FC = () => (
  <Box
    aria-hidden
    sx={{
      width: 28,
      height: 28,
      borderRadius: '8px',
      flexShrink: 0,
      display: 'grid',
      placeItems: 'center',
      position: 'relative',
      background: `linear-gradient(145deg, ${hud.accent} 0%, #1fae86 100%)`,
      boxShadow: '0 0 0 1px rgba(255,255,255,0.12) inset, 0 4px 14px rgba(62,230,168,0.25)',
      color: '#03140d',
      fontFamily: hud.fontMono,
      fontWeight: 700,
      fontSize: '0.72rem',
      letterSpacing: '-0.02em'
    }}
  >
    MK
  </Box>
);

/**
 * Top-left HUD panel: brand block, live connection pill and headline stream stats.
 * Lower-priority readouts drop away on narrow screens so the panel never wraps or overflows.
 */
export const TelemetryStatsBanner: FC<TelemetryStatsBannerProps> = ({
  isConnected,
  isReconnecting,
  messageRate
}) => {
  const activeEntityCount = useAppSelector((state) => Object.keys(state.entities.entities).length);

  let statusLabel = 'Offline';
  let statusColor: string = hud.danger;
  let statusHint = 'Telemetry stream disconnected';
  if (isConnected) {
    statusLabel = 'Live';
    statusColor = hud.accent;
    statusHint = 'Connected to the live telemetry stream';
  } else if (isReconnecting) {
    statusLabel = 'Reconnecting';
    statusColor = hud.warning;
    statusHint = 'Stream dropped — retrying';
  }

  return (
    <HudPanel
      component="header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 1.25, sm: 2 },
        height: 52,
        pl: 1.25,
        pr: { xs: 1.5, sm: 2 },
        minWidth: 0,
        pointerEvents: 'auto'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.1, flexShrink: 0 }}>
        <BrandMark />
        <Box
          sx={{
            fontWeight: 600,
            fontSize: '0.9rem',
            letterSpacing: '0.14em',
            color: hud.textPrimary,
            lineHeight: 1,
            display: { xs: 'none', sm: 'block' }
          }}
        >
          OSINT
        </Box>
      </Box>

      <PanelDivider />

      <Tooltip title={statusHint}>
        <Box
          role="status"
          aria-label={`Connection status: ${statusLabel}`}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.9,
            height: 26,
            px: 1.1,
            borderRadius: 999,
            flexShrink: 0,
            bgcolor: `${statusColor}1a`,
            border: `1px solid ${statusColor}40`,
            color: statusColor,
            fontSize: '0.75rem',
            fontWeight: 600
          }}
        >
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: statusColor,
              animation: isConnected ? `${pulse} 1.8s ease-out infinite` : 'none'
            }}
          />
          <span>{statusLabel}</span>
        </Box>
      </Tooltip>

      <StatReadout
        label="Entities"
        ariaLabel="Tracked entities"
        value={numberFormat.format(activeEntityCount)}
      />
      <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
        <StatReadout
          label="Stream"
          ariaLabel="Message rate"
          value={numberFormat.format(messageRate)}
          unit="msg/s"
        />
      </Box>
    </HudPanel>
  );
};
