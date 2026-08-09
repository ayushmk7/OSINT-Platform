// Tactical filled-silhouette markers drawn directly with Canvas 2D — no icon library, no disc.
// Each drawX() fills a solid silhouette in the category color, with a black inset cutout for an
// embossed "outlined" feel plus a center dot. Rotatable shapes (flight, ship) point north
// (heading 0) so GlobeView can rotate them to travel heading.
type IconDrawFn = (ctx: CanvasRenderingContext2D, color: string) => void;

const ICON_SIZE = 32; // logical drawing grid (CX = CY = 16)
const CANVAS_SCALE = 2; // render at 2x so billboards stay crisp when Cesium scales them
const CX = ICON_SIZE / 2;
const CY = ICON_SIZE / 2;

// satellite — diamond / rhombus (radar-tracked asset)
function drawSatelliteIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  const R = 11;
  ctx.beginPath();
  ctx.moveTo(CX, CY - R);
  ctx.lineTo(CX + R, CY);
  ctx.lineTo(CX, CY + R);
  ctx.lineTo(CX - R, CY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#000000';
  const IR = 6;
  ctx.beginPath();
  ctx.moveTo(CX, CY - IR);
  ctx.lineTo(CX + IR, CY);
  ctx.lineTo(CX, CY + IR);
  ctx.lineTo(CX - IR, CY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(CX, CY, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// aircraft — top-down airplane, nose north (rotates to heading)
function drawFlightIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(CX, 3);
  ctx.lineTo(CX + 2, 8);
  ctx.lineTo(CX + 2, 22);
  ctx.lineTo(CX + 3, 27);
  ctx.lineTo(CX - 3, 27);
  ctx.lineTo(CX - 2, 22);
  ctx.lineTo(CX - 2, 8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(CX, 12);
  ctx.lineTo(CX + 13, 18);
  ctx.lineTo(CX + 12, 20);
  ctx.lineTo(CX, 15);
  ctx.lineTo(CX - 12, 20);
  ctx.lineTo(CX - 13, 18);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(CX, 24);
  ctx.lineTo(CX + 6, 28);
  ctx.lineTo(CX + 5, 29);
  ctx.lineTo(CX, 26);
  ctx.lineTo(CX - 5, 29);
  ctx.lineTo(CX - 6, 28);
  ctx.closePath();
  ctx.fill();
}

// geological — earthquake epicenter: concentric seismic rings + solid core
function drawEarthquakeIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(CX, CY, 13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(CX, CY, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(CX, CY, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

// radiation — trefoil hazard
function drawRadiationIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(CX, CY, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(CX, CY, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  const innerR = 3.5;
  const outerR = 10;
  const bladeArc = Math.PI / 3;
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(CX, CY, outerR, angle - bladeArc / 2, angle + bladeArc / 2);
    ctx.arc(CX, CY, innerR, angle + bladeArc / 2, angle - bladeArc / 2, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(CX, CY, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// maritime — top-down vessel: pointed bow (north), wide hull, flat stern (rotates to heading)
function drawShipIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(CX, 3);
  ctx.lineTo(CX + 8, 12);
  ctx.lineTo(CX + 8, 28);
  ctx.lineTo(CX - 8, 28);
  ctx.lineTo(CX - 8, 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(CX, 8);
  ctx.lineTo(CX + 5, 14);
  ctx.lineTo(CX + 5, 26);
  ctx.lineTo(CX - 5, 26);
  ctx.lineTo(CX - 5, 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(CX - 3, 17, 6, 6);
  ctx.beginPath();
  ctx.arc(CX, CY + 4, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

// fallback — filled dot
function drawDefaultIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(CX, CY, 6, 0, Math.PI * 2);
  ctx.fill();
}

export interface MarkerStyle {
  draw: IconDrawFn;
  color: string;
}

const STYLE: Record<string, MarkerStyle> = {
  satellite: { draw: drawSatelliteIcon, color: '#00f3ff' },
  aircraft: { draw: drawFlightIcon, color: '#ffaa00' },
  geological: { draw: drawEarthquakeIcon, color: '#ff0055' },
  radiation: { draw: drawRadiationIcon, color: '#ffcc00' },
  maritime: { draw: drawShipIcon, color: '#4fc3f7' }
};
const FALLBACK: MarkerStyle = { draw: drawDefaultIcon, color: '#9ca3af' };

/** Categories rendered by the layer control, in HUD order. */
export const MARKER_CATEGORIES = Object.keys(STYLE);

/** Pure category → { draw, color } mapping. No DOM — this is what the unit test targets. */
export function styleForCategory(category: string): MarkerStyle {
  return STYLE[category] ?? FALLBACK;
}

/** Category accent color, for HUD legends and chips. */
export function colorForCategory(category: string): string {
  return styleForCategory(category).color;
}

// Rasterize the category silhouette onto a 2x canvas and return a PNG data-URL.
//
// CRITICAL — the billboard image must be a RASTER PNG, never an SVG (svg+xml) data-URI.
// Cesium's texture atlas decodes billboard images with createImageBitmap(), and Chromium's
// createImageBitmap CANNOT decode SVG: it throws
//     InvalidStateError: The source image could not be decoded.
// which stops Cesium's render loop ("An error occurred while rendering. Rendering has
// stopped."). A <canvas> (PNG) decodes cleanly. The color is baked into the pixels, so the
// Cesium billboard uses Color.WHITE and the drawn colors come through unchanged.
function makeMarker(draw: IconDrawFn, color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE * CANVAS_SCALE;
  canvas.height = ICON_SIZE * CANVAS_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return ''; // headless/jsdom has no 2D context; markers are verified visually.
  ctx.scale(CANVAS_SCALE, CANVAS_SCALE);
  draw(ctx, color);
  return canvas.toDataURL('image/png');
}

const cache: Record<string, string> = {};

/** PNG data-URL for a category marker, rasterized once and cached. */
export function markerForCategory(category: string): string {
  if (!cache[category]) {
    const s = styleForCategory(category);
    cache[category] = makeMarker(s.draw, s.color);
  }
  return cache[category];
}

/**
 * Should this entity have a visible billboard, given the HUD filters?
 *
 * `sourcesLoaded` is the load flag for the source LIST, deliberately NOT "is any source
 * enabled". Keying the escape hatch on `enabledSourceIds.length === 0` inverts the control:
 * unchecking the last data source in the layer drawer made every marker reappear instead of
 * clearing the globe. Before `initial_state` arrives nothing is known, so everything draws.
 */
export function isEntityVisible(
  entity: { category: string; source_id: string },
  activeCategory: string | null,
  enabledSourceIds: string[],
  sourcesLoaded: boolean
): boolean {
  if (activeCategory && entity.category !== activeCategory) return false;
  if (!sourcesLoaded) return true;
  return enabledSourceIds.includes(entity.source_id);
}

/** Bearing (radians, clockwise from north) between two lat/lon points — for heading rotation. */
export function bearingRad(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return Math.atan2(y, x);
}
