import { describe, it, expect } from 'vitest';
import { DIRECTIONAL_ICONS, ICON_KEYS, ICON_REGISTRY, iconDrawFn } from '../markerIcons';

/** The icon keys of the shared source contract, verbatim. */
const CONTRACT_ICON_KEYS = [
  'dot',
  'plane',
  'helicopter',
  'ship',
  'satellite',
  'rocket',
  'iss',
  'quake',
  'volcano',
  'fire',
  'storm',
  'lightning',
  'flood',
  'tsunami',
  'radiation',
  'nuclear',
  'biohazard',
  'factory',
  'power',
  'cable',
  'tower',
  'antenna',
  'port',
  'airport',
  'military',
  'conflict',
  'explosion',
  'alert',
  'news',
  'shield',
  'bug',
  'buoy',
  'balloon',
  'camera',
  'pin'
];

/**
 * jsdom has no 2D context: record every colour assignment and count paint calls on a Proxy
 * that accepts any canvas method, so each glyph can be checked without a real canvas.
 */
function recordingCtx() {
  const colors: string[] = [];
  const paints = { fill: 0, stroke: 0, fillRect: 0 };
  const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (..._args: unknown[]) => {
        if (prop in paints) paints[prop as keyof typeof paints] += 1;
      };
    },
    set(target, prop: string, value) {
      if (prop === 'fillStyle' || prop === 'strokeStyle') colors.push(String(value));
      target[prop] = value;
      return true;
    }
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, colors, paints };
}

describe('icon registry', () => {
  it('covers every contract icon key, in contract order', () => {
    expect(ICON_KEYS).toEqual(CONTRACT_ICON_KEYS);
  });

  it('has a distinct draw fn per key', () => {
    const fns = ICON_KEYS.map((k) => ICON_REGISTRY[k]);
    expect(new Set(fns).size).toBe(ICON_KEYS.length);
  });

  it.each(CONTRACT_ICON_KEYS)('%s paints something, only in the colour it is given', (key) => {
    const { ctx, colors, paints } = recordingCtx();
    iconDrawFn(key)(ctx, '#12ab34');
    expect(paints.fill + paints.stroke + paints.fillRect).toBeGreaterThan(0);
    expect(colors.length).toBeGreaterThan(0);
    expect(new Set(colors)).toEqual(new Set(['#12ab34']));
  });

  it('falls back to the dot for an unknown key', () => {
    expect(iconDrawFn('unicorn')).toBe(ICON_REGISTRY.dot);
  });

  it('marks nose-first silhouettes as rotatable', () => {
    for (const key of DIRECTIONAL_ICONS) expect(ICON_KEYS).toContain(key);
    expect(DIRECTIONAL_ICONS.has('plane')).toBe(true);
    expect(DIRECTIONAL_ICONS.has('quake')).toBe(false);
  });
});
