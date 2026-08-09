import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store';
import { tacticalTheme } from '../../theme';
import { toggleLod, updateFps } from '../../store/slices/filterSlice';
import { PerformanceControls } from '../PerformanceControls';

const renderControls = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme={tacticalTheme}>
        <PerformanceControls />
      </ThemeProvider>
    </Provider>
  );

describe('PerformanceControls Component', () => {
  beforeEach(() => {
    store.dispatch(updateFps(60));
    if (store.getState().filter.lodEnabled) store.dispatch(toggleLod());
  });

  it('renders the FPS counter badge and the LOD switch', () => {
    renderControls();
    expect(screen.getByText(/FPS/i)).toBeInTheDocument();
    expect(screen.getByText(/LOD Performance/i)).toBeInTheDocument();
  });

  it('toggles LOD mode when the switch is clicked', () => {
    renderControls();
    const lodSwitch = screen.getByRole('checkbox', { name: /LOD Performance/i });
    expect(store.getState().filter.lodEnabled).toBe(false);

    fireEvent.click(lodSwitch);
    expect(store.getState().filter.lodEnabled).toBe(true);
  });

  it('measures frame rate on a requestAnimationFrame loop', async () => {
    store.dispatch(updateFps(0));
    renderControls();
    // jsdom drives rAF off timers; the loop updates the store once the 1s window elapses.
    await waitFor(() => expect(store.getState().filter.currentFps).toBeGreaterThan(0), {
      timeout: 4000
    });
    expect(screen.getByText(`${store.getState().filter.currentFps} FPS`)).toBeInTheDocument();
  });
});
