import { mapRecord } from '../engine/field-mapper';
import { SourceConfig } from '../engine/yaml-loader';

describe('Field Mapper', () => {
  const dummyConfig: SourceConfig = {
    name: 'test_earthquakes',
    source_type: 'test_earthquakes',
    layer_type: 'earthquakes',
    display_name: 'Test Quakes',
    transport: { type: 'http_poll', url: 'http://test.com', interval: '60s' },
    parser: { format: 'geojson', records_path: 'features' },
    entity: {
      external_id: 'id',
      name: 'properties.place',
      category: 'geological',
      metadata: { mag: 'properties.mag' }
    },
    observation: {
      latitude: 'geometry.coordinates[1]',
      longitude: 'geometry.coordinates[0]',
      altitude: 'geometry.coordinates[2]',
      timestamp: 'properties.time'
    }
  };

  it('should map raw geojson feature into Entity and Observation records', () => {
    const rawRecord = {
      id: 'us7000abc',
      properties: { place: 'San Francisco, CA', mag: 5.2, time: 1700000000000 },
      geometry: { coordinates: [-122.4194, 37.7749, 10.5] }
    };

    const result = mapRecord(rawRecord, dummyConfig, 'src-123');
    expect(result).not.toBeNull();
    expect(result!.entity.id).toBe('us7000abc');
    expect(result!.entity.name).toBe('San Francisco, CA');
    expect(result!.entity.category).toBe('geological');
    expect(result!.observation.latitude).toBe(37.7749);
    expect(result!.observation.longitude).toBe(-122.4194);
    expect(result!.observation.altitude).toBe(10.5);
    expect(result!.entity.metadata.mag).toBe(5.2);
  });

  it('should build a DETERMINISTIC observation id from entity + source timestamp', () => {
    const rawRecord = {
      id: 'us7000abc',
      properties: { place: 'SF', mag: 5.2, time: 1700000000000 },
      geometry: { coordinates: [-122.4194, 37.7749, 10.5] }
    };
    const a = mapRecord(rawRecord, dummyConfig, 'src-123');
    const b = mapRecord(rawRecord, dummyConfig, 'src-123');
    // Same input twice -> same id (so INSERT OR IGNORE can dedup). No Date.now()/random.
    expect(a!.observation.id).toBe(b!.observation.id);
  });

  it('should SKIP (return null) when coordinates are missing - never plot at (0,0)', () => {
    const noCoords = {
      id: 'nogeo',
      properties: { place: 'nowhere', time: 1700000000000 },
      geometry: { coordinates: [] }
    };
    expect(mapRecord(noCoords, dummyConfig, 'src-123')).toBeNull();
  });

  it('should SKIP (return null) when the external id is missing', () => {
    const noId = {
      properties: { place: 'nowhere', time: 1700000000000 },
      geometry: { coordinates: [-1, 2, 3] }
    };
    expect(mapRecord(noId, dummyConfig, 'src-123')).toBeNull();
  });

  it('should treat a non-resolvable numeric mapping as a LITERAL constant', () => {
    const literalConfig: SourceConfig = {
      ...dummyConfig,
      observation: {
        latitude: 'latitude',
        longitude: 'longitude',
        altitude: '0',
        speed: '0',
        heading: '0',
        timestamp: 'captured_at'
      },
      entity: { external_id: 'id', name: 'id', category: 'radiation' }
    };
    const raw = { id: '42', latitude: 35.1, longitude: 139.2, captured_at: '2024-01-01T00:00:00Z' };
    const result = mapRecord(raw, literalConfig, 'safecast');
    expect(result).not.toBeNull();
    expect(result!.observation.altitude).toBe(0);
    expect(result!.observation.speed).toBe(0);
    expect(result!.observation.heading).toBe(0);
  });

  it('should normalize epoch-seconds, epoch-millis and ISO timestamps to ISO-8601', () => {
    const base = { id: 'e1', latitude: 1, longitude: 2 };
    const cfg: SourceConfig = {
      ...dummyConfig,
      entity: { external_id: 'id', name: 'id', category: 'satellite' },
      observation: { latitude: 'latitude', longitude: 'longitude', timestamp: 'ts' },
      recording: { mode: 'append' }
    };
    const seconds = mapRecord({ ...base, ts: 1700000000 }, cfg, 's')!;
    const millis = mapRecord({ ...base, ts: 1700000000000 }, cfg, 's')!;
    const iso = mapRecord({ ...base, ts: '2023-11-14T22:13:20.000Z' }, cfg, 's')!;
    expect(seconds.observation.timestamp).toBe('2023-11-14T22:13:20.000Z');
    expect(millis.observation.timestamp).toBe('2023-11-14T22:13:20.000Z');
    expect(iso.observation.timestamp).toBe('2023-11-14T22:13:20.000Z');
  });

  it('should use obs_<entity_id> for upsert mode and include the instant for append mode', () => {
    const raw = { id: 'e1', latitude: 1, longitude: 2, ts: 1700000000000 };
    const appendCfg: SourceConfig = {
      ...dummyConfig,
      entity: { external_id: 'id', name: 'id', category: 'aircraft' },
      observation: { latitude: 'latitude', longitude: 'longitude', timestamp: 'ts' },
      recording: { mode: 'append' }
    };
    const upsertCfg: SourceConfig = { ...appendCfg, recording: { mode: 'upsert' } };
    expect(mapRecord(raw, upsertCfg, 's')!.observation.id).toBe('obs_e1');
    expect(mapRecord(raw, appendCfg, 's')!.observation.id).toBe('obs_e1_1700000000000');
  });

  it('should key append observations on rounded position when the source has no timestamp', () => {
    const cfg: SourceConfig = {
      ...dummyConfig,
      entity: { external_id: 'hex', name: 'flight', category: 'aircraft' },
      observation: { latitude: 'lat', longitude: 'lon' },
      recording: { mode: 'append' }
    };
    const a = mapRecord({ hex: 'abc123', flight: 'RCH01', lat: 10.5, lon: -20.25 }, cfg, 'adsb')!;
    const b = mapRecord({ hex: 'abc123', flight: 'RCH01', lat: 10.5, lon: -20.25 }, cfg, 'adsb')!;
    const moved = mapRecord(
      { hex: 'abc123', flight: 'RCH01', lat: 11.5, lon: -20.25 },
      cfg,
      'adsb'
    )!;
    expect(a.observation.id).toBe(b.observation.id);
    expect(a.observation.id).not.toBe(moved.observation.id);
    expect(a.observation.id).not.toMatch(/undefined|NaN/);
  });
});
