import type { EntityRecord } from '../store/slices/entitiesSlice';
import type { FeedItemRecord } from '../store/slices/feedSlice';
import type { SourceRecord } from '../store/slices/sourcesSlice';

export interface SearchResult {
  kind: 'entity' | 'feed';
  /** Entity id or feed item id. */
  id: string;
  title: string;
  subtitle: string;
  /** Registry icon key (null: legacy category glyph for `category`). */
  icon: string | null;
  category: string;
  color?: string;
  /** Globe target, when there is one. */
  entityId: string | null;
  latitude: number | null;
  longitude: number | null;
  url: string | null;
  score: number;
}

export const MAX_SEARCH_RESULTS = 12;

/** Primitive metadata values joined into one lowercase string (objects are skipped). */
function metadataText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return '';
  const parts: string[] = [];
  for (const v of Object.values(metadata)) {
    if (typeof v === 'string' || typeof v === 'number') parts.push(String(v));
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Score a candidate: every query token must appear somewhere; a name that starts with the
 * query ranks highest, then a name containing it, then id/metadata-only matches.
 */
function score(tokens: string[], query: string, name: string, rest: string): number {
  const n = name.toLowerCase();
  for (const t of tokens) if (!n.includes(t) && !rest.includes(t)) return 0;
  if (n === query) return 100;
  if (n.startsWith(query)) return 80;
  if (n.includes(query)) return 60;
  if (tokens.every((t) => n.includes(t))) return 40;
  return 20;
}

/**
 * Search loaded entities (name, id, metadata values) and feed items (title, source, tags).
 * Entities rank before feed items at equal score; ties sort by name. Needs >= 2 characters.
 */
export function searchAll(
  rawQuery: string,
  entities: Record<string, EntityRecord>,
  sources: Record<string, SourceRecord>,
  feed: FeedItemRecord[],
  limit: number = MAX_SEARCH_RESULTS
): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return [];
  const tokens = query.split(/\s+/).filter(Boolean);
  const out: SearchResult[] = [];

  for (const e of Object.values(entities)) {
    const s = score(
      tokens,
      query,
      e.name ?? '',
      `${e.id.toLowerCase()} ${metadataText(e.metadata)}`
    );
    if (s === 0) continue;
    const src = sources[e.source_id];
    const declared = src?.display && src.display.declared !== false;
    out.push({
      kind: 'entity',
      id: e.id,
      title: e.name || e.id,
      subtitle: `${src?.layer?.name ?? e.category.replace(/_/g, ' ')} · ${e.id}`,
      icon: declared ? (src?.display?.icon ?? null) : null,
      category: e.category,
      color: declared ? src?.display?.color : undefined,
      entityId: e.id,
      latitude: e.latitude,
      longitude: e.longitude,
      url: null,
      score: s + 1 // entities first at equal score
    });
  }

  for (const f of feed) {
    const src = sources[f.source_id];
    const sourceName = src?.name ?? f.source_id;
    const s = score(tokens, query, f.title, `${sourceName} ${f.tags.join(' ')}`.toLowerCase());
    if (s === 0) continue;
    out.push({
      kind: 'feed',
      id: f.id,
      title: f.title,
      subtitle: sourceName,
      icon: src?.display?.icon ?? 'news',
      category: src?.layer?.id ?? 'news',
      color: src?.display?.color,
      entityId: f.entity_id,
      latitude: f.latitude,
      longitude: f.longitude,
      url: f.url,
      score: s
    });
  }

  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
