import { parsePayload } from '../engine/parsers';

// parsePayload returns `unknown[]` — arbitrary upstream JSON has no static shape. Tests read
// fields through an explicit accessor instead of the production code widening to `any`.
const field = (r: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], r);

describe('Multi-Format Parsers', () => {
  it('should parse JSON arrays and nested records_path', () => {
    const jsonRaw = JSON.stringify({ items: [{ id: 1 }, { id: 2 }] });
    const records = parsePayload(jsonRaw, 'json', 'items');
    expect(records).toHaveLength(2);
    expect(field(records[0], 'id')).toBe(1);
  });

  it('should parse a top-level JSON array with no records_path', () => {
    const records = parsePayload(JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]), 'json');
    expect(records).toHaveLength(3);
  });

  it('should wrap a single top-level JSON object into one record', () => {
    const records = parsePayload(JSON.stringify({ id: 25544, latitude: 1 }), 'json');
    expect(records).toHaveLength(1);
    expect(field(records[0], 'id')).toBe(25544);
  });

  it('should parse GeoJSON FeatureCollections', () => {
    const geojsonRaw = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122, 37] },
          properties: { mag: 4.5 }
        }
      ]
    });
    const records = parsePayload(geojsonRaw, 'geojson');
    expect(records).toHaveLength(1);
    expect(field(records[0], 'properties.mag')).toBe(4.5);
  });

  it('should parse XML data using fast-xml-parser', () => {
    const xmlRaw = `<rss><channel><item><title>Report 1</title></item></channel></rss>`;
    const records = parsePayload(xmlRaw, 'xml', 'rss.channel.item');
    expect(records).toHaveLength(1);
    expect(field(records[0], 'title')).toBe('Report 1');
  });

  it('should parse CSV data using papaparse', () => {
    const csvRaw = `id,name,lat,lon\n101,Station Alpha,19.4, -99.1`;
    const records = parsePayload(csvRaw, 'csv');
    expect(records).toHaveLength(1);
    expect(field(records[0], 'id')).toBe('101');
    expect(field(records[0], 'name')).toBe('Station Alpha');
  });

  it('should honor max_records', () => {
    const jsonRaw = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    expect(parsePayload(jsonRaw, 'json', undefined, 2)).toHaveLength(2);
  });
});
