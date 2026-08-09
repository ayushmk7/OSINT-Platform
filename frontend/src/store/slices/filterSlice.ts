import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** Cinematic post-processing mode. `none` = untouched high-definition view. */
export type FilterMode = 'none' | 'crt' | 'night_vision' | 'flir';

export interface FilterState {
  filterMode: FilterMode;
  fpsVisible: boolean;
  lodEnabled: boolean;
  currentFps: number;
}

const initialState: FilterState = {
  filterMode: 'none',
  fpsVisible: true,
  lodEnabled: false,
  currentFps: 60
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
    }
  }
});

export const { setFilterMode, toggleFpsDisplay, toggleLod, updateFps } = filterSlice.actions;
export default filterSlice.reducer;
