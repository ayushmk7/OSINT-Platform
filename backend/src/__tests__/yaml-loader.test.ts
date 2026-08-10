import path from 'path';
import {
  ENTITY_CATEGORIES,
  isEntityCategory,
  loadSourcesFromDir,
  SourceConfig
} from '../engine/yaml-loader';

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

  it('should only use canonical entity categories across all source definitions', () => {
    const sources = loadSourcesFromDir(sourcesDir);
    for (const source of sources) {
      expect(isEntityCategory(source.entity.category)).toBe(true);
    }
  });

  it('exposes atc_zone as part of the canonical category enum', () => {
    expect(ENTITY_CATEGORIES).toContain('atc_zone');
    expect(new Set(ENTITY_CATEGORIES).size).toBe(ENTITY_CATEGORIES.length);
    expect(isEntityCategory('atc_zone')).toBe(true);
    expect(isEntityCategory('not_a_category')).toBe(false);
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
});
