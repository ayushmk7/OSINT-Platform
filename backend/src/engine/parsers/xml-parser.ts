import { XMLParser } from 'fast-xml-parser';
import { IParser, getNestedProperty, toRecordArray } from './types';

const parser = new XMLParser({ ignoreAttributes: false });

/**
 * XML / RSS / Atom payloads. `recordsPath` addresses the repeated element
 * (e.g. `rss.channel.item`). fast-xml-parser collapses a single repeated element
 * into an object, so it is re-wrapped into a one-element array.
 */
export const xmlParser: IParser = {
  parse(content: string, recordsPath?: string): unknown[] {
    const parsed = parser.parse(content);
    return toRecordArray(getNestedProperty(parsed, recordsPath));
  }
};
