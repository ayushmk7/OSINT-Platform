// Data-driven marker styling: joins an entity to its source's `display` block (via
// `entity.source_id`) and resolves icon, colour (incl. `color_by`), scale, rotation and ttl.
// Pure functions only — GlobeView, the legend and the inspector all share them.
import type { EntityRecord } from '../store/slices/entitiesSlice';
import type { SourceColorBy, SourceRecord } from '../store/slices/sourcesSlice';
import { bearingRad, colorForCategory } from './globeMarkers';

/** Categories whose legacy silhouette has a nose and rotates to heading. */
const LEGACY_ROTATING = new Set(['aircraft', 'maritime']);

/**
 * Interpolated colours are snapped to this many steps between neighbouring stops, so a
 * continuous field (altitude, magnitude…) produces a bounded set of rasterized markers.
 */
export const COLOR_STEPS_PER_STOP = 8;

/** Resolve `metadata.mag`, `altitude`, `metadata.a[0].b` … against an entity. */
export function resolveEntityPath(entity: object, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur: unknown = entity;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Piecewise-linear colour ramp over ascending `[value, colour]` stops, clamped at both ends and
 * quantized to `steps` per segment.
 */
export function interpolateStops(
  value: number,
  stops: Array<[number, string]>,
  steps = COLOR_STEPS_PER_STOP
): string {
  if (stops.length === 0) return '#000000';
  if (value <= stops[0][0]) return stops[0][1].toLowerCase();
  const last = stops[stops.length - 1];
  if (value >= last[0]) return last[1].toLowerCase();
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (value > v1) continue;
    const [v0, c0] = stops[i - 1];
    const a = parseHexColor(c0);
    const b = parseHexColor(c1);
    if (!a || !b) return c1.toLowerCase();
    const t = Math.round(((value - v0) / (v1 - v0)) * steps) / steps;
    return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return last[1].toLowerCase();
}

/** `color_by` → colour for one entity, falling back to `default`, then the base colour. */
export function colorForEntity(entity: object, colorBy: SourceColorBy | undefined, base: string) {
  if (!colorBy) return base;
  const fallback = colorBy.default ?? base;
  const raw = resolveEntityPath(entity, colorBy.field);
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (colorBy.stops && colorBy.stops.length > 0) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? interpolateStops(n, colorBy.stops) : fallback;
  }
  if (colorBy.map) return colorBy.map[String(raw)] ?? fallback;
  return fallback;
}

export interface ResolvedMarkerStyle {
  /** Registry icon key; null = draw the legacy category silhouette. */
  icon: string | null;
  color: string;
  /** Multiplier on the base billboard scale. */
  size: number;
  rotate: boolean;
}

function declared(source: SourceRecord | undefined): boolean {
  return Boolean(source?.display && source.display.declared !== false);
}

/** Style for an entity: its source's declared `display`, else the legacy category style. */
export function resolveEntityStyle(
  entity: EntityRecord,
  source: SourceRecord | undefined
): ResolvedMarkerStyle {
  if (source?.display && declared(source)) {
    const d = source.display;
    return {
      icon: d.icon || 'dot',
      color: colorForEntity(entity, d.color_by, d.color),
      size: typeof d.size === 'number' && d.size > 0 ? d.size : 1,
      rotate: d.rotate === true
    };
  }
  return {
    icon: null,
    color: colorForCategory(entity.category),
    size: 1,
    rotate: LEGACY_ROTATING.has(entity.category)
  };
}

/** Legend layer the entity belongs to: its source's `layer.id`, else its category. */
export function entityLayerId(
  entity: Pick<EntityRecord, 'category'>,
  source: SourceRecord | undefined
): string {
  return source?.layer?.id ?? entity.category;
}

/** True once an entity has not been updated within its source's ttl. */
export function isExpired(
  entity: Pick<EntityRecord, 'timestamp'>,
  source: SourceRecord | undefined,
  now: number
): boolean {
  const ttl = source?.display?.ttl_seconds;
  if (!ttl || ttl <= 0) return false;
  const t = Date.parse(entity.timestamp);
  return Number.isFinite(t) && now - t > ttl * 1000;
}

/**
 * Heading in radians (clockwise from north) to rotate a marker by: the reported heading when
 * there is one, else the bearing between the last two distinct trail points, else null.
 */
export function entityHeadingRad(entity: EntityRecord): number | null {
  if (typeof entity.heading === 'number' && Number.isFinite(entity.heading) && entity.heading) {
    return (entity.heading * Math.PI) / 180;
  }
  const trail = entity.trail;
  if (trail && trail.length >= 2) {
    const a = trail[trail.length - 2];
    const b = trail[trail.length - 1];
    if (a.latitude !== b.latitude || a.longitude !== b.longitude) {
      return bearingRad(a.latitude, a.longitude, b.latitude, b.longitude);
    }
  }
  return null;
}
