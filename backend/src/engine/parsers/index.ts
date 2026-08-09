import { csvParser } from './csv-parser';
import { geojsonParser } from './geojson-parser';
import { jsonParser } from './json-parser';
import { IParser, SupportedFormat, getNestedProperty, toRecordArray } from './types';
import { xmlParser } from './xml-parser';

export { getNestedProperty, toRecordArray };
export type { IParser, SupportedFormat };

const PARSERS: Record<SupportedFormat, IParser> = {
  json: jsonParser,
  geojson: geojsonParser,
  xml: xmlParser,
  csv: csvParser
};

/**
 * Turn a raw response body into an array of raw record objects, honoring the
 * source definition's `parser.format`, `parser.records_path` and `parser.max_records`.
 */
export function parsePayload(
  content: string,
  format: SupportedFormat,
  recordsPath?: string,
  maxRecords?: number
): unknown[] {
  const parser = PARSERS[format];
  if (!parser) {
    throw new Error(`Unsupported parser format: ${format}`);
  }

  const records = parser.parse(content, recordsPath, maxRecords);

  if (maxRecords && maxRecords > 0) {
    return records.slice(0, maxRecords);
  }
  return records;
}
