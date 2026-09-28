import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** Legend layer a source feeds (YAML `layer:` block, defaults applied by the backend). */
export interface SourceLayer {
  id: string;
  name: string;
  group: string;
  description: string;
}

export interface SourceColorBy {
  /** Entity path: `metadata.*`, `altitude`, `speed`, `heading`. */
  field: string;
  stops?: Array<[number, string]>;
  map?: Record<string, string>;
  default?: string;
}

export type FieldFormat = 'text' | 'number' | 'datetime' | 'link' | 'bool';

export interface SourceDisplayField {
  path: string;
  label: string;
  format: FieldFormat;
  precision?: number;
  prefix?: string;
  suffix?: string;
}

/** Marker style + entity card (YAML `display:` block, defaults applied by the backend). */
export interface SourceDisplay {
  /** False when the YAML had no `display:` block: the globe uses the legacy category style. */
  declared?: boolean;
  icon: string;
  color: string;
  color_by?: SourceColorBy;
  size?: number;
  rotate?: boolean;
  trail?: { enabled: boolean; max_points: number };
  ttl?: string | null;
  ttl_seconds?: number | null;
  fields?: SourceDisplayField[];
}

/** Mirrors the `sources` table returned by `GET /api/sources` and the WS `initial_state` frame. */
export interface SourceRecord {
  id: string;
  name: string;
  type: string;
  transport: string;
  url: string;
  update_interval_sec: number;
  enabled: boolean;
  /** `geo` (default), `feed` (news items, plotted only when located) or `indicator`. */
  kind?: 'geo' | 'feed' | 'indicator';
  layer?: SourceLayer | null;
  display?: SourceDisplay | null;
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
    /**
     * `source_update`: replace the source list but keep the user's on/off choice for every
     * source that was already known (new sources start at their server `enabled` flag).
     */
    mergeSources(state, action: PayloadAction<SourceRecord[]>) {
      const previous = new Set(Object.keys(state.sources));
      const wasOn = new Set(state.enabledSourceIds);
      state.sources = {};
      state.enabledSourceIds = [];
      action.payload.forEach((src) => {
        state.sources[src.id] = src;
        if (previous.has(src.id) ? wasOn.has(src.id) : src.enabled) {
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

export const { setSources, mergeSources, toggleSourceEnabled } = sourcesSlice.actions;
export default sourcesSlice.reducer;
