import type Database from 'better-sqlite3';
import { expressionContext, passesFilter } from '../engine/field-mapper';
import type { SourceConfig } from '../engine/yaml-loader';
import { feedHasCoordinates } from './config';
import { mapFeedItem, mapIndicator, type IndicatorReading } from './mapper';
import { upsertFeedItems, upsertIndicators } from './store';
import { sourceKind, type FeedItem, type Indicator } from './types';

/** At most this many `feed_item` frames per poll (a first poll can find hundreds of items). */
export const MAX_FEED_BROADCAST_PER_POLL = 50;

export interface NonGeoHooks {
  onFeedItem?: (item: FeedItem) => void;
  onIndicator?: (indicator: Indicator) => void;
  /** Ingest the located records of a feed through the regular geo pipeline. */
  ingestGeo?: (records: unknown[]) => number;
}

export interface NonGeoStats {
  written: number;
  skipped: number;
  filtered: number;
}

/**
 * Filter -> map -> store one batch of a `kind: feed` / `kind: indicator` source and announce
 * what changed (new feed items, changed indicators). Located feed items are also handed to
 * `hooks.ingestGeo` so they appear on the globe.
 */
export function ingestNonGeo(
  db: Database.Database,
  config: SourceConfig,
  rawRecords: unknown[],
  hooks: NonGeoHooks = {}
): NonGeoStats {
  const ctx = expressionContext(config);
  const now = new Date().toISOString();
  const kind = sourceKind(config);
  let skipped = 0;
  let filtered = 0;
  const accepted: unknown[] = [];

  if (kind === 'feed') {
    const items: FeedItem[] = [];
    for (const raw of rawRecords) {
      if (!passesFilter(raw, config.filter, ctx)) {
        filtered++;
        continue;
      }
      const item = mapFeedItem(raw, config, now);
      if (!item) {
        skipped++;
        continue;
      }
      items.push(item);
      if (item.latitude !== null) accepted.push(raw);
    }
    const fresh = upsertFeedItems(db, items);
    if (feedHasCoordinates(config) && accepted.length > 0) hooks.ingestGeo?.(accepted);
    if (hooks.onFeedItem) {
      // Oldest first, so clients that prepend end up newest-on-top.
      for (const item of fresh.slice(0, MAX_FEED_BROADCAST_PER_POLL).reverse()) {
        hooks.onFeedItem(item);
      }
    }
    if (skipped > 0)
      console.warn(`Source ${config.name}: skipped ${skipped} item(s) without id/title`);
    return { written: items.length, skipped, filtered };
  }

  const readings: IndicatorReading[] = [];
  for (const raw of rawRecords) {
    if (!passesFilter(raw, config.filter, ctx)) {
      filtered++;
      continue;
    }
    const reading = mapIndicator(raw, config, now);
    if (reading) readings.push(reading);
    else skipped++;
  }
  const changed = upsertIndicators(db, readings);
  if (hooks.onIndicator) for (const indicator of changed) hooks.onIndicator(indicator);
  if (skipped > 0) {
    console.warn(`Source ${config.name}: skipped ${skipped} record(s) without id/label/value`);
  }
  return { written: readings.length, skipped, filtered };
}
