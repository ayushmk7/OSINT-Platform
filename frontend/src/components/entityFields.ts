// Formatting for the data-driven entity card rows (`display.fields` in a source YAML).
import type { SourceDisplayField } from '../store/slices/sourcesSlice';
import { resolveEntityPath } from './layerStyle';

/** "12s ago" / "4m ago" / "3h ago" / "2d ago". */
export function relativeTime(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** ISO string, epoch seconds or epoch milliseconds → ms, or null. */
export function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) return asNum > 1e11 ? asNum : asNum * 1000;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** `2026-09-28 12:00:00Z` */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/** Only http(s) URLs are ever rendered as links (never javascript:, data:, …). */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export interface FormattedField {
  label: string;
  /** Display text ('—' when the value is missing or unusable). */
  text: string;
  /** Set for `link` fields with a safe http(s) URL. */
  href?: string;
  /** Set for `datetime` fields: the absolute UTC stamp shown next to the relative time. */
  utc?: string;
}

const MISSING = '—';

/** Resolve and format one `display.fields` entry against an entity. */
export function formatField(
  entity: object,
  field: SourceDisplayField,
  now: number
): FormattedField {
  const value = resolveEntityPath(entity, field.path);
  const wrap = (text: string) => `${field.prefix ?? ''}${text}${field.suffix ?? ''}`;
  const out: FormattedField = { label: field.label || field.path, text: MISSING };
  if (value === undefined || value === null || value === '') return out;

  switch (field.format) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return { ...out, text: String(value) };
      const p = field.precision;
      out.text = wrap(
        n.toLocaleString('en-US', {
          minimumFractionDigits: p ?? 0,
          maximumFractionDigits: p ?? 3
        })
      );
      return out;
    }
    case 'datetime': {
      const ms = toEpochMs(value);
      if (ms === null) return { ...out, text: String(value) };
      out.text = wrap(relativeTime(new Date(ms).toISOString(), now));
      out.utc = utcStamp(ms);
      return out;
    }
    case 'link': {
      const href = safeHttpUrl(value);
      if (!href) return { ...out, text: String(value) };
      const url = new URL(href);
      out.href = href;
      out.text = wrap(`${url.hostname}${url.pathname === '/' ? '' : url.pathname}`);
      return out;
    }
    case 'bool': {
      const truthy =
        value === true || value === 1 || ['true', 'yes', '1'].includes(String(value).toLowerCase());
      out.text = wrap(truthy ? 'Yes' : 'No');
      return out;
    }
    default:
      out.text = wrap(typeof value === 'object' ? JSON.stringify(value) : String(value));
      return out;
  }
}

/** Top-level metadata keys already shown by `display.fields` (hidden from the raw table). */
export function metadataKeysInFields(fields: SourceDisplayField[] | undefined): Set<string> {
  const keys = new Set<string>();
  for (const f of fields ?? []) {
    const m = /^metadata\.([^.[]+)/.exec(f.path);
    if (m) keys.add(m[1]);
  }
  return keys;
}
