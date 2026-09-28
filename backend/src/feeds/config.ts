import { expressionError, isExpression } from '../engine/expressions';
import { SOURCE_KINDS, sourceKind, type FeedBlock, type IndicatorBlock } from './types';

const FEED_KEYS = [
  'id',
  'title',
  'url',
  'summary',
  'published',
  'tags',
  'severity',
  'latitude',
  'longitude'
] as const;
const INDICATOR_KEYS = ['id', 'label', 'value', 'unit', 'change', 'severity', 'timestamp'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function checkBlock(
  block: unknown,
  name: 'feed' | 'indicator',
  keys: readonly string[],
  required: readonly string[]
): string[] {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return [`kind: ${name} needs a "${name}:" mapping`];
  }
  const errors: string[] = [];
  const b = block as Record<string, unknown>;
  for (const key of required) {
    if (!isNonEmptyString(b[key])) errors.push(`missing or empty required field "${name}.${key}"`);
  }
  for (const [key, value] of Object.entries(b)) {
    if (!keys.includes(key)) {
      errors.push(`unknown field "${name}.${key}" (expected one of: ${keys.join(', ')})`);
      continue;
    }
    if (typeof value !== 'string') {
      errors.push(`${name}.${key} must be a string (a path or an =expression)`);
      continue;
    }
    if (isExpression(value)) {
      const err = expressionError(value.slice(1));
      if (err) errors.push(`invalid expression in ${name}.${key}: ${err}`);
    }
  }
  if (name === 'feed' && (b.latitude === undefined) !== (b.longitude === undefined)) {
    errors.push('feed.latitude and feed.longitude must be given together');
  }
  return errors;
}

/**
 * Validation for the top-level `kind:` and its `feed:` / `indicator:` block. A `geo` source
 * (the default) is validated by the loader as before; feed/indicator sources do not need the
 * `entity:` / `observation:` sections.
 */
export function validateKindBlocks(c: Record<string, unknown>): string[] {
  if (c.kind !== undefined && !(SOURCE_KINDS as readonly unknown[]).includes(c.kind)) {
    return [`invalid kind ${JSON.stringify(c.kind)} (expected one of: ${SOURCE_KINDS.join(', ')})`];
  }
  const kind = sourceKind(c);
  if (kind === 'feed') return checkBlock(c.feed, 'feed', FEED_KEYS, ['id', 'title']);
  if (kind === 'indicator') {
    return checkBlock(c.indicator, 'indicator', INDICATOR_KEYS, ['id', 'label', 'value']);
  }
  return [];
}

/** Minimal shape of the loader's config that this module fills in. */
interface KindConfig {
  kind?: unknown;
  feed?: FeedBlock;
  indicator?: IndicatorBlock;
  entity?: { external_id: string; name: string; metadata?: Record<string, string> };
  observation?: {
    latitude: string;
    longitude: string;
    timestamp?: string;
    optional?: boolean;
  };
  recording?: { mode?: string };
}

/**
 * Give a feed/indicator source the `entity:` / `observation:` sections the geo pipeline
 * expects. A feed item whose `feed.latitude/longitude` resolve is ingested through that same
 * geo pipeline (one entity per item, upserted), so it shows on the globe under the source's
 * layer. Explicit `entity:` / `observation:` blocks in the YAML win.
 */
export function applyKindDefaults(config: KindConfig): void {
  const kind = sourceKind(config);
  if (kind === 'feed' && config.feed) {
    const f = config.feed;
    const metadata: Record<string, string> = {};
    for (const key of ['url', 'published', 'severity'] as const) {
      if (f[key] !== undefined) metadata[key] = f[key] as string;
    }
    config.entity ??= { external_id: f.id, name: f.title, metadata };
    config.observation ??= {
      latitude: f.latitude ?? '=null',
      longitude: f.longitude ?? '=null',
      timestamp: f.published,
      optional: true
    };
  } else if (kind === 'indicator' && config.indicator) {
    config.entity ??= { external_id: config.indicator.id, name: config.indicator.label };
    config.observation ??= { latitude: '=null', longitude: '=null', optional: true };
  } else {
    return;
  }
  config.recording ??= { mode: 'upsert' };
}

/** True when a feed source also plots its located items on the globe. */
export function feedHasCoordinates(config: KindConfig): boolean {
  return sourceKind(config) === 'feed' && !!config.feed?.latitude && !!config.feed?.longitude;
}
