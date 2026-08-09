import { IParser, getNestedProperty, toRecordArray } from './types';

/**
 * Standard JSON payloads. `recordsPath` is a dot-notation path to the record array
 * (e.g. `ac`, `data.items`). Without one, a top-level array is used as-is and a
 * top-level object is treated as a single record (e.g. the ISS position endpoint).
 */
export const jsonParser: IParser = {
  parse(content: string, recordsPath?: string): unknown[] {
    const parsed = JSON.parse(content);
    return toRecordArray(getNestedProperty(parsed, recordsPath));
  }
};
