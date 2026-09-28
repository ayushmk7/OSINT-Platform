import { csvParser } from './csv-parser';
import { geojsonParser } from './geojson-parser';
import { jsonParser } from './json-parser';
import { rssParser } from './rss-parser';
import { ommJsonParser, tleParser } from './tle-parser';
import {
  CsvOptions,
  IParser,
  ParserOptions,
  SupportedFormat,
  getNestedProperty,
  toRecordArray
} from './types';
import { xmlParser } from './xml-parser';

export { getNestedProperty, toRecordArray };
export type { CsvOptions, IParser, ParserOptions, SupportedFormat };

const PARSERS: Record<SupportedFormat, IParser> = {
  json: jsonParser,
  geojson: geojsonParser,
  xml: xmlParser,
  csv: csvParser,
  rss: rssParser,
  tle: tleParser,
  omm_json: ommJsonParser
};

export const SUPPORTED_FORMATS = Object.keys(PARSERS) as SupportedFormat[];

/**
 * Turn a raw response body into an array of raw record objects, honoring the
 * source definition's `parser.format`, `parser.records_path` and `parser.max_records`,
 * plus the format-specific `options` (the whole `parser:` block may be passed).
 */
export function parsePayload(
  content: string,
  format: SupportedFormat,
  recordsPath?: string,
  maxRecords?: number,
  options?: ParserOptions
): unknown[] {
  const parser = PARSERS[format];
  if (!parser) {
    throw new Error(`Unsupported parser format: ${format}`);
  }

  const records = parser.parse(content, recordsPath, maxRecords, options);

  if (maxRecords && maxRecords > 0) {
    return records.slice(0, maxRecords);
  }
  return records;
}
