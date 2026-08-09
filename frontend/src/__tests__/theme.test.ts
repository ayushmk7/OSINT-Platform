import { describe, it, expect } from 'vitest';
import { tacticalTheme } from '../theme';

describe('tacticalTheme', () => {
  it('uses the green-on-black tactical palette', () => {
    expect(tacticalTheme.palette.mode).toBe('dark');
    expect(tacticalTheme.palette.primary.main).toBe('#00ff9d');
    expect(tacticalTheme.palette.background.default).toBe('#000000');
  });
  it('uses a monospace font stack', () => {
    expect(tacticalTheme.typography.fontFamily).toMatch(/JetBrains Mono/);
  });
});
