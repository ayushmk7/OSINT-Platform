// Map legend model: one row per legend LAYER (a source's `layer.id`; several sources may feed
// the same layer), grouped by `layer.group`. Built from the source list, so a new YAML file
// shows up in the legend with no frontend change.
import type { EntityRecord } from '../store/slices/entitiesSlice';
import type { SourceRecord } from '../store/slices/sourcesSlice';
import { MARKER_CATEGORIES, colorForCategory } from './globeMarkers';
import { entityLayerId } from './layerStyle';

/** Legend group order (the backend's `layer.group` enum). Unknown groups sort before Other. */
export const LEGEND_GROUP_ORDER = [
  'Aviation',
  'Maritime',
  'Space',
  'Hazards',
  'Weather',
  'Environment',
  'Conflict',
  'Infrastructure',
  'Cyber',
  'News',
  'Other'
];

/** Legacy category → label/description/group, for sources without a `layer:` block. */
export const LEGACY_LAYERS: Record<string, { name: string; description: string; group: string }> = {
  satellite: { name: 'Satellites', description: 'Orbital tracks', group: 'Space' },
  aircraft: { name: 'Aircraft', description: 'Military ADS-B', group: 'Aviation' },
  geological: { name: 'Geological', description: 'Seismic events', group: 'Hazards' },
  radiation: { name: 'Radiation', description: 'Safecast sensors', group: 'Environment' },
  maritime: { name: 'Maritime', description: 'Vessel positions', group: 'Maritime' },
  atc_zone: { name: 'ATC zones', description: 'Airport control zones', group: 'Aviation' }
};

export interface LegendLayer {
  id: string;
  name: string;
  description: string;
  group: string;
  /** Registry icon key, or null for the legacy category silhouette. */
  icon: string | null;
  color: string;
  count: number;
  sourceIds: string[];
}

export interface LegendGroup {
  name: string;
  layers: LegendLayer[];
  /** Entities across the group's layers. */
  count: number;
}

/** Live entity count per legend layer id. */
export function countByLayer(
  entities: Record<string, EntityRecord>,
  sources: Record<string, SourceRecord>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ent of Object.values(entities)) {
    const id = entityLayerId(ent, sources[ent.source_id]);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

function legacyLayer(id: string): LegendLayer {
  const meta = LEGACY_LAYERS[id];
  return {
    id,
    name: meta?.name ?? id.replace(/_/g, ' '),
    description: meta?.description ?? 'Tracked entities',
    group: meta?.group ?? 'Other',
    icon: null,
    color: colorForCategory(id),
    count: 0,
    sourceIds: []
  };
}

function groupRank(name: string): number {
  const i = LEGEND_GROUP_ORDER.indexOf(name);
  return i === -1 ? LEGEND_GROUP_ORDER.length - 1.5 : i;
}

/**
 * Build the grouped legend. Declared layers come from the sources; any layer that has entities
 * but no declaring source gets a legacy row; and until at least one source declares a layer
 * (older backend, or before `initial_state`), the six legacy categories are listed as before.
 */
export function buildLegend(
  sources: Record<string, SourceRecord>,
  counts: Record<string, number>
): LegendGroup[] {
  const layers = new Map<string, LegendLayer>();

  for (const src of Object.values(sources)) {
    const layer = src.layer;
    if (!layer) continue;
    // Non-geo sources live in the Feed / Indicators panels; a feed only earns a legend row
    // once it has plotted located items.
    if (src.kind === 'indicator') continue;
    if (src.kind === 'feed' && !(counts[layer.id] > 0)) continue;
    let row = layers.get(layer.id);
    if (!row) {
      const display = src.display && src.display.declared !== false ? src.display : null;
      row = {
        id: layer.id,
        name: layer.name || layer.id,
        description: layer.description ?? '',
        group: layer.group || 'Other',
        icon: display ? display.icon : null,
        color: display ? display.color : colorForCategory(layer.id),
        count: 0,
        sourceIds: []
      };
      if (!display && LEGACY_LAYERS[layer.id] && !layer.description) {
        row.description = LEGACY_LAYERS[layer.id].description;
      }
      layers.set(layer.id, row);
    }
    row.sourceIds.push(src.id);
  }

  if (layers.size === 0) {
    for (const cat of MARKER_CATEGORIES) layers.set(cat, legacyLayer(cat));
  }
  for (const id of Object.keys(counts)) {
    if (!layers.has(id)) layers.set(id, legacyLayer(id));
  }
  for (const row of layers.values()) row.count = counts[row.id] ?? 0;

  const groups = new Map<string, LegendGroup>();
  for (const row of layers.values()) {
    let g = groups.get(row.group);
    if (!g) {
      g = { name: row.group, layers: [], count: 0 };
      groups.set(row.group, g);
    }
    g.layers.push(row);
    g.count += row.count;
  }
  for (const g of groups.values()) g.layers.sort((a, b) => a.name.localeCompare(b.name));
  return [...groups.values()].sort(
    (a, b) => groupRank(a.name) - groupRank(b.name) || a.name.localeCompare(b.name)
  );
}

/** Case-insensitive quick filter over layer name / description / id / group. */
export function filterLegend(groups: LegendGroup[], query: string): LegendGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out: LegendGroup[] = [];
  for (const g of groups) {
    const groupHit = g.name.toLowerCase().includes(q);
    const layers = groupHit
      ? g.layers
      : g.layers.filter((l) =>
          [l.name, l.description, l.id].some((s) => s.toLowerCase().includes(q))
        );
    if (layers.length > 0) {
      out.push({ ...g, layers, count: layers.reduce((n, l) => n + l.count, 0) });
    }
  }
  return out;
}
