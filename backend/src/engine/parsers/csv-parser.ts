import Papa from 'papaparse';
import { IParser } from './types';

/**
 * Tabular CSV payloads. The header row becomes the record keys; values stay strings
 * and are coerced later by the field mapper.
 */
export const csvParser: IParser = {
  parse(content: string): unknown[] {
    const result = Papa.parse<Record<string, unknown>>(content, {
      header: true,
      skipEmptyLines: true
    });
    if (result.errors.length > 0) {
      console.warn(
        `CSV parse reported ${result.errors.length} issue(s): ${result.errors[0].message}`
      );
    }
    return result.data;
  }
};
