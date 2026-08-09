import { describe, it, expect } from 'vitest';
import entitiesReducer, {
  setInitialEntities,
  upsertEntity,
  setSelectedEntityId,
  setActiveCategoryFilter,
  MAX_TRAIL_POINTS,
  type EntityRecord
} from '../entitiesSlice';
import sourcesReducer, { setSources, toggleSourceEnabled } from '../sourcesSlice';

const iss = (overrides: Partial<EntityRecord> = {}): EntityRecord => ({
  id: 'sat1',
  source_id: 'iss_position',
  category: 'satellite',
  name: 'ISS',
  latitude: 10,
  longitude: 20,
  altitude: 400,
  timestamp: '2026-07-26T00:00:00Z',
  ...overrides
});

describe('Redux Slices', () => {
  describe('entitiesSlice', () => {
    it('handles setInitialEntities', () => {
      const state = entitiesReducer(undefined, setInitialEntities([iss()]));
      expect(state.entities['sat1']).toBeDefined();
      expect(state.entities['sat1'].name).toBe('ISS');
      expect(state.entities['sat1'].trail).toHaveLength(1);
    });

    it('handles upsertEntity and trail tracking', () => {
      let state = entitiesReducer(undefined, upsertEntity(iss()));
      expect(state.entities['sat1'].trail).toHaveLength(1);

      state = entitiesReducer(
        state,
        upsertEntity(iss({ latitude: 12, longitude: 22, timestamp: '2026-07-26T00:01:00Z' }))
      );
      expect(state.entities['sat1'].latitude).toBe(12);
      expect(state.entities['sat1'].trail).toHaveLength(2);
    });

    it('caps the trail so a long session cannot grow without bound', () => {
      let state = entitiesReducer(undefined, upsertEntity(iss()));
      for (let i = 0; i < MAX_TRAIL_POINTS + 5; i++) {
        state = entitiesReducer(state, upsertEntity(iss({ latitude: i })));
      }
      expect(state.entities['sat1'].trail).toHaveLength(MAX_TRAIL_POINTS);
    });

    it('handles entity selection & category filter', () => {
      let state = entitiesReducer(undefined, setSelectedEntityId('sat1'));
      expect(state.selectedEntityId).toBe('sat1');

      state = entitiesReducer(state, setActiveCategoryFilter('aircraft'));
      expect(state.activeCategoryFilter).toBe('aircraft');

      state = entitiesReducer(state, setSelectedEntityId(null));
      expect(state.selectedEntityId).toBeNull();
    });
  });

  describe('sourcesSlice', () => {
    it('handles setSources and toggleSourceEnabled', () => {
      let state = sourcesReducer(
        undefined,
        setSources([
          {
            id: 'src1',
            name: 'USGS',
            type: 'earthquake',
            transport: 'http_poll',
            url: 'http://example.test',
            update_interval_sec: 60,
            enabled: 1
          }
        ])
      );
      expect(state.sources['src1']).toBeDefined();
      expect(state.enabledSourceIds).toContain('src1');

      state = sourcesReducer(state, toggleSourceEnabled('src1'));
      expect(state.enabledSourceIds).not.toContain('src1');

      state = sourcesReducer(state, toggleSourceEnabled('src1'));
      expect(state.enabledSourceIds).toContain('src1');
    });

    it('leaves disabled sources out of enabledSourceIds', () => {
      const state = sourcesReducer(
        undefined,
        setSources([
          {
            id: 'off',
            name: 'Disabled feed',
            type: 'x',
            transport: 'http_poll',
            url: 'http://example.test',
            update_interval_sec: 60,
            enabled: 0
          }
        ])
      );
      expect(state.sources['off']).toBeDefined();
      expect(state.enabledSourceIds).toHaveLength(0);
    });
  });
});
