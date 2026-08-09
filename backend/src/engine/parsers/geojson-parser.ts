import { IParser, getNestedProperty, toRecordArray } from './types';

/**
 * GeoJSON FeatureCollection payloads. Defaults to the `features` array when the
 * source definition does not override `records_path`.
 */
export const geojsonParser: IParser = {
  parse(content: string, recordsPath?: string): unknown[] {
    const parsed = JSON.parse(content);
    const target = getNestedProperty(parsed, recordsPath || 'features');
    return Array.isArray(target) ? target : toRecordArray(target);
  }
};
