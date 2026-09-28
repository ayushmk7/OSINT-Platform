import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export const ATTENTION_LEVELS = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Attention = (typeof ATTENTION_LEVELS)[number];

/** Mirrors the backend `Insight` (REST `GET /api/insights` and WS `ai_insight` frames). */
export interface InsightRecord {
  id: string;
  analysis: string;
  title: string;
  summary: string;
  attention: Attention;
  created_at: string;
  payload: Record<string, unknown>;
  /** Entity ids the insight is about. */
  refs: string[];
}

/** `GET /api/insights/status`. */
export interface InsightStatus {
  enabled: boolean;
  reason: string | null;
  provider: string | null;
  model: string | null;
  analyses: { name: string; description: string; schedule: string; enabled: boolean }[];
}

/**
 * A one-shot camera request. `nonce` changes on every request so asking to fly to the same
 * entity twice (after the user panned away) still triggers the GlobeView effect.
 */
export interface FlyToRequest {
  entityId: string;
  nonce: number;
}

export interface InsightsState {
  items: InsightRecord[];
  status: InsightStatus | null;
  flyTo: FlyToRequest | null;
}

/** Insights kept client-side; older ones remain available through the REST endpoint. */
export const MAX_INSIGHTS = 100;

const initialState: InsightsState = { items: [], status: null, flyTo: null };

function newestFirst(a: InsightRecord, b: InsightRecord): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

const insightsSlice = createSlice({
  name: 'insights',
  initialState,
  reducers: {
    /** Merge a REST page into the list (live frames may already have arrived). */
    setInsights(state, action: PayloadAction<InsightRecord[]>) {
      const byId = new Map(state.items.map((i) => [i.id, i]));
      for (const i of action.payload) byId.set(i.id, i);
      state.items = [...byId.values()].sort(newestFirst).slice(0, MAX_INSIGHTS);
    },
    addInsight(state, action: PayloadAction<InsightRecord>) {
      const rest = state.items.filter((i) => i.id !== action.payload.id);
      state.items = [action.payload, ...rest].sort(newestFirst).slice(0, MAX_INSIGHTS);
    },
    setInsightStatus(state, action: PayloadAction<InsightStatus | null>) {
      state.status = action.payload;
    },
    requestFlyTo(state, action: PayloadAction<string>) {
      state.flyTo = { entityId: action.payload, nonce: (state.flyTo?.nonce ?? 0) + 1 };
    }
  }
});

export const { setInsights, addInsight, setInsightStatus, requestFlyTo } = insightsSlice.actions;
export default insightsSlice.reducer;
