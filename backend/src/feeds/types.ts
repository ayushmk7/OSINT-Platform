/**
 * Non-geo source kinds (`kind: feed` / `kind: indicator`). A geo source maps each record to an
 * entity + observation; a feed maps it to a news/advisory item, an indicator to a scalar reading.
 */
export const SOURCE_KINDS = ['geo', 'feed', 'indicator'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** YAML `feed:` block. Every value is a path or an `=expr`. */
export interface FeedBlock {
  id: string;
  title: string;
  url?: string;
  summary?: string;
  published?: string;
  tags?: string;
  severity?: string;
  /** When both resolve to numbers the item is also plotted as an entity on the source layer. */
  latitude?: string;
  longitude?: string;
}

/** YAML `indicator:` block. `unit` is a literal unless it starts with `=`. */
export interface IndicatorBlock {
  id: string;
  label: string;
  value: string;
  unit?: string;
  change?: string;
  severity?: string;
  /** Reading time; several records with the same id become history points in time order. */
  timestamp?: string;
}

/** One stored feed item (REST `GET /api/feed`, WS `feed_item`). */
export interface FeedItem {
  /** `<source_id>:<item id>`, unique across sources. */
  id: string;
  source_id: string;
  item_id: string;
  title: string;
  url: string | null;
  summary: string | null;
  /** ISO-8601; falls back to the time the item was first seen. */
  published: string;
  tags: string[];
  severity: Severity;
  latitude: number | null;
  longitude: number | null;
  /** Entity id on the globe when the item has coordinates. */
  entity_id: string | null;
  first_seen: string;
}

export interface IndicatorPoint {
  t: string;
  v: number;
}

/** One indicator's latest reading plus a short history (REST `GET /api/indicators`, WS `indicator_update`). */
export interface Indicator {
  /** `<source_id>:<indicator id>`. */
  id: string;
  source_id: string;
  indicator_id: string;
  label: string;
  value: number;
  unit: string | null;
  change: number | null;
  severity: Severity;
  updated_at: string;
  history: IndicatorPoint[];
}

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

/** Kind of a (possibly raw) config; absent means `geo`. */
export function sourceKind(config: { kind?: unknown }): SourceKind {
  return config.kind === 'feed' || config.kind === 'indicator' ? config.kind : 'geo';
}
