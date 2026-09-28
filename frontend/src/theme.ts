import { createTheme, alpha } from '@mui/material/styles';

/**
 * Design tokens for the floating-glass HUD. Every panel reads from here so surfaces, borders,
 * accent and text hierarchy stay coherent across components.
 */
export const hud = {
  accent: '#3ee6a8',
  accentSoft: 'rgba(62, 230, 168, 0.14)',
  warning: '#f5b84a',
  danger: '#ff5c7a',
  textPrimary: '#e6edf3',
  textSecondary: '#8b98a5',
  textMuted: '#5d6a77',
  surface: 'rgba(10, 14, 20, 0.72)',
  surfaceSolid: '#0b1017',
  surfaceRaised: 'rgba(255, 255, 255, 0.04)',
  surfaceHover: 'rgba(255, 255, 255, 0.06)',
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairlineStrong: 'rgba(255, 255, 255, 0.14)',
  radius: 12,
  gutter: 16,
  shadow: '0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3)',
  blur: 'blur(18px) saturate(140%)',
  fontSans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontMono: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace'
} as const;

/** Shared `sx` for a floating glass panel. */
export const glassSurface = {
  bgcolor: hud.surface,
  backdropFilter: hud.blur,
  WebkitBackdropFilter: hud.blur,
  border: `1px solid ${hud.hairline}`,
  borderRadius: `${hud.radius}px`,
  boxShadow: hud.shadow,
  color: hud.textPrimary
} as const;

/** Small uppercase eyebrow label (section headers, stat labels). */
export const eyebrow = {
  fontSize: '0.625rem',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: hud.textSecondary,
  lineHeight: 1.2
} as const;

/** Monospace, tabular numerals: counters, coordinates, ids. */
export const monoValue = {
  fontFamily: hud.fontMono,
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum" 1, "zero" 1'
} as const;

export const tacticalTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#05070a',
      paper: hud.surfaceSolid
    },
    primary: { main: hud.accent, contrastText: '#04120c' },
    secondary: { main: '#7aa7ff' },
    error: { main: hud.danger },
    warning: { main: hud.warning },
    success: { main: hud.accent },
    divider: hud.hairline,
    text: {
      primary: hud.textPrimary,
      secondary: hud.textSecondary,
      disabled: hud.textMuted
    }
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: hud.fontSans,
    fontSize: 13,
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
    h6: { fontWeight: 600, fontSize: '0.95rem', letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 600 },
    caption: { letterSpacing: 0 }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#05070a',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          fontFeatureSettings: '"cv11" 1, "ss01" 1'
        },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': {
          background: 'rgba(255,255,255,0.12)',
          borderRadius: 8,
          border: '2px solid transparent',
          backgroundClip: 'padding-box'
        },
        '*::-webkit-scrollbar-track': { background: 'transparent' }
      }
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          '&.Mui-focusVisible': {
            outline: `2px solid ${alpha(hud.accent, 0.8)}`,
            outlineOffset: 2
          }
        }
      }
    },
    MuiTooltip: {
      defaultProps: { arrow: true, enterDelay: 250 },
      styleOverrides: {
        tooltip: {
          backgroundColor: '#161d27',
          color: hud.textPrimary,
          border: `1px solid ${hud.hairlineStrong}`,
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '6px 10px',
          borderRadius: 6,
          boxShadow: hud.shadow
        },
        arrow: { color: '#161d27', '&::before': { border: `1px solid ${hud.hairlineStrong}` } }
      }
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: 'rgba(14, 19, 27, 0.92)',
          backdropFilter: hud.blur,
          backgroundImage: 'none',
          border: `1px solid ${hud.hairline}`,
          borderRadius: 10,
          boxShadow: hud.shadow
        },
        list: { padding: 4 }
      }
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: '0.8125rem',
          minHeight: 34,
          '&.Mui-selected': { backgroundColor: hud.accentSoft },
          '&.Mui-selected:hover': { backgroundColor: alpha(hud.accent, 0.2) }
        }
      }
    },
    MuiSwitch: {
      styleOverrides: {
        root: { padding: 6 },
        track: { borderRadius: 10, backgroundColor: '#3a4450', opacity: 1 },
        thumb: { boxShadow: 'none' },
        switchBase: {
          '&.Mui-checked + .MuiSwitch-track': {
            opacity: 1,
            backgroundColor: alpha(hud.accent, 0.6)
          }
        }
      }
    }
  }
});
