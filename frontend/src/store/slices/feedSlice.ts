import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Mirrors the backend `FeedItem` (REST `GET /api/feed`, WS `feed_item`, `initial_state.feed`). */
export interface FeedItemRecord {
  id: string;
  source_id: string;
  item_id: string;
  title: string;
  url: string | null;
  summary: string | null;
  published: string;
  tags: string[];
  severity: Severity;
  latitude: number | null;
  longitude: number | null;
  entity_id: string | null;
  first_seen: string;
}

export interface IndicatorPoint {
  t: string;
  v: number;
}

/** Mirrors the backend `Indicator` (REST `GET /api/indicators`, WS `indicator_update`). */
export interface IndicatorRecord {
  id: string;
  source_id: string;
  indicator_id: string;
  label: string;
  value: number;
  unit: string | null;
  change: number | null;
  severity: Severity;
  updated_at: string;
  history: IndicatorPoint[];
}

export interface FeedState {
  /** Newest first. */
  items: FeedItemRecord[];
  indicators: Record<string, IndicatorRecord>;
}

/** Feed items kept client-side; older ones stay available through `GET /api/feed`. */
export const MAX_FEED_ITEMS = 400;

const initialState: FeedState = { items: [], indicators: {} };

function newestFirst(a: FeedItemRecord, b: FeedItemRecord): number {
  return a.published < b.published ? 1 : a.published > b.published ? -1 : a.id.localeCompare(b.id);
}

function merge(existing: FeedItemRecord[], incoming: FeedItemRecord[]): FeedItemRecord[] {
  const byId = new Map(existing.map((i) => [i.id, i]));
  for (const i of incoming) byId.set(i.id, i);
  return [...byId.values()].sort(newestFirst).slice(0, MAX_FEED_ITEMS);
}

const feedSlice = createSlice({
  name: 'feed',
  initialState,
  reducers: {
    /** Merge a snapshot (initial_state / REST page); live frames may already have arrived. */
    mergeFeedItems(state, action: PayloadAction<FeedItemRecord[]>) {
      state.items = merge(state.items, action.payload);
    },
    addFeedItem(state, action: PayloadAction<FeedItemRecord>) {
      state.items = merge(state.items, [action.payload]);
    },
    setIndicators(state, action: PayloadAction<IndicatorRecord[]>) {
      state.indicators = {};
      for (const i of action.payload) state.indicators[i.id] = i;
    },
    upsertIndicator(state, action: PayloadAction<IndicatorRecord>) {
      state.indicators[action.payload.id] = action.payload;
    }
  }
});

export const { mergeFeedItems, addFeedItem, setIndicators, upsertIndicator } = feedSlice.actions;
export default feedSlice.reducer;
