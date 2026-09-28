import { expressionContext, resolveValue } from '../engine/field-mapper';
import type { ExpressionContext } from '../engine/expressions';
import {
  isSeverity,
  type FeedBlock,
  type FeedItem,
  type IndicatorBlock,
  type Severity
} from './types';

/** Longest summary kept per feed item (after HTML is stripped). */
export const MAX_SUMMARY_CHARS = 600;
export const MAX_TITLE_CHARS = 300;
export const MAX_TAGS = 12;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“'
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Plain text from a possibly-HTML value: tags stripped, entities decoded, whitespace collapsed. */
export function cleanText(value: unknown, maxChars: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return null;
  const text = decodeEntities(
    String(value)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

/** Only absolute http(s) links reach clients: a feed can never inject a `javascript:` URL. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Epoch s/ms or a parseable date string to ISO-8601; null when unusable. */
export function toIso(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  let ms: number;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) {
    const n = Number(value);
    ms = n > 1e11 ? n : n * 1000;
  } else {
    ms = Date.parse(String(value));
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function severityOf(value: unknown): Severity {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : value;
  return isSeverity(s) ? s : 'info';
}

function tagsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: string[] = [];
  for (const v of list) {
    const t = cleanText(v, 60);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function idOf(value: unknown): string | null {
  if (value === undefined || value === null || typeof value === 'object') return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

interface MappableConfig {
  name: string;
  lookups?: Record<string, unknown> | Record<string, Record<string, unknown> | string>;
  feed?: FeedBlock;
  indicator?: IndicatorBlock;
}

function ctxOf(config: MappableConfig): ExpressionContext {
  return expressionContext(config as Parameters<typeof expressionContext>[0]);
}

/**
 * Map one raw record to a feed item, or null when it has no id or no title. `now` is the
 * fallback publish time (and the first-seen time) for items without a usable date.
 */
export function mapFeedItem(
  raw: unknown,
  config: MappableConfig,
  now: string = new Date().toISOString()
): FeedItem | null {
  const f = config.feed;
  if (!f) return null;
  const ctx = ctxOf(config);
  const get = (expr?: string): unknown => (expr ? resolveValue(raw, expr, ctx) : undefined);

  const itemId = idOf(get(f.id));
  const title = cleanText(get(f.title), MAX_TITLE_CHARS);
  if (!itemId || !title) return null;

  let latitude = finite(get(f.latitude));
  let longitude = finite(get(f.longitude));
  if (
    latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    latitude = null;
    longitude = null;
  }
  const id = `${config.name}:${itemId}`;
  return {
    id,
    source_id: config.name,
    item_id: itemId,
    title,
    url: safeUrl(get(f.url)),
    summary: cleanText(get(f.summary), MAX_SUMMARY_CHARS),
    published: toIso(get(f.published)) ?? now,
    tags: tagsOf(get(f.tags)),
    severity: severityOf(get(f.severity)),
    latitude,
    longitude,
    // Same id the geo pipeline gives the item's entity (`<source>:<external id>`).
    entity_id: latitude !== null ? id : null,
    first_seen: now
  };
}

/** One indicator reading, before it is merged into the stored history. */
export interface IndicatorReading {
  id: string;
  source_id: string;
  indicator_id: string;
  label: string;
  value: number;
  unit: string | null;
  change: number | null;
  severity: Severity;
  timestamp: string;
  /** False when the source gave no reading time (then every poll is a new point). */
  timed: boolean;
}

/** Map one raw record to an indicator reading, or null when id/label/value do not resolve. */
export function mapIndicator(
  raw: unknown,
  config: MappableConfig,
  now: string = new Date().toISOString()
): IndicatorReading | null {
  const b = config.indicator;
  if (!b) return null;
  const ctx = ctxOf(config);
  const get = (expr?: string): unknown => (expr ? resolveValue(raw, expr, ctx) : undefined);

  const indicatorId = idOf(get(b.id));
  const label = cleanText(get(b.label), 120);
  const value = finite(get(b.value));
  if (!indicatorId || !label || value === null) return null;

  const unit =
    b.unit === undefined
      ? null
      : b.unit.startsWith('=')
        ? cleanText(get(b.unit), 24)
        : b.unit.slice(0, 24);
  const timestamp = toIso(get(b.timestamp));
  // `severity` / `change` may refer to the mapped reading as `value` (unless the record has
  // its own `value` field), e.g. `severity: '=value >= 5 ? "high" : "info"'`.
  const scoped =
    raw && typeof raw === 'object' && !Array.isArray(raw) && !Object.hasOwn(raw, 'value')
      ? { ...(raw as Record<string, unknown>), value }
      : raw;
  const getScoped = (expr?: string): unknown =>
    expr ? resolveValue(scoped, expr, ctx) : undefined;
  return {
    id: `${config.name}:${indicatorId}`,
    source_id: config.name,
    indicator_id: indicatorId,
    label,
    value,
    unit,
    change: finite(getScoped(b.change)),
    severity: severityOf(getScoped(b.severity)),
    timestamp: timestamp ?? now,
    timed: timestamp !== null
  };
}
