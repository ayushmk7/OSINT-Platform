import type { FC } from 'react';
import './flir.css';

/**
 * FLIR thermal pass: ironbow false-colour mapping (black → indigo → crimson → orange → yellow →
 * white) plus a temperature legend. Every element is `pointer-events: none` so the globe
 * underneath keeps full drag/zoom interaction.
 */
export const FlirThermalOverlay: FC = () => (
  <div className="flir-overlay-container" data-testid="flir-thermal-overlay" aria-hidden="true">
    <div className="flir-thermal-tint" />
    <div className="flir-cold-wash" />
    <div className="flir-vignette" />
    <div className="flir-status">FLIR · IRONBOW · WHITE HOT</div>
    <div className="flir-legend">
      <span>FLIR THERMAL SPECTRUM</span>
      <div className="flir-gradient-bar" />
      <div className="flir-legend-scale">
        <span>-20°C</span>
        <span>+80°C</span>
      </div>
    </div>
  </div>
);
