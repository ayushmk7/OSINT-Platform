import { describe, it, expect } from 'vitest';
import feedReducer, {
  MAX_FEED_ITEMS,
  addFeedItem,
  mergeFeedItems,
  setIndicators,
  upsertIndicator,
  type FeedItemRecord,
  type IndicatorRecord
} from '../../store/slices/feedSlice';
import entitiesReducer, {
  MAX_TRAIL_POINTS,
  setTrailLimits,
  upsertEntity,
  type EntityRecord
} from '../../store/slices/entitiesSlice';
import insightsReducer, { requestFlyTo } from '../../store/slices/insightsSlice';
import type { SourceRecord } from '../../store/slices/sourcesSlice';
import {
  formatChange,
  formatIndicatorValue,
  indicatorChange,
  sparklinePoints
} from '../indicatorFormat';
import { searchAll } from '../search';
import { buildLegend } from '../legend';
import { trailKey, trailLimitsFromSources, trailSegments, TRAIL_MAX_ALPHA } from '../trails';

export const feedItem = (over: Partial<FeedItemRecord> = {}): FeedItemRecord => ({
  id: 'news:1',
  source_id: 'news',
  item_id: '1',
  title: 'Citrix zero-day exploited',
  url: 'https://example.org/1',
  summary: 'Patch now.',
  published: '2026-09-28T10:00:00.000Z',
  tags: ['ics'],
  severity: 'high',
  latitude: null,
  longitude: null,
  entity_id: null,
  first_seen: '2026-09-28T10:00:00.000Z',
  ...over
});

export const indicator = (over: Partial<IndicatorRecord> = {}): IndicatorRecord => ({
  id: 'kp:kp',
  source_id: 'kp',
  indicator_id: 'kp',
  label: 'Planetary Kp',
  value: 3,
  unit: null,
  change: null,
  severity: 'info',
  updated_at: '2026-09-28T10:00:00.000Z',
  history: [
    { t: '2026-09-28T07:00:00.000Z', v: 2 },
    { t: '2026-09-28T10:00:00.000Z', v: 3 }
  ],
  ...over
});

const source = (id: string, over: Partial<SourceRecord> = {}): SourceRecord => ({
  id,
  name: id.toUpperCase(),
  type: 'x',
  transport: 'http_poll',
  url: 'http://x',
  update_interval_sec: 60,
  enabled: true,
  layer: { id, name: `${id} layer`, group: 'Cyber', description: '' },
  display: { declared: true, icon: 'news', color: '#ff0000' },
  ...over
});

describe('feedSlice', () => {
  it('merges, dedupes by id and keeps newest first', () => {
    let s = feedReducer(
      undefined,
      mergeFeedItems([
        feedItem(),
        feedItem({ id: 'news:2', published: '2026-09-28T12:00:00.000Z' })
      ])
    );
    s = feedReducer(s, addFeedItem(feedItem({ title: 'edited' })));
    expect(s.items.map((i) => i.id)).toEqual(['news:2', 'news:1']);
    expect(s.items[1].title).toBe('edited');
  });

  it('caps the client-side list', () => {
    const many = Array.from({ length: MAX_FEED_ITEMS + 10 }, (_, i) =>
      feedItem({ id: `n:${i}`, published: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() })
    );
    const s = feedReducer(undefined, mergeFeedItems(many));
    expect(s.items).toHaveLength(MAX_FEED_ITEMS);
    expect(s.items[0].id).toBe(`n:${MAX_FEED_ITEMS + 9}`);
  });

  it('replaces and upserts indicators', () => {
    let s = feedReducer(undefined, setIndicators([indicator()]));
    s = feedReducer(s, upsertIndicator(indicator({ value: 5 })));
    expect(s.indicators['kp:kp'].value).toBe(5);
  });
});

describe('entitiesSlice trail limits', () => {
  const ent = (lat: number): EntityRecord => ({
    id: 'a',
    source_id: 'adsb',
    category: 'aircraft',
    name: 'A',
    latitude: lat,
    longitude: 0,
    altitude: 0,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, lat)).toISOString()
  });

  it('keeps max_points per source and skips unmoved repeats', () => {
    let s = entitiesReducer(undefined, setTrailLimits({ adsb: 50 }));
    for (let i = 0; i < 60; i++) s = entitiesReducer(s, upsertEntity(ent(i)));
    expect(s.entities.a.trail).toHaveLength(50);
    s = entitiesReducer(s, upsertEntity(ent(59)));
    expect(s.entities.a.trail).toHaveLength(50);
    s = entitiesReducer(s, setTrailLimits({}));
    s = entitiesReducer(s, upsertEntity(ent(61)));
    expect(s.entities.a.trail).toHaveLength(MAX_TRAIL_POINTS);
  });
});

describe('requestFlyTo', () => {
  it('accepts an entity id or an entity id with a fallback point', () => {
    let s = insightsReducer(undefined, requestFlyTo('e1'));
    expect(s.flyTo).toEqual({ entityId: 'e1', nonce: 1 });
    s = insightsReducer(s, requestFlyTo({ entityId: 'f:1', latitude: 10, longitude: 20 }));
    expect(s.flyTo).toEqual({ entityId: 'f:1', latitude: 10, longitude: 20, nonce: 2 });
  });
});

describe('indicator formatting', () => {
  it('formats values by magnitude', () => {
    expect(formatIndicatorValue(83268)).toBe('83,268');
    expect(formatIndicatorValue(118.76)).toBe('118.8');
    expect(formatIndicatorValue(1.333)).toBe('1.33');
    expect(formatIndicatorValue(3.8e-7)).toBe('3.80e-7');
    expect(formatIndicatorValue(40_068_807_991_924)).toBe('40.07T');
    expect(formatIndicatorValue(0)).toBe('0');
  });

  it('uses the source change as a percentage, else the last history step', () => {
    expect(indicatorChange(indicator({ change: -1.62 }))).toEqual({
      value: -1.62,
      percent: true,
      direction: 'down'
    });
    const derived = indicatorChange(indicator());
    expect(derived).toEqual({ value: 1, percent: false, direction: 'up' });
    expect(formatChange(derived!)).toBe('+1');
    expect(formatChange({ value: -0.0048, percent: false, direction: 'down' }, 40)).toBe('−0.0048');
    expect(formatChange({ value: 2.2e-8, percent: false, direction: 'up' }, 3e-7)).toBe('+2.20e-8');
    expect(indicatorChange(indicator({ history: [] }))).toBeNull();
  });

  it('draws a sparkline spanning the box, flat series in the middle', () => {
    const pts = sparklinePoints(indicator().history, 100, 20).split(' ');
    expect(pts).toEqual(['0.0,18.5', '100.0,1.5']);
    expect(
      sparklinePoints(
        [
          { t: 'a', v: 1 },
          { t: 'b', v: 1 }
        ],
        10,
        10
      )
    ).toBe('0.0,5.0 10.0,5.0');
    expect(sparklinePoints([], 10, 10)).toBe('');
  });
});

describe('search', () => {
  const entities: Record<string, EntityRecord> = {
    'adsb:ae1234': {
      id: 'adsb:ae1234',
      source_id: 'adsb',
      category: 'aircraft',
      name: 'RCH123',
      latitude: 1,
      longitude: 2,
      altitude: 0,
      timestamp: '',
      metadata: { registration: '05-5140', type: 'C17' }
    },
    'iss:25544': {
      id: 'iss:25544',
      source_id: 'iss',
      category: 'satellite',
      name: 'ISS',
      latitude: 3,
      longitude: 4,
      altitude: 0,
      timestamp: ''
    }
  };
  const sources = { news: source('news') };

  it('matches names, ids and metadata, entities before feed items', () => {
    expect(searchAll('rch', entities, sources, [])[0].id).toBe('adsb:ae1234');
    expect(searchAll('c17', entities, sources, [])[0].id).toBe('adsb:ae1234');
    expect(searchAll('25544', entities, sources, [])[0].title).toBe('ISS');
    const mixed = searchAll('is', entities, sources, [feedItem({ title: 'ISS reboost' })]);
    expect(mixed.map((r) => r.kind)).toEqual(['entity', 'feed']);
    expect(searchAll('x', entities, sources, [])).toEqual([]);
  });

  it('finds feed titles and tags with every token required', () => {
    const r = searchAll('citrix zero', {}, sources, [feedItem()]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'feed', subtitle: 'NEWS', url: 'https://example.org/1' });
    expect(searchAll('citrix nope', {}, sources, [feedItem()])).toEqual([]);
    expect(searchAll('ics', {}, sources, [feedItem()])).toHaveLength(1);
  });
});

describe('legend with non-geo sources', () => {
  it('hides indicator sources and feeds without plotted items', () => {
    const sources = {
      kp: source('kp', { kind: 'indicator' }),
      news: source('news', { kind: 'feed' }),
      gdacs: source('gdacs', { kind: 'feed' }),
      quakes: source('quakes')
    };
    const ids = (counts: Record<string, number>) =>
      buildLegend(sources, counts).flatMap((g) => g.layers.map((l) => l.id));
    expect(ids({ gdacs: 3 }).sort()).toEqual(['gdacs', 'quakes']);
    expect(ids({})).toEqual(['quakes']);
  });
});

describe('trails', () => {
  it('reads max_points from trail-enabled sources only', () => {
    expect(
      trailLimitsFromSources({
        a: source('a', {
          display: { icon: 'plane', color: '#fff', trail: { enabled: true, max_points: 50 } }
        }),
        b: source('b', {
          display: { icon: 'plane', color: '#fff', trail: { enabled: false, max_points: 50 } }
        }),
        c: source('c')
      })
    ).toEqual({ a: 50 });
  });

  it('splits a trail into contiguous fading segments', () => {
    expect(trailSegments(1)).toEqual([]);
    expect(trailSegments(2)).toEqual([{ from: 0, to: 1, alpha: TRAIL_MAX_ALPHA }]);
    const segs = trailSegments(20);
    expect(segs).toHaveLength(4);
    expect(segs[0].from).toBe(0);
    expect(segs[3].to).toBe(19);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].from).toBe(segs[i - 1].to);
      expect(segs[i].alpha).toBeGreaterThan(segs[i - 1].alpha);
    }
  });

  it('keys a trail on its length, last point and colour', () => {
    const p = { latitude: 1, longitude: 2, altitude: 0, timestamp: '' };
    expect(trailKey([p], '#fff')).not.toBe(trailKey([p, { ...p, latitude: 3 }], '#fff'));
    expect(trailKey([p], '#fff')).not.toBe(trailKey([p], '#000'));
    expect(trailKey([], '#fff')).toBe('');
  });
});
