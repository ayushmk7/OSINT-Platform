import { describe, it, expect } from 'vitest';
import type { EntityRecord } from '../../store/slices/entitiesSlice';
import type { SourceRecord } from '../../store/slices/sourcesSlice';
import { buildLegend, countByLayer, filterLegend } from '../legend';
import { MARKER_CATEGORIES } from '../globeMarkers';

function src(
  id: string,
  layer: SourceRecord['layer'],
  display: SourceRecord['display'] = { declared: true, icon: 'dot', color: '#123456' }
): SourceRecord {
  return {
    id,
    name: id,
    type: 't',
    transport: 'http_poll',
    url: 'u',
    update_interval_sec: 60,
    enabled: true,
    layer,
    display
  };
}

const ent = (id: string, source_id: string, category: string): EntityRecord => ({
  id,
  source_id,
  category,
  name: id,
  latitude: 0,
  longitude: 0,
  altitude: 0,
  timestamp: '2026-09-28T00:00:00Z'
});

describe('legend', () => {
  const sources: Record<string, SourceRecord> = {
    usgs: src('usgs', { id: 'quakes', name: 'Earthquakes', group: 'Hazards', description: 'd' }),
    emsc: src('emsc', { id: 'quakes', name: 'Quakes (EMSC)', group: 'Hazards', description: '' }),
    fires: src('fires', { id: 'fires', name: 'Wildfires', group: 'Hazards', description: '' }),
    adsb: src('adsb', { id: 'aircraft', name: 'Aircraft', group: 'Aviation', description: '' }),
    odd: src('odd', { id: 'misc', name: 'Misc', group: 'Other', description: '' })
  };

  it('groups layers by group in contract order, merging sources that share a layer id', () => {
    const counts = countByLayer(
      {
        a: ent('a', 'usgs', 'quakes'),
        b: ent('b', 'emsc', 'quakes'),
        c: ent('c', 'adsb', 'aircraft')
      },
      sources
    );
    const groups = buildLegend(sources, counts);
    expect(groups.map((g) => g.name)).toEqual(['Aviation', 'Hazards', 'Other']);
    const hazards = groups[1];
    expect(hazards.layers.map((l) => l.id)).toEqual(['quakes', 'fires']);
    expect(hazards.layers[0].sourceIds).toEqual(['usgs', 'emsc']);
    expect(hazards.layers[0].count).toBe(2);
    expect(hazards.count).toBe(2);
    expect(hazards.layers[0].icon).toBe('dot');
    expect(hazards.layers[0].color).toBe('#123456');
  });

  it('lists the legacy categories when no source declares a layer', () => {
    const groups = buildLegend({ x: src('x', null, null) }, {});
    const ids = groups.flatMap((g) => g.layers.map((l) => l.id));
    expect(ids.sort()).toEqual([...MARKER_CATEGORIES].sort());
    expect(groups.flatMap((g) => g.layers).every((l) => l.icon === null)).toBe(true);
  });

  it('adds a legacy row for entities whose layer no source declares', () => {
    const groups = buildLegend(sources, { satellite: 3 });
    const space = groups.find((g) => g.name === 'Space');
    expect(space?.layers[0]).toMatchObject({ id: 'satellite', count: 3, icon: null });
  });

  it('scales to 60+ layers', () => {
    const many: Record<string, SourceRecord> = {};
    for (let i = 0; i < 64; i++) {
      many[`s${i}`] = src(`s${i}`, {
        id: `layer_${i}`,
        name: `Layer ${i}`,
        group: ['Weather', 'Cyber', 'News', 'Conflict'][i % 4],
        description: ''
      });
    }
    const groups = buildLegend(many, {});
    expect(groups.reduce((n, g) => n + g.layers.length, 0)).toBe(64);
    expect(groups.map((g) => g.name)).toEqual(['Weather', 'Conflict', 'Cyber', 'News']);
  });

  it('filters by layer name, description, id or group', () => {
    const groups = buildLegend(sources, {});
    expect(filterLegend(groups, 'wild').flatMap((g) => g.layers.map((l) => l.id))).toEqual([
      'fires'
    ]);
    expect(filterLegend(groups, 'aviation').map((g) => g.name)).toEqual(['Aviation']);
    expect(filterLegend(groups, '  ')).toBe(groups);
    expect(filterLegend(groups, 'zzz')).toEqual([]);
  });
});
