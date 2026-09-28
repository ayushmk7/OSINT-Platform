import Papa from 'papaparse';
import { CsvOptions, IParser, ParserOptions } from './types';

/**
 * Tabular CSV payloads. By default the header row becomes the record keys; values stay
 * strings and are coerced later by the field mapper. `parser.csv` adds delimiter choice
 * (including 'whitespace' for space-aligned text tables), header-less files, leading-line
 * skips and comment lines.
 */
export const csvParser: IParser = {
  parse(content: string, _recordsPath?: string, _max?: number, options?: ParserOptions) {
    const csv = options?.csv;
    if (!csv) {
      const result = Papa.parse<Record<string, unknown>>(content, {
        header: true,
        skipEmptyLines: true
      });
      warnOnErrors(result.errors);
      return result.data;
    }
    return parseWithOptions(content, csv);
  }
};

function warnOnErrors(errors: Papa.ParseError[]): void {
  if (errors.length > 0) {
    console.warn(`CSV parse reported ${errors.length} issue(s): ${errors[0].message}`);
  }
}

function parseWithOptions(content: string, csv: CsvOptions): Record<string, unknown>[] {
  let lines = content.split(/\r?\n/);
  if (csv.skip_lines && csv.skip_lines > 0) lines = lines.slice(csv.skip_lines);
  const prefix = csv.comment_prefix;
  if (prefix) lines = lines.filter((l) => !l.trimStart().startsWith(prefix));
  lines = lines.filter((l) => l.trim() !== '');

  let rows: string[][];
  if (csv.delimiter === 'whitespace') {
    rows = lines.map((l) => l.trim().split(/\s+/));
  } else {
    const result = Papa.parse<string[]>(lines.join('\n'), {
      header: false,
      skipEmptyLines: true,
      delimiter: csv.delimiter === '\\t' ? '\t' : (csv.delimiter ?? '')
    });
    warnOnErrors(result.errors);
    rows = result.data;
  }

  let header: string[] = [];
  if (csv.has_header !== false && rows.length > 0) {
    header = rows[0].map((h) => String(h).trim());
    rows = rows.slice(1);
  }
  if (csv.columns && csv.columns.length > 0) header = csv.columns.map(String);

  return rows.map((row) => {
    const record: Record<string, unknown> = {};
    row.forEach((value, i) => {
      record[header[i] ? header[i] : `c${i}`] = value;
    });
    return record;
  });
}
