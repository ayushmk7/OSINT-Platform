import type { FC, MouseEvent } from 'react';
import { ToggleButtonGroup, ToggleButton, Tooltip, Box } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import TvIcon from '@mui/icons-material/Tv';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import type { SvgIconComponent } from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../store';
import { setFilterMode, type FilterMode } from '../store/slices/filterSlice';
import { hud } from '../theme';

const MODES: {
  value: FilterMode;
  label: string;
  aria: string;
  hint: string;
  Icon: SvgIconComponent;
}[] = [
  { value: 'none', label: 'Off', aria: 'off', hint: 'No visual filter', Icon: BlockIcon },
  { value: 'crt', label: 'CRT', aria: 'crt', hint: 'CRT scanline monitor', Icon: TvIcon },
  {
    value: 'night_vision',
    label: 'NVG',
    aria: 'night vision',
    hint: 'Night-vision goggles',
    Icon: VisibilityIcon
  },
  {
    value: 'flir',
    label: 'FLIR',
    aria: 'flir thermal',
    hint: 'FLIR thermal imaging',
    Icon: LocalFireDepartmentIcon
  }
];

/** Shared look for the HUD's segmented controls. */
export const segmentedSx = {
  p: '3px',
  gap: '2px',
  borderRadius: '9px',
  bgcolor: 'rgba(255,255,255,0.035)',
  border: 0,
  '& .MuiToggleButtonGroup-grouped': {
    border: 0,
    borderRadius: '6px !important',
    m: 0
  },
  '& .MuiToggleButton-root': {
    color: hud.textSecondary,
    height: 30,
    px: 1.1,
    gap: 0.6,
    fontSize: '0.75rem',
    fontWeight: 500,
    lineHeight: 1,
    transition: 'background-color 120ms, color 120ms',
    '&:hover': { bgcolor: hud.surfaceHover, color: hud.textPrimary }
  },
  '& .MuiToggleButton-root.Mui-selected': {
    color: hud.textPrimary,
    bgcolor: 'rgba(255,255,255,0.1)',
    boxShadow: `inset 0 0 0 1px ${hud.hairlineStrong}`,
    '& svg': { color: hud.accent }
  },
  '& .MuiToggleButton-root.Mui-selected:hover': { bgcolor: 'rgba(255,255,255,0.13)' },
  '& svg': { fontSize: 16 }
} as const;

/** Cinematic post-processing switch: a compact segmented control with explanatory tooltips. */
export const FilterModeSelector: FC = () => {
  const dispatch = useAppDispatch();
  const activeMode = useAppSelector((state) => state.filter.filterMode);

  const handleModeChange = (_event: MouseEvent<HTMLElement>, newMode: FilterMode | null) => {
    // ToggleButtonGroup emits `null` when the active button is re-clicked; keep the current mode.
    if (newMode !== null) dispatch(setFilterMode(newMode));
  };

  return (
    <ToggleButtonGroup
      value={activeMode}
      exclusive
      onChange={handleModeChange}
      size="small"
      aria-label="cinematic filter mode"
      sx={segmentedSx}
    >
      {MODES.map(({ value, label, aria, hint, Icon }) => (
        <Tooltip key={value} title={hint}>
          <ToggleButton value={value} aria-label={aria}>
            <Icon />
            <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
              {label}
            </Box>
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
};
