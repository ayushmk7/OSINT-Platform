import { describe, it, expect } from 'vitest';
import type { EntityRecord } from '../../store/slices/entitiesSlice';
import type { SourceRecord } from '../../store/slices/sourcesSlice';
import {
  colorForEntity,
  entityHeadingRad,
  entityLayerId,
  interpolateStops,
  isExpired,
  parseHexColor,
  resolveEntityPath,
  resolveEntityStyle
} from '../layerStyle';
import { colorForCategory } from '../globeMarkers';

const quake = (mag: unknown, extra: Partial<EntityRecord> = {}): EntityRecord => ({
  id: 'usgs:1',
  source_id: 'usgs',
  category: 'geological',
  name: 'Q',
  latitude: 0,
  longitude: 0,
  altitude: -10000,
  timestamp: '2026-09-28T12:00:00.000Z',
  metadata: { mag },
  ...extra
});

const source = (display: SourceRecord['display'], layerId = 'earthquakes'): SourceRecord => ({
  id: 'usgs',
  name: 'USGS',
  type: 'usgs',
  transport: 'http_poll',
  url: 'http://example.test',
  update_interval_sec: 60,
  enabled: true,
  layer: { id: layerId, name: 'Earthquakes', group: 'Hazards', description: '' },
  display
});

const STOPS: Array<[number, string]> = [
  [0, '#000000'],
  [10, '#ffffff']
];

describe('color_by interpolation', () => {
  it('clamps below the first and above the last stop', () => {
    expect(interpolateStops(-5, STOPS)).toBe('#000000');
    expect(interpolateStops(99, STOPS)).toBe('#ffffff');
  });

  it('interpolates linearly between stops', () => {
    expect(interpolateStops(5, STOPS)).toBe('#808080');
  });

  it('quantizes to a bounded number of colours per segment', () => {
    const seen = new Set<string>();
    for (let v = 0; v <= 10; v += 0.01) seen.add(interpolateStops(v, STOPS));
    expect(seen.size).toBeLessThanOrEqual(9);
  });

  it('handles several stops and short hex', () => {
    const stops: Array<[number, string]> = [
      [0, '#f00'],
      [4, '#00ff00'],
      [6, '#0000ff']
    ];
    expect(interpolateStops(4, stops)).toBe('#00ff00');
    expect(interpolateStops(5, stops)).toBe('#008080');
    expect(parseHexColor('#f00')).toEqual([255, 0, 0]);
    expect(parseHexColor('nope')).toBeNull();
  });

  it('resolves stops, map and default against the entity', () => {
    const base = '#abcdef';
    expect(colorForEntity(quake(10), { field: 'metadata.mag', stops: STOPS }, base)).toBe(
      '#ffffff'
    );
    expect(colorForEntity(quake('10'), { field: 'metadata.mag', stops: STOPS }, base)).toBe(
      '#ffffff'
    );
    expect(colorForEntity(quake(null), { field: 'metadata.mag', stops: STOPS }, base)).toBe(base);
    expect(
      colorForEntity(
        quake('high'),
        { field: 'metadata.mag', map: { high: '#ff0000' }, default: '#111111' },
        base
      )
    ).toBe('#ff0000');
    expect(
      colorForEntity(
        quake('low'),
        { field: 'metadata.mag', map: { high: '#ff0000' }, default: '#111111' },
        base
      )
    ).toBe('#111111');
    expect(colorForEntity(quake(1), { field: 'altitude', stops: STOPS }, base)).toBe('#000000');
  });

  it('resolves dotted and indexed paths', () => {
    expect(resolveEntityPath({ metadata: { a: [{ b: 3 }] } }, 'metadata.a[0].b')).toBe(3);
    expect(resolveEntityPath({}, 'metadata.x.y')).toBeUndefined();
  });
});

describe('resolveEntityStyle', () => {
  it('uses the declared display block', () => {
    const style = resolveEntityStyle(
      quake(10),
      source({
        declared: true,
        icon: 'quake',
        color: '#ff3b6b',
        size: 1.5,
        rotate: false,
        color_by: { field: 'metadata.mag', stops: STOPS }
      })
    );
    expect(style).toEqual({ icon: 'quake', color: '#ffffff', size: 1.5, rotate: false });
  });

  it('falls back to the legacy category style without a declared display', () => {
    const legacy = resolveEntityStyle(quake(1), undefined);
    expect(legacy.icon).toBeNull();
    expect(legacy.color).toBe(colorForCategory('geological'));
    const undeclared = resolveEntityStyle(
      quake(1),
      source({ declared: false, icon: 'dot', color: '#9ca3af' })
    );
    expect(undeclared.icon).toBeNull();
    expect(resolveEntityStyle({ ...quake(1), category: 'aircraft' }, undefined).rotate).toBe(true);
  });

  it('maps an entity to its source layer id, else its category', () => {
    expect(entityLayerId(quake(1), source(null, 'seismic'))).toBe('seismic');
    expect(entityLayerId(quake(1), undefined)).toBe('geological');
  });
});

describe('ttl + heading', () => {
  const now = Date.parse('2026-09-28T12:10:00.000Z');

  it('expires an entity older than its source ttl only', () => {
    const d = { declared: true, icon: 'quake', color: '#fff' };
    expect(isExpired(quake(1), source({ ...d, ttl_seconds: 300 }), now)).toBe(true);
    expect(isExpired(quake(1), source({ ...d, ttl_seconds: 3600 }), now)).toBe(false);
    expect(isExpired(quake(1), source({ ...d, ttl_seconds: null }), now)).toBe(false);
    expect(isExpired(quake(1), undefined, now)).toBe(false);
  });

  it('prefers the reported heading, then the trail bearing', () => {
    expect(entityHeadingRad(quake(1, { heading: 90 }))).toBeCloseTo(Math.PI / 2);
    const trail = [
      { latitude: 0, longitude: 0, altitude: 0, timestamp: '' },
      { latitude: 1, longitude: 0, altitude: 0, timestamp: '' }
    ];
    expect(entityHeadingRad(quake(1, { trail }))).toBeCloseTo(0);
    expect(entityHeadingRad(quake(1))).toBeNull();
  });
});
