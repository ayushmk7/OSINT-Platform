export interface IParser {
  parse(content: string, recordsPath?: string, maxRecords?: number): unknown[];
}

export type SupportedFormat = 'json' | 'geojson' | 'xml' | 'csv';

/** Walk a dot-notation path (`a.b.c`). An empty path returns the object itself. */
export function getNestedProperty(obj: unknown, pathStr?: string): unknown {
  if (!pathStr || obj == null) return obj;
  const parts = pathStr.split('.');
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr == null || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

/** Normalize a resolved node into a record array: array stays, object is wrapped, else empty. */
export function toRecordArray(target: unknown): unknown[] {
  if (Array.isArray(target)) return target;
  if (target && typeof target === 'object') return [target];
  return [];
}
