import { describe, it, expect } from 'vitest';
import filterReducer, {
  setFilterMode,
  toggleFpsDisplay,
  toggleLod,
  updateFps,
  type FilterState
} from '../filterSlice';

describe('filterSlice Reducer', () => {
  const initialState: FilterState = {
    filterMode: 'none',
    fpsVisible: true,
    lodEnabled: false,
    currentFps: 60
  };

  it('returns the default initial state', () => {
    expect(filterReducer(undefined, { type: 'unknown' })).toEqual(initialState);
  });

  it('handles setFilterMode for every cinematic mode', () => {
    let state = filterReducer(initialState, setFilterMode('crt'));
    expect(state.filterMode).toBe('crt');

    state = filterReducer(state, setFilterMode('night_vision'));
    expect(state.filterMode).toBe('night_vision');

    state = filterReducer(state, setFilterMode('flir'));
    expect(state.filterMode).toBe('flir');

    state = filterReducer(state, setFilterMode('none'));
    expect(state.filterMode).toBe('none');
  });

  it('handles toggleFpsDisplay', () => {
    const state = filterReducer(initialState, toggleFpsDisplay());
    expect(state.fpsVisible).toBe(false);
    expect(filterReducer(state, toggleFpsDisplay()).fpsVisible).toBe(true);
  });

  it('handles toggleLod', () => {
    const state = filterReducer(initialState, toggleLod());
    expect(state.lodEnabled).toBe(true);
    expect(filterReducer(state, toggleLod()).lodEnabled).toBe(false);
  });

  it('handles updateFps', () => {
    expect(filterReducer(initialState, updateFps(58)).currentFps).toBe(58);
  });
});
