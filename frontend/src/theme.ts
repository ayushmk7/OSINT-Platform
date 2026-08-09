import { createTheme } from '@mui/material/styles';

/**
 * Height of the single HUD header bar, in px. Shared by `App` and both drawers: the drawers
 * start BELOW the header (`top: HUD_HEADER_HEIGHT`) so a side panel can never cover the
 * connection status / stream rate / entity count, at any viewport size.
 */
export const HUD_HEADER_HEIGHT = 48;

// Green-on-black tactical "command center" identity. Reused by every later step.
export const tacticalTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#000000',
      paper: '#0a0a0a'
    },
    primary: {
      main: '#00ff9d' // neon green accent
    },
    secondary: {
      main: '#ff006e' // magenta
    },
    error: { main: '#ff0055' },
    success: { main: '#00ff9d' },
    text: {
      primary: '#ffffff',
      secondary: '#888888'
    }
  },
  typography: {
    fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
    h6: {
      fontWeight: 600,
      letterSpacing: '0.05em'
    }
  }
});
