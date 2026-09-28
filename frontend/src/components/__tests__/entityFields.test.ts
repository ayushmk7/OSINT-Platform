import { describe, it, expect } from 'vitest';
import { formatField, metadataKeysInFields, safeHttpUrl } from '../entityFields';

const now = Date.parse('2026-09-28T12:00:00Z');
const entity = {
  altitude: 10668.4,
  timestamp: '2026-09-28T11:56:00Z',
  metadata: {
    mag: 4.567,
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
    evil: 'javascript:alert(1)',
    tsunami: 1,
    time: 1790596560000
  }
};

describe('display.fields formatting', () => {
  it('formats numbers with precision, prefix and suffix', () => {
    expect(
      formatField(
        entity,
        { path: 'metadata.mag', label: 'Mag', format: 'number', precision: 1 },
        now
      )
    ).toEqual({ label: 'Mag', text: '4.6' });
    expect(
      formatField(
        entity,
        { path: 'altitude', label: 'Alt', format: 'number', precision: 0, suffix: ' m' },
        now
      ).text
    ).toBe('10,668 m');
  });

  it('formats datetimes as relative time plus UTC', () => {
    const out = formatField(entity, { path: 'timestamp', label: 'T', format: 'datetime' }, now);
    expect(out.text).toBe('4m ago');
    expect(out.utc).toBe('2026-09-28 11:56:00Z');
    const epoch = formatField(
      entity,
      { path: 'metadata.time', label: 'T', format: 'datetime' },
      now
    );
    expect(epoch.utc).toMatch(/Z$/);
  });

  it('only turns http(s) URLs into links', () => {
    const link = formatField(entity, { path: 'metadata.url', label: 'L', format: 'link' }, now);
    expect(link.href).toBe(entity.metadata.url);
    expect(link.text).toBe('earthquake.usgs.gov/earthquakes/eventpage/us7000abcd');
    const evil = formatField(entity, { path: 'metadata.evil', label: 'L', format: 'link' }, now);
    expect(evil.href).toBeUndefined();
    expect(safeHttpUrl('ftp://x')).toBeNull();
  });

  it('formats booleans and missing values', () => {
    expect(
      formatField(entity, { path: 'metadata.tsunami', label: 'B', format: 'bool' }, now).text
    ).toBe('Yes');
    expect(
      formatField(entity, { path: 'metadata.nope', label: 'N', format: 'text' }, now).text
    ).toBe('—');
  });

  it('collects the metadata keys already shown as fields', () => {
    expect(
      metadataKeysInFields([
        { path: 'metadata.mag', label: '', format: 'number' },
        { path: 'metadata.a.b', label: '', format: 'text' },
        { path: 'altitude', label: '', format: 'number' }
      ])
    ).toEqual(new Set(['mag', 'a']));
  });
});
