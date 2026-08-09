import type { FC } from 'react';
import './night-vision.css';

/**
 * Night-vision goggles pass: green (#00ff66) phosphor colour matrix, animated sensor grain,
 * tactical grid, corner reticles, centre crosshair and scope vignette. Every element is
 * `pointer-events: none` so the globe underneath keeps full drag/zoom interaction.
 */
export const NightVisionOverlay: FC = () => (
  <div className="nvg-overlay-container" data-testid="night-vision-overlay" aria-hidden="true">
    <div className="nvg-phosphor-tint" />
    <div className="nvg-grid" />
    <div className="nvg-noise" />
    <div className="nvg-scope-vignette" />
    <div className="nvg-reticle-corner nvg-top-left" />
    <div className="nvg-reticle-corner nvg-top-right" />
    <div className="nvg-reticle-corner nvg-bottom-left" />
    <div className="nvg-reticle-corner nvg-bottom-right" />
    <div className="nvg-center-crosshair" />
    <div className="nvg-status">NVG · GAIN 04 · IR ILLUM OFF</div>
  </div>
);
