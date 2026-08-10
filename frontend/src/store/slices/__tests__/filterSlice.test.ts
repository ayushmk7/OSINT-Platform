import { describe, it, expect } from 'vitest';
import filterReducer, {
  setFilterMode,
  toggleFpsDisplay,
  toggleLod,
  updateFps,
  setGlobeStyle,
  type FilterState
} from '../filterSlice';
import { GLOBE_STYLES } from '../../../components/globeStyles';

describe('filterSlice Reducer', () => {
  const initialState: FilterState = {
    filterMode: 'none',
    fpsVisible: true,
    lodEnabled: false,
    currentFps: 60,
    globeStyle: 'tactical'
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

  it('handles setGlobeStyle for every globe style', () => {
    let state = initialState;
    for (const style of GLOBE_STYLES) {
      state = filterReducer(state, setGlobeStyle(style));
      expect(state.globeStyle).toBe(style);
    }
  });

  it('leaves the cinematic filter mode alone when the globe style changes', () => {
    // The two systems are orthogonal: a DOM overlay filter must survive a globe restyle.
    const filtered = filterReducer(initialState, setFilterMode('night_vision'));
    const restyled = filterReducer(filtered, setGlobeStyle('holographic'));
    expect(restyled.filterMode).toBe('night_vision');
    expect(restyled.globeStyle).toBe('holographic');
  });
});
