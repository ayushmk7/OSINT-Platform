import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CrtOverlay } from '../CrtOverlay';
import { NightVisionOverlay } from '../NightVisionOverlay';
import { FlirThermalOverlay } from '../FlirThermalOverlay';

describe('Cinematic Filter Overlay Components', () => {
  it('renders the CRT overlay with all of its raster layers', () => {
    const { container } = render(<CrtOverlay />);
    const root = screen.getByTestId('crt-overlay');
    expect(root).toBeInTheDocument();
    expect(container.querySelector('.crt-scanlines')).toBeTruthy();
    expect(container.querySelector('.crt-chromatic')).toBeTruthy();
    expect(container.querySelector('.crt-vignette')).toBeTruthy();
    expect(container.querySelector('.crt-flicker')).toBeTruthy();
  });

  it('renders the Night Vision overlay with phosphor, grain, grid and reticles', () => {
    const { container } = render(<NightVisionOverlay />);
    expect(screen.getByTestId('night-vision-overlay')).toBeInTheDocument();
    expect(container.querySelector('.nvg-phosphor-tint')).toBeTruthy();
    expect(container.querySelector('.nvg-noise')).toBeTruthy();
    expect(container.querySelector('.nvg-grid')).toBeTruthy();
    expect(container.querySelectorAll('.nvg-reticle-corner')).toHaveLength(4);
    expect(container.querySelector('.nvg-center-crosshair')).toBeTruthy();
  });

  it('renders the FLIR thermal overlay with the ironbow legend', () => {
    const { container } = render(<FlirThermalOverlay />);
    expect(screen.getByTestId('flir-thermal-overlay')).toBeInTheDocument();
    expect(container.querySelector('.flir-thermal-tint')).toBeTruthy();
    expect(container.querySelector('.flir-gradient-bar')).toBeTruthy();
    expect(screen.getByText('FLIR THERMAL SPECTRUM')).toBeInTheDocument();
    expect(screen.getByText('-20°C')).toBeInTheDocument();
    expect(screen.getByText('+80°C')).toBeInTheDocument();
  });

  it('marks every overlay root as non-interactive (pointer-events: none contract)', () => {
    // The wrappers must never intercept globe input; the rule lives in the imported CSS files,
    // so assert the marker class + aria-hidden that carry that contract in the DOM.
    for (const [Overlay, testId] of [
      [CrtOverlay, 'crt-overlay'],
      [NightVisionOverlay, 'night-vision-overlay'],
      [FlirThermalOverlay, 'flir-thermal-overlay']
    ] as const) {
      const { unmount } = render(<Overlay />);
      const root = screen.getByTestId(testId);
      expect(root.className).toMatch(/-overlay-container$/);
      expect(root).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });
});
