import type { FC } from 'react';
import './crt.css';

/**
 * Retro CRT post-processing pass: scanlines, RGB aperture-grille chromatic fringing, curvature
 * vignette, phosphor flicker and a slow roll bar. Purely decorative — the wrapper and every
 * child are `pointer-events: none`, so the globe underneath stays fully draggable/zoomable.
 */
export const CrtOverlay: FC = () => (
  <div className="crt-overlay-container" data-testid="crt-overlay" aria-hidden="true">
    <div className="crt-scanlines" />
    <div className="crt-chromatic" />
    <div className="crt-rolling-bar" />
    <div className="crt-vignette" />
    <div className="crt-flicker" />
  </div>
);
