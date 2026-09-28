import { XMLParser } from 'fast-xml-parser';
import { IParser } from './types';

/** One normalized feed item, regardless of RSS 2.0 / RSS 1.0 (RDF) / Atom input. */
export interface FeedRecord {
  title: string | null;
  link: string | null;
  description: string | null;
  /** ISO-8601 when the feed date parses, else the raw text, else null. */
  published: string | null;
  guid: string | null;
  categories: string[];
  author: string | null;
  /** From georss:point, georss:where/gml:Point/gml:pos, or geo:lat/geo:long. */
  lat: number | null;
  lon: number | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Keep ids, titles etc. as text: "0123" must not become 123.
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ['item', 'entry', 'category', 'link'].includes(name)
});

type Node = Record<string, unknown>;

/** Text content of an element that may be a string, an object with #text, or an array. */
function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = text(item);
      if (t) return t;
    }
    return null;
  }
  if (typeof v === 'object') {
    const node = v as Node;
    return text(node['#text'] ?? node['@_href'] ?? node['@_term'] ?? node.name);
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Atom has several <link href rel>; prefer rel="alternate" (or no rel). RSS has text links. */
function pickLink(v: unknown): string | null {
  const links = Array.isArray(v) ? v : v === undefined ? [] : [v];
  const atom = links.filter((l): l is Node => !!l && typeof l === 'object' && '@_href' in l);
  if (atom.length > 0) {
    const alt = atom.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? atom[0];
    return text(alt['@_href']);
  }
  return text(links);
}

function toIsoOrRaw(v: unknown): string | null {
  const raw = text(v);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? raw : new Date(ms).toISOString();
}

function num(v: unknown): number | null {
  const t = text(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "lat lon" pair (georss:point, gml:pos). */
function pair(v: unknown): [number, number] | null {
  const t = text(v);
  if (!t) return null;
  const parts = t.split(/[\s,]+/).map(Number);
  if (parts.length < 2 || !parts.every(Number.isFinite)) return null;
  return [parts[0], parts[1]];
}

function geo(item: Node): { lat: number | null; lon: number | null } {
  const point = pair(item['georss:point']);
  if (point) return { lat: point[0], lon: point[1] };

  const where = item['georss:where'] as Node | undefined;
  const gmlPoint = where?.['gml:Point'] as Node | undefined;
  const pos = pair(gmlPoint?.['gml:pos']);
  if (pos) return { lat: pos[0], lon: pos[1] };

  const geoPoint = (item['geo:Point'] as Node | undefined) ?? item;
  const lat = num(geoPoint['geo:lat']);
  const lon = num(geoPoint['geo:long'] ?? geoPoint['geo:lon']);
  if (lat !== null && lon !== null) return { lat, lon };

  return { lat: null, lon: null };
}

function categories(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return list.map((c) => text(c)).filter((c): c is string => !!c);
}

function normalize(item: Node): FeedRecord {
  const link = pickLink(item.link);
  const title = text(item.title);
  const location = geo(item);
  return {
    title,
    link,
    description: text(item.description ?? item.summary ?? item['content:encoded'] ?? item.content),
    published: toIsoOrRaw(item.pubDate ?? item.published ?? item['dc:date'] ?? item.updated),
    guid: text(item.guid) ?? text(item.id) ?? link ?? title,
    categories: categories(item.category ?? item['dc:subject']),
    author: text(item.author ?? item['dc:creator']),
    lat: location.lat,
    lon: location.lon
  };
}

/** Locate the repeated item element for RSS 2.0, RSS 1.0 (RDF) and Atom documents. */
function findItems(doc: Node): unknown[] {
  const rss = doc.rss as Node | undefined;
  const channel = rss?.channel as Node | Node[] | undefined;
  const ch = Array.isArray(channel) ? channel[0] : channel;
  if (ch?.item) return ch.item as unknown[];
  const rdf = doc['rdf:RDF'] as Node | undefined;
  if (rdf?.item) return rdf.item as unknown[];
  const feed = doc.feed as Node | undefined;
  if (feed?.entry) return feed.entry as unknown[];
  return [];
}

/**
 * RSS / Atom feeds (`format: rss`). Items are normalized to the `FeedRecord` shape so one
 * mapping works for every feed. `records_path` is ignored: the item list is found by format.
 */
export const rssParser: IParser = {
  parse(content: string): unknown[] {
    const doc = parser.parse(content) as Node;
    return findItems(doc)
      .filter((i): i is Node => !!i && typeof i === 'object')
      .map(normalize);
  }
};
