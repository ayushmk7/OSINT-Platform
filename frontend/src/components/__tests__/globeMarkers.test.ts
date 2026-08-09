import { describe, it, expect } from 'vitest';
import {
  styleForCategory,
  colorForCategory,
  MARKER_CATEGORIES,
  bearingRad,
  isEntityVisible
} from '../globeMarkers';

describe('globe markers', () => {
  // Rasterization needs a real <canvas> 2D context (jsdom has none), so the PNG output is
  // verified visually with a real browser. Here we test the pure category → style mapping and
  // the bearing math. NOTE: deliberately no "marker is an SVG data-URI" assertion —
  // SVG billboards crash Cesium's render loop, so such a test would be a false green.
  it('maps each known category to a distinct draw fn + color', () => {
    const sat = styleForCategory('satellite');
    const air = styleForCategory('aircraft');
    expect(sat.color).not.toEqual(air.color);
    expect(sat.draw).not.toBe(air.draw); // a distinct silhouette per category
  });

  it('covers the whole shared category enum with unique colors and shapes', () => {
    expect(MARKER_CATEGORIES).toEqual([
      'satellite',
      'aircraft',
      'geological',
      'radiation',
      'maritime'
    ]);
    const colors = MARKER_CATEGORIES.map(colorForCategory);
    expect(new Set(colors).size).toBe(MARKER_CATEGORIES.length);
    const draws = MARKER_CATEGORIES.map((c) => styleForCategory(c).draw);
    expect(new Set(draws).size).toBe(MARKER_CATEGORIES.length);
  });

  it('falls back to a neutral style for unknown categories', () => {
    expect(styleForCategory('unknown-xyz').color).toBe('#9ca3af');
  });

  it('computes an eastward bearing near +90°', () => {
    const deg = (bearingRad(0, 0, 0, 1) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(80);
    expect(deg).toBeLessThan(100);
  });

  it('computes a northward bearing near 0°', () => {
    expect(Math.abs((bearingRad(0, 0, 1, 0) * 180) / Math.PI)).toBeLessThan(1);
  });
});

describe('isEntityVisible', () => {
  const plane = { category: 'aircraft', source_id: 'adsb_military' };
  const quake = { category: 'geological', source_id: 'usgs_earthquakes' };
  const allSources = ['adsb_military', 'usgs_earthquakes'];

  it('draws everything before the source list has arrived', () => {
    expect(isEntityVisible(plane, null, [], false)).toBe(true);
    expect(isEntityVisible(quake, null, [], false)).toBe(true);
  });

  it('hides an entity whose source is unchecked', () => {
    expect(isEntityVisible(plane, null, ['usgs_earthquakes'], true)).toBe(false);
    expect(isEntityVisible(quake, null, ['usgs_earthquakes'], true)).toBe(true);
  });

  // Regression: unchecking the LAST data source used to make every marker reappear, because
  // the "nothing selected yet" escape hatch keyed on enabledSourceIds.length === 0.
  it('hides EVERYTHING when every source is unchecked', () => {
    expect(isEntityVisible(plane, null, [], true)).toBe(false);
    expect(isEntityVisible(quake, null, [], true)).toBe(false);
  });

  it('applies the category filter independently of the source filter', () => {
    expect(isEntityVisible(plane, 'aircraft', allSources, true)).toBe(true);
    expect(isEntityVisible(quake, 'aircraft', allSources, true)).toBe(false);
  });
});
