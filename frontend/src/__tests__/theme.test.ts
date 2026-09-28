import { describe, it, expect } from 'vitest';
import { tacticalTheme, hud, monoValue } from '../theme';

describe('tacticalTheme', () => {
  it('uses the dark palette with the single accent token', () => {
    expect(tacticalTheme.palette.mode).toBe('dark');
    expect(tacticalTheme.palette.primary.main).toBe(hud.accent);
    expect(tacticalTheme.palette.background.default).toBe('#05070a');
    expect(tacticalTheme.palette.text.primary).toBe(hud.textPrimary);
  });
  it('uses Inter for UI text and JetBrains Mono with tabular numerals for values', () => {
    expect(tacticalTheme.typography.fontFamily).toMatch(/Inter/);
    expect(monoValue.fontFamily).toMatch(/JetBrains Mono/);
    expect(monoValue.fontVariantNumeric).toBe('tabular-nums');
  });
});
