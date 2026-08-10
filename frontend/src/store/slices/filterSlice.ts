import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { DEFAULT_GLOBE_STYLE, type GlobeStyle } from '../../components/globeStyles';

/** Cinematic post-processing mode. `none` = untouched high-definition view. */
export type FilterMode = 'none' | 'crt' | 'night_vision' | 'flir';

export interface FilterState {
  filterMode: FilterMode;
  fpsVisible: boolean;
  lodEnabled: boolean;
  currentFps: number;
  /**
   * Base look of the globe itself. Orthogonal to `filterMode`: the CRT/NVG/FLIR overlays are DOM
   * layers composited ON TOP of the canvas, this one changes what the canvas draws.
   */
  globeStyle: GlobeStyle;
}

const initialState: FilterState = {
  filterMode: 'none',
  fpsVisible: true,
  lodEnabled: false,
  currentFps: 60,
  globeStyle: DEFAULT_GLOBE_STYLE
};

export const filterSlice = createSlice({
  name: 'filter',
  initialState,
  reducers: {
    setFilterMode: (state, action: PayloadAction<FilterMode>) => {
      state.filterMode = action.payload;
    },
    toggleFpsDisplay: (state) => {
      state.fpsVisible = !state.fpsVisible;
    },
    toggleLod: (state) => {
      state.lodEnabled = !state.lodEnabled;
    },
    updateFps: (state, action: PayloadAction<number>) => {
      state.currentFps = action.payload;
    },
    setGlobeStyle: (state, action: PayloadAction<GlobeStyle>) => {
      state.globeStyle = action.payload;
    }
  }
});

export const { setFilterMode, toggleFpsDisplay, toggleLod, updateFps, setGlobeStyle } =
  filterSlice.actions;
export default filterSlice.reducer;
