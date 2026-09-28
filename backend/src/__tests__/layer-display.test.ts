import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';
import {
  ICON_KEYS,
  LAYER_GROUPS,
  parseTtlSeconds,
  resolveLayerDisplay,
  validateLayerDisplay
} from '../engine/layer-display';
import { loadSourcesFromDir, validateSourceConfig } from '../engine/yaml-loader';

const BASE = `
name: quakes
source_type: usgs
layer_type: Earth Quakes
display_name: USGS Quakes
transport: { type: http_poll, url: http://example.test, interval: 60s }
parser: { format: json }
entity: { external_id: id, name: id }
observation: { latitude: lat, longitude: lon }
`;

const withBlocks = (extra: string): Record<string, unknown> => YAML.parse(BASE + extra);

function tmpDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-display-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

describe('layer / display blocks', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('applies defaults when both blocks are absent', () => {
    const { layer, display } = resolveLayerDisplay(withBlocks(''));
    expect(layer).toEqual({
      id: 'earth_quakes',
      name: 'USGS Quakes',
      group: 'Other',
      description: ''
    });
    expect(display).toMatchObject({
      declared: false,
      icon: 'dot',
      size: 1,
      rotate: false,
      trail: { enabled: false, max_points: 20 },
      ttl: null,
      ttl_seconds: null,
      fields: []
    });
  });

  it('resolves a full block, lower-casing colours and parsing the ttl', () => {
    const cfg = withBlocks(`
layer: { id: earthquakes, name: Earthquakes, group: Hazards, description: past hour }
display:
  icon: quake
  color: '#FF3B6B'
  color_by: { field: metadata.mag, stops: [[0, '#ffd166'], [6, '#FF0054']] }
  size: 1.5
  rotate: true
  trail: { enabled: true, max_points: 50 }
  ttl: 15m
  fields:
    - { path: metadata.mag, label: Magnitude, format: number, precision: 1 }
    - { path: metadata.url }
`);
    expect(validateLayerDisplay(cfg)).toEqual([]);
    const { layer, display } = resolveLayerDisplay(cfg);
    expect(layer.group).toBe('Hazards');
    expect(display.declared).toBe(true);
    expect(display.color).toBe('#ff3b6b');
    expect(display.color_by?.stops).toEqual([
      [0, '#ffd166'],
      [6, '#ff0054']
    ]);
    expect(display.ttl).toBe('15m');
    expect(display.ttl_seconds).toBe(900);
    expect(display.fields[1]).toEqual({
      path: 'metadata.url',
      label: 'metadata.url',
      format: 'text'
    });
  });

  it.each([
    ['bad layer id', 'layer: { id: Bad-Id }', /layer\.id/],
    ['bad group', 'layer: { group: Weird }', /layer\.group/],
    ['bad colour', "display: { color: 'red' }", /display\.color/],
    ['bad size', 'display: { size: 0 }', /display\.size/],
    ['bad rotate', 'display: { rotate: yes please }', /display\.rotate/],
    ['bad ttl', 'display: { ttl: soon }', /display\.ttl/],
    ['bad trail', 'display: { trail: { max_points: 0 } }', /max_points/],
    ['color_by without field', "display: { color_by: { map: { a: '#fff' } } }", /field/],
    [
      'color_by with both stops and map',
      "display: { color_by: { field: x, map: { a: '#fff' }, stops: [[0, '#fff']] } }",
      /exactly one/
    ],
    [
      'unsorted stops',
      "display: { color_by: { field: x, stops: [[5, '#fff'], [1, '#000']] } }",
      /ascending/
    ],
    ['bad map colour', 'display: { color_by: { field: x, map: { a: blue } } }', /map/],
    ['bad field format', 'display: { fields: [{ path: a, format: html }] }', /format/],
    ['field without path', 'display: { fields: [{ label: A }] }', /path/]
  ])('rejects %s', (_label, extra, pattern) => {
    const errors = validateSourceConfig(withBlocks(extra));
    expect(errors.join('; ')).toMatch(pattern);
  });

  it('rejects a non-snake_case entity.category', () => {
    const cfg = YAML.parse(BASE.replace('name: id }', 'name: id, category: Air-Craft }'));
    expect(validateSourceConfig(cfg).join('; ')).toMatch(/entity\.category/);
  });

  it('warns on an unknown icon and falls back to dot (the file still loads)', () => {
    const [src] = loadSourcesFromDir(tmpDir({ 'a.yaml': BASE + 'display: { icon: unicorn }\n' }));
    expect(src.display?.icon).toBe('dot');
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/unicorn/);
  });

  it('rejects the whole file on a bad block, with a clear error', () => {
    const dir = tmpDir({
      'bad.yaml': BASE + 'layer: { group: Nope }\n',
      'good.yaml': BASE.replace('name: quakes', 'name: ok')
    });
    expect(loadSourcesFromDir(dir).map((s) => s.name)).toEqual(['ok']);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/bad\.yaml.*layer\.group/);
  });

  it('defaults entity.category to the layer id, but keeps an explicit category', () => {
    const [seismic] = loadSourcesFromDir(tmpDir({ 'a.yaml': BASE + 'layer: { id: seismic }\n' }));
    expect(seismic.entity.category).toBe('seismic');
    const [explicit] = loadSourcesFromDir(
      tmpDir({
        'a.yaml': BASE.replace('name: id }', 'name: id, category: geological }')
      })
    );
    expect(explicit.entity.category).toBe('geological');
  });

  it('parses ttl durations', () => {
    expect(parseTtlSeconds('90s')).toBe(90);
    expect(parseTtlSeconds('15m')).toBe(900);
    expect(parseTtlSeconds('24h')).toBe(86400);
    expect(parseTtlSeconds('7d')).toBe(604800);
    expect(parseTtlSeconds(30)).toBe(30);
    expect(parseTtlSeconds('0m')).toBeNull();
    expect(parseTtlSeconds('forever')).toBeNull();
  });

  it('exports every contract icon key and legend group', () => {
    expect(ICON_KEYS).toHaveLength(35);
    expect(new Set(ICON_KEYS).size).toBe(35);
    expect(LAYER_GROUPS[LAYER_GROUPS.length - 1]).toBe('Other');
  });
});
