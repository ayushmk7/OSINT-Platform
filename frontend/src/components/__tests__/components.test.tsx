import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../store';
import { tacticalTheme } from '../../theme';
import { TelemetryStatsBanner } from '../TelemetryStatsBanner';
import { LayerControlDrawer } from '../LayerControlDrawer';
import { EntityDetailsDrawer } from '../EntityDetailsDrawer';
import { setSelectedEntityId, upsertEntity } from '../../store/slices/entitiesSlice';
import { setSources } from '../../store/slices/sourcesSlice';
import { osintApi } from '../../store/api/osintApi';

const renderWithProviders = (ui: ReactElement) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme={tacticalTheme}>{ui}</ThemeProvider>
    </Provider>
  );

describe('Tactical HUD Components', () => {
  it('TelemetryStatsBanner renders connection status and rates', () => {
    renderWithProviders(
      <TelemetryStatsBanner isConnected={true} isReconnecting={false} messageRate={42} />
    );
    expect(screen.getByText('CONNECTED')).toBeInTheDocument();
    expect(screen.getByText('42 msgs/s')).toBeInTheDocument();
  });

  it('TelemetryStatsBanner shows RECONNECTING and OFFLINE states', () => {
    const { unmount } = renderWithProviders(
      <TelemetryStatsBanner isConnected={false} isReconnecting={true} messageRate={0} />
    );
    expect(screen.getByText('RECONNECTING')).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <TelemetryStatsBanner isConnected={false} isReconnecting={false} messageRate={0} />
    );
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('LayerControlDrawer renders category filters and dispatches source toggles', async () => {
    const user = userEvent.setup();
    store.dispatch(
      setSources([
        {
          id: 'usgs_earthquakes',
          name: 'USGS Earthquakes',
          type: 'usgs',
          transport: 'http_poll',
          url: 'http://example.test',
          update_interval_sec: 60,
          enabled: 1
        }
      ])
    );

    renderWithProviders(<LayerControlDrawer open={true} onClose={() => {}} />);
    expect(screen.getByText('LAYER CONTROLS')).toBeInTheDocument();
    expect(screen.getByText('ALL CATEGORIES')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /geological/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /geological/i }));
    expect(store.getState().entities.activeCategoryFilter).toBe('geological');

    await user.click(screen.getByRole('checkbox', { name: 'USGS Earthquakes' }));
    expect(store.getState().sources.enabledSourceIds).not.toContain('usgs_earthquakes');
  });
});

describe('EntityDetailsDrawer', () => {
  // Seed the RTK Query cache for the `getObservations` endpoint rather than stubbing `fetch`:
  // under jsdom, RTK Query's `new Request(url, { signal })` hands jsdom's AbortSignal to Node's
  // undici Request, which rejects it ("Expected signal to be an instance of AbortSignal") — a
  // test-environment artifact, not a product bug. Seeding the cache still proves the drawer
  // reads observation history through the `getObservations` endpoint; the live HTTP round-trip
  // is verified in the browser.
  beforeEach(async () => {
    await store.dispatch(
      osintApi.util.upsertQueryData(
        'getObservations',
        { entity_id: 'test_sat', limit: 25 },
        {
          total: 1,
          limit: 25,
          offset: 0,
          observations: [
            {
              id: 'obs1',
              entity_id: 'test_sat',
              source_id: 'iss_position',
              latitude: 12.345,
              longitude: 56.789,
              altitude: 400000,
              speed: 7660,
              heading: 91.5,
              timestamp: '2026-07-26T00:00:00Z'
            }
          ]
        }
      )
    );
  });

  // NOTE: deliberately no `resetApiState()` in afterEach — Vitest runs test-file afterEach hooks
  // before Testing Library's cleanup, so clearing the cache under a still-mounted drawer makes
  // its live subscription fire a real refetch.

  it('renders selected entity attributes and REST observation history', async () => {
    store.dispatch(
      upsertEntity({
        id: 'test_sat',
        source_id: 'iss_position',
        category: 'satellite',
        name: 'Test Satellite',
        latitude: 12.34,
        longitude: 56.78,
        altitude: 400000,
        timestamp: new Date().toISOString(),
        metadata: '{"visibility":"daylight"}'
      })
    );
    store.dispatch(setSelectedEntityId('test_sat'));

    renderWithProviders(<EntityDetailsDrawer />);
    expect(screen.getByText('Test Satellite')).toBeInTheDocument();
    expect(screen.getByText('12.3400°')).toBeInTheDocument();
    expect(screen.getByText('SATELLITE')).toBeInTheDocument();

    // Speed/heading are not columns on `entities` — they come from the observation history the
    // drawer pulls through the RTK Query `getObservations` endpoint.
    await waitFor(() => expect(screen.getByText('91.5°')).toBeInTheDocument());
    expect(screen.getByText('7,660 kt')).toBeInTheDocument();
    expect(screen.getByText('OBSERVATION HISTORY (REST)')).toBeInTheDocument();
  });

  it('renders nothing when no entity is selected', () => {
    store.dispatch(setSelectedEntityId(null));
    const { container } = renderWithProviders(<EntityDetailsDrawer />);
    expect(container).toBeEmptyDOMElement();
  });
});
