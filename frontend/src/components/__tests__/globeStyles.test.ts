import { describe, it, expect } from 'vitest';
import {
  GLOBE_STYLES,
  GLOBE_STYLE_LABELS,
  DEFAULT_GLOBE_STYLE,
  STYLE_OVERLAY_NAME,
  isGlobeStyle,
  makeTacticalBaseLayer,
  type GlobeStyle
} from '../globeStyles';

describe('globe style catalogue', () => {
  it('offers exactly the six switchable looks, with no duplicates', () => {
    expect(GLOBE_STYLES).toHaveLength(6);
    expect(new Set(GLOBE_STYLES).size).toBe(6);
    expect([...GLOBE_STYLES]).toEqual([
      'tactical',
      'blue_marble',
      'night_lights',
      'neon_vector',
      'terrain_relief',
      'holographic'
    ]);
  });

  it('labels every style for the header selector', () => {
    for (const style of GLOBE_STYLES) {
      expect(GLOBE_STYLE_LABELS[style]).toBeTruthy();
    }
  });

  it('defaults to the existing tactical dark look', () => {
    expect(DEFAULT_GLOBE_STYLE).toBe('tactical');
    expect(GLOBE_STYLES).toContain(DEFAULT_GLOBE_STYLE);
  });

  it('guards unknown style ids', () => {
    expect(isGlobeStyle('holographic')).toBe(true);
    expect(isGlobeStyle('wireframe')).toBe(false);
    expect(isGlobeStyle(undefined)).toBe(false);
  });

  it('tags style-owned overlays with an identifiable prefix so they can be removed again', () => {
    expect(STYLE_OVERLAY_NAME).toMatch(/globe-style/);
  });

  it('keeps the tactical basemap on its original Stadia dark tiles', () => {
    const layer = makeTacticalBaseLayer();
    const url = (layer.imageryProvider as unknown as { url: string }).url;
    expect(url).toContain('alidade_smooth_dark');
    // Stadia's `{r}` retina placeholder is not understood by UrlTemplateImageryProvider.
    expect(url).not.toContain('{r}');
  });

  it('accepts every catalogue id where a GlobeStyle is required', () => {
    const styles: GlobeStyle[] = [...GLOBE_STYLES];
    expect(styles.every(isGlobeStyle)).toBe(true);
  });
});
