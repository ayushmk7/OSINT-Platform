import type { ReactElement } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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
import { colorForCategory } from '../globeMarkers';

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
    expect(screen.getByRole('status', { name: /connection status: live/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Message rate' })).toHaveTextContent('42msg/s');
    // Brand block: MK-OSINT, not the old product name.
    expect(screen.getByText('MK')).toBeInTheDocument();
    expect(screen.getByText('OSINT')).toBeInTheDocument();
    expect(screen.queryByText(/reconvillage/i)).not.toBeInTheDocument();
  });

  it('TelemetryStatsBanner shows Reconnecting and Offline states', () => {
    const { unmount } = renderWithProviders(
      <TelemetryStatsBanner isConnected={false} isReconnecting={true} messageRate={0} />
    );
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <TelemetryStatsBanner isConnected={false} isReconnecting={false} messageRate={0} />
    );
    expect(screen.getByText('Offline')).toBeInTheDocument();
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
          enabled: true
        }
      ])
    );

    renderWithProviders(<LayerControlDrawer open={true} onClose={() => {}} />);
    expect(screen.getByRole('complementary', { name: 'Layer controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /geological/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /geological/i }));
    expect(store.getState().entities.activeCategoryFilter).toBe('geological');
    expect(screen.getByRole('button', { name: /geological/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // "Show all" appears while a layer is isolated and clears the filter.
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(store.getState().entities.activeCategoryFilter).toBeNull();

    // Re-clicking an isolated layer also returns to all layers.
    await user.click(screen.getByRole('button', { name: /geological/i }));
    await user.click(screen.getByRole('button', { name: /geological/i }));
    expect(store.getState().entities.activeCategoryFilter).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'USGS Earthquakes' }));
    expect(store.getState().sources.enabledSourceIds).not.toContain('usgs_earthquakes');
  });

  it('LayerControlDrawer exposes ATC zones as a togglable layer with a swatch and count', async () => {
    const user = userEvent.setup();
    store.dispatch(
      upsertEntity({
        id: 'KJFK',
        source_id: 'atc_facilities',
        category: 'atc_zone',
        name: 'John F Kennedy International Airport',
        latitude: 40.6398,
        longitude: -73.7789,
        altitude: 0,
        timestamp: new Date().toISOString(),
        metadata: { radius_km: 9 }
      })
    );

    renderWithProviders(<LayerControlDrawer open={true} onClose={() => {}} />);
    const atcButton = screen.getByRole('button', { name: /atc zone/i });
    expect(atcButton).toBeInTheDocument();
    // Count of loaded entities in this layer, alongside the color swatch.
    expect(atcButton).toHaveTextContent('1');
    // The swatch must use the real category color, not the neutral fallback.
    expect(colorForCategory('atc_zone')).not.toBe('#9ca3af');

    await user.click(atcButton);
    expect(store.getState().entities.activeCategoryFilter).toBe('atc_zone');
    await user.click(atcButton);
  });

  it('LayerControlDrawer collapses to a launcher that reopens the panel', async () => {
    const user = userEvent.setup();
    let opened = false;
    let closed = false;
    const { rerender } = renderWithProviders(
      <LayerControlDrawer open={true} onClose={() => (closed = true)} />
    );
    await user.click(screen.getByRole('button', { name: 'collapse layer controls' }));
    expect(closed).toBe(true);

    rerender(
      <Provider store={store}>
        <ThemeProvider theme={tacticalTheme}>
          <LayerControlDrawer open={false} onClose={() => {}} onOpen={() => (opened = true)} />
        </ThemeProvider>
      </Provider>
    );
    expect(screen.queryByRole('complementary', { name: 'Layer controls' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'open layer controls' }));
    expect(opened).toBe(true);
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
        metadata: { visibility: 'daylight' }
      })
    );
    store.dispatch(setSelectedEntityId('test_sat'));

    renderWithProviders(<EntityDetailsDrawer />);
    expect(screen.getByText('Test Satellite')).toBeInTheDocument();
    expect(screen.getByText('12.3400°')).toBeInTheDocument();
    expect(screen.getByText('Satellite')).toBeInTheDocument();

    // Speed/heading are not columns on `entities` — they come from the observation history the
    // drawer pulls through the RTK Query `getObservations` endpoint.
    await waitFor(() => expect(screen.getByText('91.5°')).toBeInTheDocument());
    expect(screen.getByText('7,660 kt')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Observation history' })).toBeInTheDocument();
    // Metadata is rendered as a key/value table, not raw JSON.
    expect(screen.getByText('visibility')).toBeInTheDocument();
    expect(screen.getByText('daylight')).toBeInTheDocument();
  });

  it('renders ATC zone metadata and a LiveATC link-out for an atc_zone entity', async () => {
    // Same cache-seeding rationale as above — the drawer's observation query must not attempt a
    // real HTTP round-trip under jsdom.
    await store.dispatch(
      osintApi.util.upsertQueryData(
        'getObservations',
        { entity_id: 'EGLL', limit: 25 },
        { total: 0, limit: 25, offset: 0, observations: [] }
      )
    );
    store.dispatch(
      upsertEntity({
        id: 'EGLL',
        source_id: 'atc_facilities',
        category: 'atc_zone',
        name: 'London Heathrow Airport',
        latitude: 51.4706,
        longitude: -0.461941,
        altitude: 0,
        timestamp: new Date().toISOString(),
        metadata: {
          icao: 'EGLL',
          iata_code: 'LHR',
          municipality: 'London',
          airport_type: 'large_airport',
          radius_km: 9,
          zone_note: 'approximate control-zone radius, illustrative only',
          liveatc_url: 'https://www.liveatc.net/search/?icao=egll'
        }
      })
    );
    store.dispatch(setSelectedEntityId('EGLL'));

    renderWithProviders(<EntityDetailsDrawer />);
    expect(screen.getByRole('heading', { name: 'ATC control zone' })).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('large_airport')).toBeInTheDocument();
    expect(screen.getByText('9 km')).toBeInTheDocument();
    expect(
      screen.getByText('approximate control-zone radius, illustrative only')
    ).toBeInTheDocument();

    // The point of the feature: a real link-out, opened in a new tab. NOT an embedded player —
    // LiveATC's terms forbid third-party embedding of the streams themselves.
    const link = screen.getByRole('link', { name: /listen to atc/i });
    expect(link).toHaveAttribute('href', 'https://www.liveatc.net/search/?icao=egll');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(document.querySelector('audio')).toBeNull();
  });

  it('shows no ATC panel for a non-ATC entity', () => {
    store.dispatch(setSelectedEntityId('test_sat'));
    renderWithProviders(<EntityDetailsDrawer />);
    expect(screen.queryByRole('heading', { name: 'ATC control zone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /listen to atc/i })).not.toBeInTheDocument();
  });

  it('closes via the close button and the Escape key', async () => {
    const user = userEvent.setup();
    store.dispatch(setSelectedEntityId('test_sat'));
    renderWithProviders(<EntityDetailsDrawer />);
    await user.click(screen.getByRole('button', { name: 'close inspector' }));
    expect(store.getState().entities.selectedEntityId).toBeNull();

    act(() => {
      store.dispatch(setSelectedEntityId('test_sat'));
    });
    await screen.findByRole('complementary', { name: 'Entity details' });
    await user.keyboard('{Escape}');
    expect(store.getState().entities.selectedEntityId).toBeNull();
  });

  it('renders nothing when no entity is selected', () => {
    store.dispatch(setSelectedEntityId(null));
    const { container } = renderWithProviders(<EntityDetailsDrawer />);
    expect(container).toBeEmptyDOMElement();
  });
});
