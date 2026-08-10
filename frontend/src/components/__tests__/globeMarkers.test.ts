import { describe, it, expect, vi } from 'vitest';
import {
  styleForCategory,
  colorForCategory,
  MARKER_CATEGORIES,
  bearingRad,
  isEntityVisible,
  zoneRadiusMeters,
  DEFAULT_ZONE_RADIUS_KM,
  ATC_ZONE_CATEGORY
} from '../globeMarkers';

/**
 * jsdom has no canvas 2D context, so drawing is exercised against a recording stub: it captures
 * every `fillStyle` assignment and counts the path calls, which is enough to prove a draw fn
 * actually paints a silhouette in the category color rather than no-op'ing.
 */
function recordingCtx() {
  const fillStyles: string[] = [];
  const ctx = {
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn()
  };
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fillStyles[fillStyles.length - 1] ?? '',
    set: (value: string) => {
      fillStyles.push(value);
    }
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillStyles, calls: ctx };
}

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
      'maritime',
      'atc_zone'
    ]);
    const colors = MARKER_CATEGORIES.map(colorForCategory);
    expect(new Set(colors).size).toBe(MARKER_CATEGORIES.length);
    const draws = MARKER_CATEGORIES.map((c) => styleForCategory(c).draw);
    expect(new Set(draws).size).toBe(MARKER_CATEGORIES.length);
  });

  it('falls back to a neutral style for unknown categories', () => {
    expect(styleForCategory('unknown-xyz').color).toBe('#9ca3af');
  });

  it('gives atc_zone a real color instead of the neutral fallback', () => {
    const atc = colorForCategory(ATC_ZONE_CATEGORY);
    expect(atc).not.toBe('#9ca3af');
    expect(atc).toMatch(/^#[0-9a-f]{6}$/i);
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

describe('ATC control-tower marker', () => {
  it('paints a filled tower silhouette in the category color with a black inset', () => {
    const { ctx, fillStyles, calls } = recordingCtx();
    styleForCategory(ATC_ZONE_CATEGORY).draw(ctx, '#b388ff');

    expect(fillStyles).toContain('#b388ff'); // the silhouette is drawn in the layer color
    expect(fillStyles).toContain('#000000'); // …with the embossed cutout the other 5 icons use
    expect(calls.fill).toHaveBeenCalled();
    expect(calls.fillRect).toHaveBeenCalled(); // mast / shaft
    expect(calls.arc).toHaveBeenCalled(); // beacon dot
  });

  it('is a distinct shape and color from every other category', () => {
    const atc = styleForCategory(ATC_ZONE_CATEGORY);
    for (const other of MARKER_CATEGORIES.filter((c) => c !== ATC_ZONE_CATEGORY)) {
      expect(atc.draw).not.toBe(styleForCategory(other).draw);
      expect(atc.color).not.toBe(colorForCategory(other));
    }
  });
});

describe('zoneRadiusMeters', () => {
  it('converts a radius_km number to metres', () => {
    expect(zoneRadiusMeters(9)).toBe(9000);
    expect(zoneRadiusMeters(5)).toBe(5000);
  });

  it('accepts a numeric string, because metadata round-trips through JSON', () => {
    expect(zoneRadiusMeters('9')).toBe(9000);
  });

  // A missing/garbage radius must never produce NaN (crashes the ellipse) or 0 (invisible).
  it('falls back to the default radius for missing or unusable values', () => {
    const fallback = DEFAULT_ZONE_RADIUS_KM * 1000;
    expect(zoneRadiusMeters(undefined)).toBe(fallback);
    expect(zoneRadiusMeters('not-a-number')).toBe(fallback);
    expect(zoneRadiusMeters(0)).toBe(fallback);
    expect(zoneRadiusMeters(-3)).toBe(fallback);
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
