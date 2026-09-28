// Tactical markers drawn directly with Canvas 2D — no icon library.
//
// Design rules (the globe carries ~1200 of these at once, so restraint matters):
//   * Every glyph fits the same ~22px optical box on the 32px grid, so no layer out-weighs another
//     (the old nuclear icon was a solid 28px yellow disk and dominated the whole map).
//   * Thin strokes + small solid cores instead of big filled plates; a glyph reads by its SHAPE.
//   * Contrast on ANY basemap (dark tiles, Blue Marble, relief) comes from a soft dark halo that
//     `makeMarker` applies to every glyph — the draw fns never paint black themselves.
// Rotatable shapes (flight, ship) point north (heading 0) so GlobeView can rotate them.
import { iconDrawFn, type IconDrawFn } from './markerIcons';

const ICON_SIZE = 32; // logical drawing grid (CX = CY = 16)
const CANVAS_SCALE = 2; // render at 2x so billboards stay crisp when Cesium scales them
const CX = ICON_SIZE / 2;
const CY = ICON_SIZE / 2;
const STROKE = 2; // one line weight for every outlined glyph

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// satellite — outlined diamond with a solid core (radar-tracked asset)
function drawSatelliteIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = STROKE;
  ctx.lineJoin = 'miter';
  const R = 9;
  ctx.beginPath();
  ctx.moveTo(CX, CY - R);
  ctx.lineTo(CX + R, CY);
  ctx.lineTo(CX, CY + R);
  ctx.lineTo(CX - R, CY);
  ctx.closePath();
  ctx.stroke();
  dot(ctx, CX, CY, 2.5);
}

// aircraft — slim top-down airplane, nose north (rotates to heading)
function drawFlightIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath(); // fuselage
  ctx.moveTo(CX, 4);
  ctx.quadraticCurveTo(CX + 1.8, 5.5, CX + 1.6, 9);
  ctx.lineTo(CX + 1.4, 22);
  ctx.lineTo(CX, 26);
  ctx.lineTo(CX - 1.4, 22);
  ctx.lineTo(CX - 1.6, 9);
  ctx.quadraticCurveTo(CX - 1.8, 5.5, CX, 4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); // swept main wing
  ctx.moveTo(CX, 11);
  ctx.lineTo(CX + 11, 17.5);
  ctx.lineTo(CX + 11, 19);
  ctx.lineTo(CX, 15.5);
  ctx.lineTo(CX - 11, 19);
  ctx.lineTo(CX - 11, 17.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); // tailplane
  ctx.moveTo(CX, 22);
  ctx.lineTo(CX + 4.5, 25.5);
  ctx.lineTo(CX + 4.5, 26.5);
  ctx.lineTo(CX, 25);
  ctx.lineTo(CX - 4.5, 26.5);
  ctx.lineTo(CX - 4.5, 25.5);
  ctx.closePath();
  ctx.fill();
}

// geological — earthquake epicenter: two thin seismic rings + solid core
function drawEarthquakeIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(CX, CY, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(CX, CY, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  dot(ctx, CX, CY, 2.75);
}

// radiation — bare trefoil (three blades + hub), no backing disk
function drawRadiationIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  const innerR = 3.2;
  const outerR = 9.5;
  const bladeArc = Math.PI / 3;
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(CX, CY, outerR, angle - bladeArc / 2, angle + bladeArc / 2);
    ctx.arc(CX, CY, innerR, angle + bladeArc / 2, angle - bladeArc / 2, true);
    ctx.closePath();
    ctx.fill();
  }
  dot(ctx, CX, CY, 1.8);
}

// maritime — outlined top-down hull: pointed bow (north), flat stern (rotates to heading)
function drawShipIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = STROKE;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(CX, 5);
  ctx.quadraticCurveTo(CX + 6, 10, CX + 6, 15);
  ctx.lineTo(CX + 6, 26);
  ctx.lineTo(CX - 6, 26);
  ctx.lineTo(CX - 6, 15);
  ctx.quadraticCurveTo(CX - 6, 10, CX, 5);
  ctx.closePath();
  ctx.stroke();
  ctx.fillRect(CX - 2.5, 16, 5, 5); // bridge
}

// atc_zone — airport control tower: mast, flared glazed cab, slim shaft, base.
// Marks the CENTRE of the control-zone circle drawn by GlobeView, and is what the user clicks.
function drawATCTowerIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(CX - 0.6, 4, 1.2, 5); // antenna mast
  ctx.beginPath(); // cab, wider at the top than the shaft
  ctx.moveTo(CX - 6, 9);
  ctx.lineTo(CX + 6, 9);
  ctx.lineTo(CX + 4, 14);
  ctx.lineTo(CX - 4, 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(CX - 1.75, 14, 3.5, 10); // shaft
  ctx.fillRect(CX - 6, 24, 12, 2); // base
}

// fallback — filled dot
function drawDefaultIcon(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  dot(ctx, CX, CY, 5);
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
  maritime: { draw: drawShipIcon, color: '#4fc3f7' },
  // violet — the one unclaimed slot in the tactical palette (cyan / amber / red / yellow /
  // light-blue are taken), and far enough from the neutral fallback grey to read as a real layer.
  atc_zone: { draw: drawATCTowerIcon, color: '#b388ff' }
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
  // Soft dark halo behind every glyph: keeps a thin bright line legible over pale imagery
  // (Blue Marble deserts, relief) without the heavy black plates the old icons used.
  // shadowBlur is in device pixels (unaffected by ctx.scale).
  ctx.shadowColor = HALO_COLOR;
  ctx.shadowBlur = 2.5 * CANVAS_SCALE;
  draw(ctx, color);
  return canvas.toDataURL('image/png');
}

const HALO_COLOR = 'rgba(0, 0, 0, 0.85)';

/** Colour of the selection ring drawn around the selected marker. */
export const SELECTION_RING_COLOR = '#ffffff';

// selection ring — thin bright circle with four tick marks, drawn around the selected marker.
function drawSelectionRing(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(CX, CY, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * 12, CY + Math.sin(a) * 12);
    ctx.lineTo(CX + Math.cos(a) * 15.5, CY + Math.sin(a) * 15.5);
    ctx.stroke();
  }
}

let ringCache: string | null = null;

/** PNG data-URL for the selection ring (same 32px grid as the markers), rasterized once. */
export function selectionRingMarker(): string {
  if (ringCache === null) ringCache = makeMarker(drawSelectionRing, SELECTION_RING_COLOR);
  return ringCache;
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

const iconCache = new Map<string, string>();

/**
 * PNG data-URL for a data-driven `display.icon` in a given colour, rasterized once per
 * (icon, colour) pair. Unknown icon keys draw the default dot. Callers keep the number of
 * distinct colours bounded (see `layerStyle.quantizedColor`), so the cache stays small.
 */
export function markerForIcon(icon: string, color: string): string {
  const key = `${icon}|${color}`;
  let url = iconCache.get(key);
  if (url === undefined) {
    url = makeMarker(iconDrawFn(icon), color);
    iconCache.set(key, url);
  }
  return url;
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
  sourcesLoaded: boolean,
  /** The entity's legend layer (source `layer.id`); defaults to its category. */
  layerId: string = entity.category
): boolean {
  if (activeCategory && layerId !== activeCategory) return false;
  if (!sourcesLoaded) return true;
  return enabledSourceIds.includes(entity.source_id);
}

/** The one category drawn as ground geometry (a circle) as well as a billboard. */
export const ATC_ZONE_CATEGORY = 'atc_zone';

/** Radius used when an ATC facility carries no usable `radius_km`, in km. */
export const DEFAULT_ZONE_RADIUS_KM = 5;

/**
 * `radius_km` metadata → ellipse radius in METRES for Cesium.
 *
 * The value arrives from a JSON metadata blob, so it may be a number, a numeric string, or
 * missing entirely; anything unusable falls back to the medium-airport radius rather than
 * producing a zero-size (invisible) or NaN (crashing) ellipse.
 *
 * NOTE: these circles are an illustrative stand-in sized by airport class — they are NOT real
 * airspace boundaries (see `zone_note` in the metadata).
 */
export function zoneRadiusMeters(radiusKm: unknown): number {
  const km = typeof radiusKm === 'number' ? radiusKm : Number(radiusKm);
  return (Number.isFinite(km) && km > 0 ? km : DEFAULT_ZONE_RADIUS_KM) * 1000;
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

/**
 * Height (metres) at which to DRAW an entity's billboard.
 *
 * Earthquakes carry their hypocentre depth as a negative altitude. Drawn there, the marker sits
 * inside the opaque globe and is swallowed by it, so rendering clamps to just above the surface.
 * Only the render position is clamped — the stored entity keeps its real depth.
 */
export const SURFACE_OFFSET_M = 10;
export function renderHeight(altitude: number | null | undefined): number {
  const h = typeof altitude === 'number' && Number.isFinite(altitude) ? altitude : 0;
  return Math.max(h, 0) + SURFACE_OFFSET_M;
}
