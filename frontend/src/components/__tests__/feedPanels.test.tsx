import type { ReactElement } from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import entitiesReducer, { upsertEntity } from '../../store/slices/entitiesSlice';
import sourcesReducer, { setSources } from '../../store/slices/sourcesSlice';
import filterReducer from '../../store/slices/filterSlice';
import insightsReducer from '../../store/slices/insightsSlice';
import feedReducer, { mergeFeedItems, setIndicators } from '../../store/slices/feedSlice';
import { tacticalTheme } from '../../theme';
import { FeedPanel } from '../FeedPanel';
import { IndicatorsPanel } from '../IndicatorsPanel';
import { SearchBox } from '../SearchBox';
import { IntelDock } from '../IntelDock';
import { useWebSocket } from '../../hooks/useWebSocket';
import { feedItem, indicator } from './feedPieces.test';

function makeStore() {
  return configureStore({
    reducer: {
      entities: entitiesReducer,
      sources: sourcesReducer,
      filter: filterReducer,
      insights: insightsReducer,
      feed: feedReducer
    }
  });
}
type TestStore = ReturnType<typeof makeStore>;

function renderWith(ui: ReactElement, store: TestStore) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={tacticalTheme}>{ui}</ThemeProvider>
    </Provider>
  );
}

const src = (id: string, name: string, group = 'Cyber') => ({
  id,
  name,
  type: 'rss',
  transport: 'http_poll',
  url: 'http://x',
  update_interval_sec: 60,
  enabled: true,
  kind: 'feed' as const,
  layer: { id, name, group, description: '' },
  display: { declared: true, icon: 'news', color: '#4fc3f7' }
});

let store: TestStore;

beforeEach(() => {
  store = makeStore();
  // Panels fetch a REST page on mount; answer with nothing new.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [], indicators: [] }) }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FeedPanel', () => {
  beforeEach(() => {
    store.dispatch(setSources([src('cisa', 'CISA Advisories'), src('bbc', 'BBC World', 'News')]));
    store.dispatch(
      mergeFeedItems([
        feedItem({ id: 'cisa:1', source_id: 'cisa', title: 'Citrix advisory' }),
        feedItem({
          id: 'bbc:2',
          source_id: 'bbc',
          title: 'Quake hits coast',
          severity: 'info',
          url: null,
          latitude: 10,
          longitude: 20,
          entity_id: 'bbc:2',
          published: '2026-09-28T11:00:00.000Z'
        })
      ])
    );
  });

  it('lists items newest first with safe new-tab links', () => {
    renderWith(<FeedPanel />, store);
    const rows = within(screen.getByRole('list', { name: 'Feed items' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Quake hits coast');
    const link = screen.getByRole('link', { name: 'Citrix advisory' });
    expect(link).toHaveAttribute('href', 'https://example.org/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(rows[1]).toHaveAttribute('data-severity', 'high');
  });

  it('filters by source chips', async () => {
    renderWith(<FeedPanel />, store);
    await userEvent.click(screen.getByRole('button', { name: /CISA Advisories/ }));
    expect(screen.queryByText('Quake hits coast')).toBeNull();
    expect(screen.getByText('Citrix advisory')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(screen.getByText('Quake hits coast')).toBeInTheDocument();
  });

  it('flies to located items', async () => {
    renderWith(<FeedPanel />, store);
    await userEvent.click(screen.getByRole('button', { name: 'Locate Quake hits coast' }));
    expect(store.getState().insights.flyTo).toMatchObject({
      entityId: 'bbc:2',
      latitude: 10,
      longitude: 20
    });
    expect(screen.queryByRole('button', { name: 'Locate Citrix advisory' })).toBeNull();
  });
});

describe('IndicatorsPanel', () => {
  it('shows grouped tiles with value, unit, change and sparkline', () => {
    store.dispatch(setSources([src('kp', 'NOAA Kp', 'Space'), src('crypto', 'Crypto', 'Other')]));
    store.dispatch(
      setIndicators([
        indicator({ severity: 'high', value: 5.33, source_id: 'kp' }),
        indicator({
          id: 'crypto:btc',
          source_id: 'crypto',
          label: 'BTC / USD',
          value: 83268,
          unit: 'USD',
          change: -1.62
        })
      ])
    );
    renderWith(<IndicatorsPanel />, store);
    expect(screen.getByRole('region', { name: 'Space indicators' })).toBeInTheDocument();
    const kp = screen.getByRole('group', { name: 'Planetary Kp: 5.33' });
    expect(kp).toHaveAttribute('data-severity', 'high');
    expect(kp.querySelector('polyline')).not.toBeNull();
    const btc = screen.getByRole('group', { name: 'BTC / USD: 83,268 USD' });
    expect(within(btc).getByTestId('indicator-change')).toHaveTextContent('−1.62%');
  });

  it('explains how to add indicators when there are none', () => {
    renderWith(<IndicatorsPanel />, store);
    expect(screen.getByText(/No indicators yet/)).toBeInTheDocument();
  });
});

describe('SearchBox', () => {
  it('focuses on Ctrl+K and selects + flies to an entity on Enter', async () => {
    store.dispatch(
      upsertEntity({
        id: 'adsb:ae1',
        source_id: 'adsb',
        category: 'aircraft',
        name: 'RCH123',
        latitude: 5,
        longitude: 6,
        altitude: 0,
        timestamp: '2026-09-28T00:00:00Z'
      })
    );
    renderWith(<SearchBox />, store);
    const input = screen.getByRole('combobox', { name: 'Search entities and feeds' });
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(input).toHaveFocus();
    await userEvent.type(input, 'rch');
    const option = await screen.findByRole('option', { name: /RCH123/ });
    expect(option).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(store.getState().entities.selectedEntityId).toBe('adsb:ae1');
    expect(store.getState().insights.flyTo?.entityId).toBe('adsb:ae1');
  });

  it('opens unlocated feed results in a new tab', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    store.dispatch(mergeFeedItems([feedItem()]));
    renderWith(<SearchBox />, store);
    await userEvent.type(screen.getByRole('combobox'), 'citrix');
    await userEvent.click(await screen.findByRole('option', { name: /Citrix zero-day/ }));
    expect(open).toHaveBeenCalledWith('https://example.org/1', '_blank', 'noopener,noreferrer');
  });
});

describe('IntelDock', () => {
  it('switches tabs, collapses and shows counts', async () => {
    store.dispatch(mergeFeedItems([feedItem()]));
    renderWith(
      <IntelDock tab="feed" onTabChange={() => undefined} open onOpenChange={() => undefined} />,
      store
    );
    const feedTab = screen.getByRole('tab', { name: /Feed/ });
    expect(feedTab).toHaveAttribute('aria-selected', 'true');
    expect(feedTab).toHaveTextContent('1');
    expect(screen.getByText('Citrix zero-day exploited')).toBeVisible();
  });

  it('reports tab clicks and collapse', async () => {
    const onTab = vi.fn();
    const onOpen = vi.fn();
    renderWith(<IntelDock tab="feed" onTabChange={onTab} open onOpenChange={onOpen} />, store);
    await userEvent.click(screen.getByRole('tab', { name: /Signals/ }));
    expect(onTab).toHaveBeenCalledWith('indicators');
    await userEvent.click(screen.getByRole('button', { name: 'collapse intel dock' }));
    expect(onOpen).toHaveBeenLastCalledWith(false);
  });
});

describe('useWebSocket feed frames', () => {
  it('loads feed/indicators from initial_state and applies live frames', async () => {
    const sockets: Array<{ onmessage: ((e: { data: string }) => void) | null }> = [];
    vi.stubGlobal(
      'WebSocket',
      vi.fn(() => {
        const s = {
          send: vi.fn(),
          close: vi.fn(),
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null
        };
        sockets.push(s);
        return s;
      })
    );
    renderHook(() => useWebSocket({ url: 'ws://localhost/test' }), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>
    });
    const send = (frame: object) =>
      act(() => {
        sockets[0].onmessage?.({ data: JSON.stringify(frame) });
      });
    send({
      type: 'initial_state',
      data: { sources: [], entities: [], feed: [feedItem()], indicators: [indicator()] }
    });
    expect(store.getState().feed.items).toHaveLength(1);
    send({
      type: 'feed_item',
      data: feedItem({ id: 'news:9', published: '2026-09-28T12:00:00Z' })
    });
    send({ type: 'indicator_update', data: indicator({ value: 7 }) });
    await waitFor(() => expect(store.getState().feed.items[0].id).toBe('news:9'));
    expect(store.getState().feed.indicators['kp:kp'].value).toBe(7);
  });
});
