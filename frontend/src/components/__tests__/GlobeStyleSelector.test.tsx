import { render, screen, fireEvent, within } from '@testing-library/react';
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

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'globe style' }));
  return screen.getByRole('menu');
};

const pick = (label: string) =>
  fireEvent.click(within(openMenu()).getByRole('menuitemradio', { name: label }));

describe('GlobeStyleSelector Component', () => {
  beforeEach(() => {
    store.dispatch(setGlobeStyle('tactical'));
    store.dispatch(setFilterMode('none'));
  });

  it('shows the active style by name on the trigger', () => {
    renderSelector();
    expect(screen.getByRole('button', { name: 'globe style' })).toHaveTextContent('Tactical Dark');
  });

  it('lists one named option per globe style', () => {
    renderSelector();
    const menu = openMenu();
    for (const style of GLOBE_STYLES) {
      expect(
        within(menu).getByRole('menuitemradio', { name: GLOBE_STYLE_LABELS[style] })
      ).toBeInTheDocument();
    }
  });

  it('dispatches the selected style on click', () => {
    renderSelector();

    pick('Blue Marble');
    expect(store.getState().filter.globeStyle).toBe('blue_marble');

    pick('Holographic');
    expect(store.getState().filter.globeStyle).toBe('holographic');

    pick('Tactical Dark');
    expect(store.getState().filter.globeStyle).toBe('tactical');
  });

  it('marks the active style checked and keeps a style selected on re-click', () => {
    renderSelector();

    pick('Neon Vector');
    const menu = openMenu();
    expect(within(menu).getByRole('menuitemradio', { name: 'Neon Vector' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(within(menu).getByRole('menuitemradio', { name: 'Blue Marble' })).toHaveAttribute(
      'aria-checked',
      'false'
    );

    // Re-selecting the active style must NOT leave the globe style-less.
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Neon Vector' }));
    expect(store.getState().filter.globeStyle).toBe('neon_vector');
  });

  it('does not disturb the cinematic filter mode', () => {
    store.dispatch(setFilterMode('flir'));
    renderSelector();

    pick('Terrain Relief');
    expect(store.getState().filter.globeStyle).toBe('terrain_relief');
    expect(store.getState().filter.filterMode).toBe('flir');
  });
});
