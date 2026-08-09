import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store';
import { tacticalTheme } from '../../theme';
import { setFilterMode } from '../../store/slices/filterSlice';
import { FilterModeSelector } from '../FilterModeSelector';

const renderSelector = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme={tacticalTheme}>
        <FilterModeSelector />
      </ThemeProvider>
    </Provider>
  );

describe('FilterModeSelector Component', () => {
  beforeEach(() => {
    store.dispatch(setFilterMode('none'));
  });

  it('renders all four filter mode toggle options', () => {
    renderSelector();
    expect(screen.getByText('OFF')).toBeInTheDocument();
    expect(screen.getByText('CRT')).toBeInTheDocument();
    expect(screen.getByText('NVG')).toBeInTheDocument();
    expect(screen.getByText('FLIR')).toBeInTheDocument();
  });

  it('dispatches filter mode changes on button click', () => {
    renderSelector();

    fireEvent.click(screen.getByText('CRT'));
    expect(store.getState().filter.filterMode).toBe('crt');

    fireEvent.click(screen.getByText('NVG'));
    expect(store.getState().filter.filterMode).toBe('night_vision');

    fireEvent.click(screen.getByText('FLIR'));
    expect(store.getState().filter.filterMode).toBe('flir');

    fireEvent.click(screen.getByText('OFF'));
    expect(store.getState().filter.filterMode).toBe('none');
  });

  it('marks the active mode as pressed and keeps a mode selected on re-click', () => {
    renderSelector();

    fireEvent.click(screen.getByText('CRT'));
    expect(screen.getByRole('button', { name: 'crt' })).toHaveAttribute('aria-pressed', 'true');

    // Re-clicking the active button emits `null`; the mode must NOT silently clear.
    fireEvent.click(screen.getByText('CRT'));
    expect(store.getState().filter.filterMode).toBe('crt');
  });
});
