import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';
import {
  ENTITY_CATEGORIES,
  isEntityCategory,
  loadSourcesFromDir,
  SourceConfig,
  validateSourceConfig
} from '../engine/yaml-loader';

const VALID_YAML = `
schema_version: 1
name: good_src
source_type: good_src
layer_type: test
display_name: Good
transport:
  type: http_poll
  url: http://example.test
  interval: 60s
  retry:
    backoff: exponential
parser:
  format: json
entity:
  external_id: id
  name: id
  category: aircraft
observation:
  latitude: lat
  longitude: lon
  scale:
    altitude: 1000
`;

function writeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-loader-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

describe('YAML Source Loader', () => {
  const sourcesDir = path.resolve(__dirname, '../../../sources.d');

  it('should discover and parse YAML source files from sources.d/', () => {
    const sources: SourceConfig[] = loadSourcesFromDir(sourcesDir);
    expect(sources.length).toBeGreaterThanOrEqual(4);

    const usgs = sources.find((s) => s.name === 'usgs_earthquakes');
    expect(usgs).toBeDefined();
    expect(usgs?.transport.url).toContain('earthquake.usgs.gov');
    expect(usgs?.parser.format).toBe('geojson');

    const iss = sources.find((s) => s.name === 'iss_position');
    expect(iss).toBeDefined();
    expect(iss?.parser.format).toBe('json');
  });

  it('should return an empty list for a directory that does not exist', () => {
    expect(loadSourcesFromDir(path.join(sourcesDir, '__nope__'))).toEqual([]);
  });

  it('gives every shipped source a declared layer + display, with category = layer id', () => {
    const sources = loadSourcesFromDir(sourcesDir);
    for (const source of sources) {
      expect(isEntityCategory(source.entity.category)).toBe(true);
      expect(source.layer).toBeDefined();
      expect(source.display?.declared).toBe(true);
      expect(source.entity.category).toBe(source.layer?.id);
    }
  });

  it('keeps the legacy category list exported; any snake_case id is a valid category', () => {
    expect(ENTITY_CATEGORIES).toContain('atc_zone');
    expect(new Set(ENTITY_CATEGORIES).size).toBe(ENTITY_CATEGORIES.length);
    expect(isEntityCategory('atc_zone')).toBe(true);
    expect(isEntityCategory('wildfires_viirs')).toBe(true);
    expect(isEntityCategory('Not-A-Category')).toBe(false);
    expect(isEntityCategory('')).toBe(false);
  });

  it('parses the ATC facilities source with its filters and derived fields', () => {
    const sources = loadSourcesFromDir(sourcesDir);
    const atc = sources.find((s) => s.name === 'atc_facilities');

    expect(atc).toBeDefined();
    expect(atc?.parser.format).toBe('csv');
    expect(atc?.transport.url).toContain('ourairports-data/airports.csv');
    expect(atc?.entity.category).toBe('atc_zone');
    expect(atc?.entity.external_id).toBe('icao_code');
    expect(atc?.recording?.mode).toBe('upsert');

    expect(atc?.filter).toEqual([
      { field: 'type', in: ['large_airport', 'medium_airport'] },
      { field: 'icao_code', not_empty: true }
    ]);

    expect(atc?.entity.derived?.radius_km?.map).toEqual({
      large_airport: 9,
      medium_airport: 5
    });
    expect(atc?.entity.derived?.zone_note?.template).toBe(
      'approximate control-zone radius, illustrative only'
    );
    // Link-out to LiveATC's public search page only — never a raw audio stream URL.
    expect(atc?.entity.derived?.liveatc_url?.template).toBe(
      'https://www.liveatc.net/search/?icao={icao_code|lower}'
    );
  });

  it('should parse recording.mode for every source', () => {
    const sources = loadSourcesFromDir(sourcesDir);
    for (const source of sources) {
      expect(['upsert', 'append']).toContain(source.recording?.mode);
    }
  });

  describe('validation', () => {
    let errorSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    beforeEach(() => {
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    const logged = (): string =>
      [...errorSpy.mock.calls, ...warnSpy.mock.calls].map((c) => c.join(' ')).join('\n');

    it('accepts every shipped source definition with no validation errors', () => {
      const dir = path.resolve(__dirname, '../../../sources.d');
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
        const parsed = YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        expect({ file, errors: validateSourceConfig(parsed) }).toEqual({ file, errors: [] });
      }
    });

    it('rejects a file missing source_type (NOT NULL sources.type) and keeps loading the rest', () => {
      const dir = writeDir({
        'a_bad.yaml': VALID_YAML.replace('source_type: good_src\n', '').replace(
          'name: good_src',
          'name: bad_src'
        ),
        'b_good.yaml': VALID_YAML
      });
      const sources = loadSourcesFromDir(dir);
      expect(sources.map((s) => s.name)).toEqual(['good_src']);
      expect(logged()).toMatch(/a_bad\.yaml/);
      expect(logged()).toMatch(/source_type/);
    });

    it.each([
      ['name', (y: string) => y.replace('name: good_src\n', ''), /name/],
      ['transport.type', (y: string) => y.replace('  type: http_poll\n', ''), /transport\.type/],
      [
        'transport.url',
        (y: string) => y.replace('  url: http://example.test\n', ''),
        /transport\.url/
      ],
      [
        'blank source_type',
        (y: string) => y.replace('source_type: good_src', "source_type: ''"),
        /source_type/
      ]
    ])('reports a missing/blank %s', (_label, mutate, pattern) => {
      const errors = validateSourceConfig(YAML.parse(mutate(VALID_YAML)));
      expect(errors.join('; ')).toMatch(pattern);
    });

    it('rejects an unsupported schema_version and accepts 1 or an absent one', () => {
      expect(validateSourceConfig(YAML.parse(VALID_YAML))).toEqual([]);
      expect(
        validateSourceConfig(YAML.parse(VALID_YAML.replace('schema_version: 1\n', '')))
      ).toEqual([]);
      const errors = validateSourceConfig(
        YAML.parse(VALID_YAML.replace('schema_version: 1', 'schema_version: 2'))
      );
      expect(errors.join('; ')).toMatch(/schema_version/);
    });

    it('rejects an unknown retry.backoff and accepts exponential / linear / fixed', () => {
      for (const ok of ['exponential', 'linear', 'fixed']) {
        expect(
          validateSourceConfig(
            YAML.parse(VALID_YAML.replace('backoff: exponential', `backoff: ${ok}`))
          )
        ).toEqual([]);
      }
      const errors = validateSourceConfig(
        YAML.parse(VALID_YAML.replace('backoff: exponential', 'backoff: quadratic'))
      );
      expect(errors.join('; ')).toMatch(/retry\.backoff/);
    });

    it('rejects a non-numeric observation.scale factor', () => {
      const errors = validateSourceConfig(
        YAML.parse(VALID_YAML.replace('altitude: 1000', 'altitude: lots'))
      );
      expect(errors.join('; ')).toMatch(/observation\.scale\.altitude/);
    });

    it('does not throw on a YAML syntax error; the file is skipped and logged', () => {
      const dir = writeDir({ 'broken.yaml': 'name: [unterminated\n', 'ok.yaml': VALID_YAML });
      expect(loadSourcesFromDir(dir).map((s) => s.name)).toEqual(['good_src']);
      expect(logged()).toMatch(/broken\.yaml/);
    });
  });
});
