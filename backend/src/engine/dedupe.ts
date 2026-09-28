import crypto from 'crypto';
import { ExpressionContext, evaluateExpression, isExpression } from './expressions';

/** Stable JSON: object keys sorted recursively so the hash ignores key order. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readPath(obj: unknown, pathStr: string): unknown {
  const parts = pathStr.replace(/\[(\d+)\]/g, '.$1').split('.');
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr == null || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

/**
 * Content identity for `recording.mode: dedupe`.
 *  - With `dedupe_fields`: sha256 of those values read from the RAW record (paths or `=expr`).
 *  - Without: sha256 of the whole mapped entity (`fallback`), which the caller builds without
 *    ingest-time values so that re-polling an unchanged record yields the same hash.
 */
export function computeDedupeKey(
  raw: unknown,
  fields: string[] | undefined,
  fallback: unknown,
  ctx?: ExpressionContext
): string {
  if (fields && fields.length > 0) {
    const values = fields.map((f) =>
      isExpression(f) ? evaluateExpression(f.slice(1), raw, ctx) : readPath(raw, f)
    );
    return sha256(stableStringify(values));
  }
  return sha256(stableStringify(fallback));
}
