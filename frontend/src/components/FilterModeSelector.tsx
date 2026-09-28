import type { FC, MouseEvent } from 'react';
import { ToggleButtonGroup, ToggleButton, Typography, Box } from '@mui/material';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import TvIcon from '@mui/icons-material/Tv';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import { useAppDispatch, useAppSelector } from '../store';
import { setFilterMode, type FilterMode } from '../store/slices/filterSlice';

/**
 * Cinematic filter switch. Lives INLINE inside the single header `AppBar` (never as a floating
 * absolute banner — an absolutely positioned bar over the AppBar is what hid these controls in
 * an earlier run).
 */
export const FilterModeSelector: FC = () => {
  const dispatch = useAppDispatch();
  const activeMode = useAppSelector((state) => state.filter.filterMode);

  const handleModeChange = (_event: MouseEvent<HTMLElement>, newMode: FilterMode | null) => {
    // ToggleButtonGroup emits `null` when the active button is re-clicked; keep the current mode.
    if (newMode !== null) dispatch(setFilterMode(newMode));
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
      <Typography
        variant="caption"
        noWrap
        sx={{ color: 'text.secondary', fontWeight: 'bold', display: { xs: 'none', xl: 'block' } }}
      >
        VISUAL FILTER:
      </Typography>
      <ToggleButtonGroup
        value={activeMode}
        exclusive
        onChange={handleModeChange}
        size="small"
        aria-label="cinematic filter mode"
        sx={{
          '& .MuiToggleButton-root': {
            color: '#9ca3af',
            borderColor: '#1f2937',
            px: 1,
            py: 0.25,
            fontSize: '0.7rem',
            letterSpacing: '0.08em'
          },
          '& .Mui-selected': {
            color: '#00ff9d !important',
            borderColor: 'rgba(0,255,157,0.5) !important',
            bgcolor: 'rgba(0,255,157,0.12) !important'
          }
        }}
      >
        <ToggleButton value="none" aria-label="off">
          <PowerSettingsNewIcon fontSize="small" sx={{ mr: { xs: 0, lg: 0.5 } }} />
          <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>
            OFF
          </Box>
        </ToggleButton>
        <ToggleButton value="crt" aria-label="crt">
          <TvIcon fontSize="small" sx={{ mr: { xs: 0, lg: 0.5 } }} />
          <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>
            CRT
          </Box>
        </ToggleButton>
        <ToggleButton value="night_vision" aria-label="night vision">
          <VisibilityIcon fontSize="small" sx={{ mr: { xs: 0, lg: 0.5 } }} />
          <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>
            NVG
          </Box>
        </ToggleButton>
        <ToggleButton value="flir" aria-label="flir thermal">
          <LocalFireDepartmentIcon fontSize="small" sx={{ mr: { xs: 0, lg: 0.5 } }} />
          <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>
            FLIR
          </Box>
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
};
