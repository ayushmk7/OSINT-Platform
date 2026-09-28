export interface IParser {
  parse(
    content: string,
    recordsPath?: string,
    maxRecords?: number,
    options?: ParserOptions
  ): unknown[];
}

export type SupportedFormat = 'json' | 'geojson' | 'xml' | 'csv' | 'rss' | 'tle' | 'omm_json';

/** Options under `parser.csv`. Absent = header row, auto-detected delimiter. */
export interface CsvOptions {
  /** A literal delimiter (',', ';', '\t', '|', ...) or 'whitespace' (runs of spaces/tabs). */
  delimiter?: string;
  /** false = no header row; columns come from `columns` or are named c0..cN. Default true. */
  has_header?: boolean;
  /** Explicit column names (override the header row when there is one). */
  columns?: string[];
  /** Number of leading lines to drop before parsing (preambles, banners). */
  skip_lines?: number;
  /** Lines starting with this prefix (after leading whitespace) are ignored, e.g. '#'. */
  comment_prefix?: string;
}

/** Format-specific reshaping options read from the source's `parser:` block. */
export interface ParserOptions {
  csv?: CsvOptions;
  /** JSON: turn an object map `{k: {...}}` at records_path into records. */
  object_to_records?: boolean;
  /** Field that receives the map key with `object_to_records`. Default `_key`. */
  key_field?: string;
  /** JSON: rows that are arrays become objects with these keys; 'header' = first row. */
  array_columns?: string[] | 'header';
}

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
