import * as Cesium from 'cesium';
import type { EntityRecord, TrailPoint } from '../store/slices/entitiesSlice';
import type { SourceRecord } from '../store/slices/sourcesSlice';
import { renderHeight } from './globeMarkers';

/** Fade buckets per trail: older buckets are drawn more transparent. */
export const TRAIL_BUCKETS = 4;
export const TRAIL_MIN_ALPHA = 0.12;
export const TRAIL_MAX_ALPHA = 0.85;
export const TRAIL_WIDTH = 2;

/** `display.trail.max_points` for every source that has trails enabled. */
export function trailLimitsFromSources(
  sources: Record<string, SourceRecord>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const src of Object.values(sources)) {
    const trail = src.display?.trail;
    if (trail?.enabled && trail.max_points > 1) out[src.id] = Math.floor(trail.max_points);
  }
  return out;
}

export interface TrailSegment {
  /** Inclusive index range into the trail; neighbouring segments share their boundary point. */
  from: number;
  to: number;
  alpha: number;
}

/**
 * Split a trail of `count` points into up to TRAIL_BUCKETS contiguous segments, oldest first,
 * with alpha rising linearly towards the newest. Cesium's PolylineCollection colours a whole
 * polyline, so a fading trail is drawn as a few segments. Empty for fewer than two points.
 */
export function trailSegments(count: number, buckets: number = TRAIL_BUCKETS): TrailSegment[] {
  if (count < 2) return [];
  const edges = count - 1;
  const n = Math.max(1, Math.min(buckets, edges));
  const out: TrailSegment[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * edges) / n);
    const to = Math.floor(((i + 1) * edges) / n);
    const alpha =
      n === 1
        ? TRAIL_MAX_ALPHA
        : TRAIL_MIN_ALPHA + ((TRAIL_MAX_ALPHA - TRAIL_MIN_ALPHA) * i) / (n - 1);
    out.push({ from, to, alpha });
  }
  return out;
}

/** Changes whenever the drawn trail would change (new point, colour change). */
export function trailKey(trail: TrailPoint[], color: string): string {
  const last = trail[trail.length - 1];
  return last ? `${trail.length}|${last.latitude}|${last.longitude}|${color}` : '';
}

interface DrawnTrail {
  key: string;
  lines: Cesium.Polyline[];
}

/**
 * Fading polylines for entities of trail-enabled sources, in ONE PolylineCollection. `sync`
 * rebuilds only trails whose key changed, hides trails of filtered-out entities and frees
 * trails of entities that left the store.
 */
export class TrailLayer {
  private readonly collection: Cesium.PolylineCollection;
  private readonly drawn = new Map<string, DrawnTrail>();

  constructor(scene: Cesium.Scene) {
    this.collection = scene.primitives.add(new Cesium.PolylineCollection());
  }

  sync(
    entities: Record<string, EntityRecord>,
    sources: Record<string, SourceRecord>,
    visibleIds: Set<string>,
    colorOf: (entity: EntityRecord) => string
  ): void {
    const seen = new Set<string>();
    for (const id of visibleIds) {
      const entity = entities[id];
      if (!entity) continue;
      if (!sources[entity.source_id]?.display?.trail?.enabled) continue;
      const trail = entity.trail ?? [];
      if (trail.length < 2) continue;
      seen.add(id);
      const color = colorOf(entity);
      const key = trailKey(trail, color);
      const existing = this.drawn.get(id);
      if (existing && existing.key === key) {
        for (const line of existing.lines) line.show = true;
        continue;
      }
      if (existing) this.remove(existing);
      this.drawn.set(id, { key, lines: this.build(trail, color) });
    }
    for (const [id, drawn] of this.drawn) {
      if (seen.has(id)) continue;
      if (entities[id]) {
        for (const line of drawn.lines) line.show = false;
      } else {
        this.remove(drawn);
        this.drawn.delete(id);
      }
    }
  }

  private build(trail: TrailPoint[], color: string): Cesium.Polyline[] {
    const positions = trail.map((p) =>
      Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, renderHeight(p.altitude))
    );
    const base = Cesium.Color.fromCssColorString(color);
    return trailSegments(positions.length).map((seg) =>
      this.collection.add({
        positions: positions.slice(seg.from, seg.to + 1),
        width: TRAIL_WIDTH,
        material: Cesium.Material.fromType('Color', { color: base.withAlpha(seg.alpha) })
      })
    );
  }

  private remove(drawn: DrawnTrail): void {
    for (const line of drawn.lines) this.collection.remove(line);
  }

  destroy(): void {
    this.drawn.clear();
    // The collection is destroyed with the viewer's primitives.
  }
}
