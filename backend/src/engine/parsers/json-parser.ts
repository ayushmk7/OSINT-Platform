import { IParser, ParserOptions, getNestedProperty, toRecordArray } from './types';

/**
 * Standard JSON payloads. `recordsPath` is a dot-notation path to the record array
 * (e.g. `ac`, `data.items`). Without one, a top-level array is used as-is and a
 * top-level object is treated as a single record (e.g. the ISS position endpoint).
 * `object_to_records` / `array_columns` reshape keyed maps and array-of-array tables.
 */
export const jsonParser: IParser = {
  parse(content: string, recordsPath?: string, _max?: number, options?: ParserOptions) {
    const parsed = JSON.parse(content);
    return reshapeJson(getNestedProperty(parsed, recordsPath), options);
  }
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Apply `object_to_records`, then `array_columns`, to the node found at records_path. */
export function reshapeJson(target: unknown, options?: ParserOptions): unknown[] {
  if (options?.object_to_records && isPlainObject(target)) {
    const keyField = options.key_field || '_key';
    target = Object.entries(target).map(([key, value]) =>
      isPlainObject(value) ? { ...value, [keyField]: key } : { [keyField]: key, value }
    );
  }

  let records = toRecordArray(target);

  const spec = options?.array_columns;
  if (spec !== undefined) {
    let columns: string[] = [];
    if (spec === 'header') {
      const first = records[0];
      columns = Array.isArray(first) ? first.map((c) => String(c)) : [];
      records = records.slice(1);
    } else if (Array.isArray(spec)) {
      columns = spec.map((c) => String(c));
    }
    records = records.map((row) => {
      if (!Array.isArray(row)) return row;
      const out: Record<string, unknown> = {};
      row.forEach((value, i) => {
        out[columns[i] ? columns[i] : `c${i}`] = value;
      });
      return out;
    });
  }
  return records;
}
