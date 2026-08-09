import path from 'path';
import { loadSourcesFromDir, SourceConfig } from '../engine/yaml-loader';

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
    const canonical = new Set(['satellite', 'aircraft', 'geological', 'radiation', 'maritime']);
    const sources = loadSourcesFromDir(sourcesDir);
    for (const source of sources) {
      expect(canonical.has(source.entity.category as string)).toBe(true);
    }
  });

  it('should parse recording.mode for every source', () => {
    const sources = loadSourcesFromDir(sourcesDir);
    for (const source of sources) {
      expect(['upsert', 'append']).toContain(source.recording?.mode);
    }
  });
});
