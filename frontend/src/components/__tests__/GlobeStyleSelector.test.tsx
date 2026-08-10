import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store';
import { tacticalTheme } from '../../theme';
import { setGlobeStyle, setFilterMode } from '../../store/slices/filterSlice';
import { GlobeStyleSelector } from '../GlobeStyleSelector';
import { GLOBE_STYLES, GLOBE_STYLE_LABELS } from '../globeStyles';

const renderSelector = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme={tacticalTheme}>
        <GlobeStyleSelector />
      </ThemeProvider>
    </Provider>
  );

describe('GlobeStyleSelector Component', () => {
  beforeEach(() => {
    store.dispatch(setGlobeStyle('tactical'));
    store.dispatch(setFilterMode('none'));
  });

  it('renders one toggle per globe style', () => {
    renderSelector();
    for (const style of GLOBE_STYLES) {
      expect(screen.getByRole('button', { name: GLOBE_STYLE_LABELS[style] })).toBeInTheDocument();
    }
  });

  it('dispatches the selected style on click', () => {
    renderSelector();

    fireEvent.click(screen.getByRole('button', { name: 'Blue Marble' }));
    expect(store.getState().filter.globeStyle).toBe('blue_marble');

    fireEvent.click(screen.getByRole('button', { name: 'Holographic' }));
    expect(store.getState().filter.globeStyle).toBe('holographic');

    fireEvent.click(screen.getByRole('button', { name: 'Tactical Dark' }));
    expect(store.getState().filter.globeStyle).toBe('tactical');
  });

  it('marks the active style pressed and keeps a style selected on re-click', () => {
    renderSelector();

    fireEvent.click(screen.getByRole('button', { name: 'Neon Vector' }));
    expect(screen.getByRole('button', { name: 'Neon Vector' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Re-clicking the active button emits `null`; the globe must NOT be left style-less.
    fireEvent.click(screen.getByRole('button', { name: 'Neon Vector' }));
    expect(store.getState().filter.globeStyle).toBe('neon_vector');
  });

  it('does not disturb the cinematic filter mode', () => {
    store.dispatch(setFilterMode('flir'));
    renderSelector();

    fireEvent.click(screen.getByRole('button', { name: 'Terrain Relief' }));
    expect(store.getState().filter.globeStyle).toBe('terrain_relief');
    expect(store.getState().filter.filterMode).toBe('flir');
  });
});
