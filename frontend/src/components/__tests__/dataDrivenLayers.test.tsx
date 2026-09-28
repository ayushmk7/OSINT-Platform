import type { ReactElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { describe, it, expect } from 'vitest';
import { store } from '../../store';
import { tacticalTheme } from '../../theme';
import { LayerControlDrawer } from '../LayerControlDrawer';
import { EntityDetailsDrawer } from '../EntityDetailsDrawer';
import {
  removeEntities,
  setInitialEntities,
  setSelectedEntityId,
  upsertEntity
} from '../../store/slices/entitiesSlice';
import sourcesReducer, {
  mergeSources,
  setSources,
  toggleSourceEnabled,
  type SourceRecord
} from '../../store/slices/sourcesSlice';
import { osintApi } from '../../store/api/osintApi';
import { expiredEntityIds } from '../../hooks/useTtlPruner';

const renderWithProviders = (ui: ReactElement) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme={tacticalTheme}>{ui}</ThemeProvider>
    </Provider>
  );

function source(id: string, layerId: string, group: string, extra: Partial<SourceRecord> = {}) {
  return {
    id,
    name: id,
    type: 't',
    transport: 'http_poll',
    url: 'http://example.test',
    update_interval_sec: 60,
    enabled: true,
    layer: { id: layerId, name: `Layer ${layerId}`, group, description: `${layerId} feed` },
    display: { declared: true, icon: 'fire', color: '#ff7b00', ttl_seconds: 600 },
    ...extra
  } satisfies SourceRecord;
}

describe('data-driven legend', () => {
  it('builds collapsible groups from source layers, with counts and a quick filter', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) =>
      source(`src${i}`, `layer_${i}`, i % 2 ? 'Weather' : 'Hazards')
    );
    store.dispatch(setSources(many));
    store.dispatch(
      setInitialEntities([
        {
          id: 'e1',
          source_id: 'src0',
          category: 'layer_0',
          name: 'Fire 1',
          latitude: 0,
          longitude: 0,
          altitude: 0,
          timestamp: new Date().toISOString()
        }
      ])
    );

    renderWithProviders(<LayerControlDrawer open={true} onClose={() => {}} />);

    const hazards = screen.getByRole('button', { name: 'Hazards group' });
    expect(hazards).toHaveTextContent('6');
    expect(screen.getByRole('button', { name: /Layer layer_0/ })).toHaveTextContent('1');

    // Isolate by layer id.
    await user.click(screen.getByRole('button', { name: /Layer layer_0/ }));
    expect(store.getState().entities.activeCategoryFilter).toBe('layer_0');
    await user.click(screen.getByRole('button', { name: 'Show all' }));

    // Collapse a group.
    await user.click(hazards);
    expect(hazards).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Layer layer_0/ })).not.toBeInTheDocument()
    );

    // Quick filter (shown for 8+ layers) searches across collapsed groups too.
    await user.type(screen.getByRole('textbox', { name: 'filter layers' }), 'layer_10');
    const list = screen.getAllByRole('listitem');
    expect(list).toHaveLength(1);
    expect(within(list[0]).getByText('Layer layer_10')).toBeInTheDocument();
  });
});

describe('entity card fields', () => {
  it('renders display.fields with formats before the remaining metadata', async () => {
    await store.dispatch(
      osintApi.util.upsertQueryData(
        'getObservations',
        { entity_id: 'q1', limit: 25 },
        { total: 0, limit: 25, offset: 0, observations: [] }
      )
    );
    store.dispatch(
      setSources([
        source('usgs', 'quakes', 'Hazards', {
          display: {
            declared: true,
            icon: 'quake',
            color: '#ff0055',
            fields: [
              { path: 'metadata.mag', label: 'Magnitude', format: 'number', precision: 1 },
              { path: 'metadata.url', label: 'Details', format: 'link' }
            ]
          }
        })
      ])
    );
    store.dispatch(
      upsertEntity({
        id: 'q1',
        source_id: 'usgs',
        category: 'quakes',
        name: 'M 4.6 - Somewhere',
        latitude: 1,
        longitude: 2,
        altitude: 0,
        timestamp: new Date().toISOString(),
        metadata: { mag: 4.567, url: 'https://example.org/q1', network: 'us' }
      })
    );
    store.dispatch(setSelectedEntityId('q1'));

    renderWithProviders(<EntityDetailsDrawer />);
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByText('Magnitude')).toBeInTheDocument();
    expect(screen.getByText('4.6')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /example\.org\/q1/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    // Remaining metadata still listed; field-backed keys are not repeated.
    expect(screen.getByText('network')).toBeInTheDocument();
    expect(screen.queryByText('mag')).not.toBeInTheDocument();
    // Header badge uses the layer name for a non-legacy category.
    expect(screen.getByText('Layer quakes')).toBeInTheDocument();
  });
});

describe('ttl + removal', () => {
  it('removeEntities drops entities and clears a removed selection', () => {
    store.dispatch(setSelectedEntityId('q1'));
    store.dispatch(removeEntities(['q1']));
    expect(store.getState().entities.entities.q1).toBeUndefined();
    expect(store.getState().entities.selectedEntityId).toBeNull();
  });

  it('finds entities older than their source ttl', () => {
    store.dispatch(setSources([source('fires', 'fires', 'Hazards')]));
    store.dispatch(
      setInitialEntities([
        {
          id: 'old',
          source_id: 'fires',
          category: 'fires',
          name: 'old',
          latitude: 0,
          longitude: 0,
          altitude: 0,
          timestamp: new Date(Date.now() - 3600_000).toISOString()
        },
        {
          id: 'new',
          source_id: 'fires',
          category: 'fires',
          name: 'new',
          latitude: 0,
          longitude: 0,
          altitude: 0,
          timestamp: new Date().toISOString()
        }
      ])
    );
    expect(expiredEntityIds(store.getState(), Date.now())).toEqual(['old']);
  });

  it('mergeSources keeps the user toggles of known sources', () => {
    let state = sourcesReducer(undefined, setSources([source('a', 'a', 'Other')]));
    state = sourcesReducer(state, toggleSourceEnabled('a'));
    state = sourcesReducer(
      state,
      mergeSources([source('a', 'a', 'Other'), source('b', 'b', 'Other')])
    );
    expect(state.enabledSourceIds).toEqual(['b']);
  });
});
