import type { ReactElement } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import entitiesReducer, { upsertEntity } from '../../store/slices/entitiesSlice';
import sourcesReducer from '../../store/slices/sourcesSlice';
import filterReducer from '../../store/slices/filterSlice';
import insightsReducer, {
  addInsight,
  requestFlyTo,
  setInsights,
  type InsightRecord,
  type InsightStatus
} from '../../store/slices/insightsSlice';
import { tacticalTheme } from '../../theme';
import { InsightsPanel, formatTimeAgo } from '../InsightsPanel';

function makeStore() {
  return configureStore({
    reducer: {
      entities: entitiesReducer,
      sources: sourcesReducer,
      filter: filterReducer,
      insights: insightsReducer
    }
  });
}

const insight = (over: Partial<InsightRecord> = {}): InsightRecord => ({
  id: 'i1',
  analysis: 'quake_swarm_detection',
  title: 'Swarm near Reykjanes',
  summary: 'Twelve M2-3 events within 20 km in six hours.',
  attention: 'medium',
  created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  payload: {},
  refs: [],
  ...over
});

const disabledStatus: InsightStatus = {
  enabled: false,
  reason: 'ANTHROPIC_API_KEY is not set',
  provider: null,
  model: null,
  analyses: []
};

function stubFetch(insights: InsightRecord[], status: InsightStatus) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.startsWith('/api/insights/status') ? status : { limit: 50, insights };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(ui: ReactElement, store = makeStore()) {
  render(
    <Provider store={store}>
      <ThemeProvider theme={tacticalTheme}>{ui}</ThemeProvider>
    </Provider>
  );
  return store;
}

describe('InsightsPanel', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('explains how to enable AI analysis when the engine is off', async () => {
    const fetchMock = stubFetch([], disabledStatus);
    renderPanel(<InsightsPanel open onOpen={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('AI analysis is off')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_API_KEY is not set')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/insights?limit=50');
    expect(fetchMock).toHaveBeenCalledWith('/api/insights/status');
  });

  it('lists fetched insights with attention chip, time-ago and summary, then live ones on top', async () => {
    stubFetch([insight()], {
      ...disabledStatus,
      enabled: true,
      reason: null,
      provider: 'anthropic',
      model: 'claude-sonnet-5'
    });
    const store = renderPanel(<InsightsPanel open onOpen={() => {}} onClose={() => {}} />);

    expect(await screen.findByText('Swarm near Reykjanes')).toBeInTheDocument();
    expect(screen.getByText('Twelve M2-3 events within 20 km in six hours.')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(document.querySelector('[data-attention="medium"]')).toHaveTextContent('medium');
    expect(await screen.findByText('anthropic · claude-sonnet-5')).toBeInTheDocument();

    act(() => {
      store.dispatch(
        addInsight(
          insight({
            id: 'i2',
            title: 'Critical one',
            attention: 'critical',
            created_at: new Date().toISOString()
          })
        )
      );
    });
    const rows = screen.getAllByRole('button', { name: /insight:/ });
    expect(rows[0]).toHaveAccessibleName('critical insight: Critical one');
    expect(rows[1]).toHaveAccessibleName('medium insight: Swarm near Reykjanes');
  });

  it('clicking an insight selects its entity and requests a fly-to', async () => {
    stubFetch([], disabledStatus);
    const store = makeStore();
    store.dispatch(
      upsertEntity({
        id: 'q1',
        source_id: 'usgs',
        category: 'geological',
        name: 'M4.8 - Reykjanes Ridge',
        latitude: 63.8,
        longitude: -22.7,
        altitude: 0,
        timestamp: new Date().toISOString()
      })
    );
    store.dispatch(setInsights([insight({ refs: ['q1', 'not_loaded'] })]));
    renderPanel(<InsightsPanel open onOpen={() => {}} onClose={() => {}} />, store);

    await userEvent.click(screen.getByRole('button', { name: /medium insight/ }));
    expect(store.getState().entities.selectedEntityId).toBe('q1');
    expect(store.getState().insights.flyTo).toEqual({ entityId: 'q1', nonce: 1 });

    // Per-entity locate chip; only loaded entities get one.
    await userEvent.click(screen.getByRole('button', { name: 'Locate M4.8 - Reykjanes Ridge' }));
    expect(store.getState().insights.flyTo).toEqual({ entityId: 'q1', nonce: 2 });
    expect(screen.queryByRole('button', { name: /Locate not_loaded/ })).not.toBeInTheDocument();
  });

  it('collapsed launcher shows the count and opens the panel', async () => {
    stubFetch([insight(), insight({ id: 'i2' })], disabledStatus);
    const onOpen = vi.fn();
    renderPanel(<InsightsPanel open={false} onOpen={onOpen} onClose={() => {}} />);
    const launcher = screen.getByRole('button', { name: 'open AI insights' });
    await waitFor(() => expect(launcher).toHaveTextContent('Insights2'));
    await userEvent.click(launcher);
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('insights helpers', () => {
  it('formats relative time', () => {
    const now = Date.parse('2026-01-02T00:00:00Z');
    expect(formatTimeAgo('2026-01-01T23:59:50Z', now)).toBe('just now');
    expect(formatTimeAgo('2026-01-01T23:50:00Z', now)).toBe('10m ago');
    expect(formatTimeAgo('2026-01-01T21:00:00Z', now)).toBe('3h ago');
    expect(formatTimeAgo('2025-12-29T00:00:00Z', now)).toBe('4d ago');
    expect(formatTimeAgo('garbage', now)).toBe('');
  });

  it('slice merges, dedupes, orders newest first and bumps fly-to nonce', () => {
    const store = makeStore();
    store.dispatch(setInsights([insight({ id: 'a', created_at: '2026-01-01T00:00:00Z' })]));
    store.dispatch(addInsight(insight({ id: 'b', created_at: '2026-01-02T00:00:00Z' })));
    store.dispatch(
      setInsights([insight({ id: 'a', title: 'updated', created_at: '2026-01-01T00:00:00Z' })])
    );
    const items = store.getState().insights.items;
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(items[1].title).toBe('updated');
    store.dispatch(requestFlyTo('x'));
    store.dispatch(requestFlyTo('x'));
    expect(store.getState().insights.flyTo).toEqual({ entityId: 'x', nonce: 2 });
  });
});
