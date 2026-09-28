import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** Mirrors the `sources` table returned by `GET /api/sources` and the WS `initial_state` frame. */
export interface SourceRecord {
  id: string;
  name: string;
  type: string;
  transport: string;
  url: string;
  update_interval_sec: number;
  enabled: boolean;
}

export interface SourcesState {
  sources: Record<string, SourceRecord>;
  enabledSourceIds: string[];
}

const initialState: SourcesState = {
  sources: {},
  enabledSourceIds: []
};

const sourcesSlice = createSlice({
  name: 'sources',
  initialState,
  reducers: {
    setSources(state, action: PayloadAction<SourceRecord[]>) {
      state.sources = {};
      state.enabledSourceIds = [];
      action.payload.forEach((src) => {
        state.sources[src.id] = src;
        if (src.enabled) {
          state.enabledSourceIds.push(src.id);
        }
      });
    },
    toggleSourceEnabled(state, action: PayloadAction<string>) {
      const sourceId = action.payload;
      const index = state.enabledSourceIds.indexOf(sourceId);
      if (index >= 0) {
        state.enabledSourceIds.splice(index, 1);
      } else {
        state.enabledSourceIds.push(sourceId);
      }
    }
  }
});

export const { setSources, toggleSourceEnabled } = sourcesSlice.actions;
export default sourcesSlice.reducer;
