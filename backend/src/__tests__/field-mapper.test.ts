import { applyTemplate, computeDerived, mapRecord, passesFilter } from '../engine/field-mapper';
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
    expect(result!.entity.id).toBe('src-123:us7000abc');
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
    expect(mapRecord(raw, upsertCfg, 's')!.observation.id).toBe('obs_s:e1');
    expect(mapRecord(raw, appendCfg, 's')!.observation.id).toBe('obs_s:e1_1700000000000');
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

  it('namespaces entity and observation ids by source so sources cannot collide', () => {
    const raw = { id: 'e1', latitude: 1, longitude: 2, ts: 1700000000000 };
    const cfg: SourceConfig = {
      ...dummyConfig,
      entity: { external_id: 'id', name: 'id', category: 'aircraft' },
      observation: { latitude: 'latitude', longitude: 'longitude', timestamp: 'ts' },
      recording: { mode: 'upsert' }
    };
    const a = mapRecord(raw, cfg, 'src_a')!;
    const b = mapRecord(raw, cfg, 'src_b')!;
    expect(a.entity.id).toBe('src_a:e1');
    expect(a.observation.entity_id).toBe('src_a:e1');
    expect(a.entity.id).not.toBe(b.entity.id);
    expect(a.observation.id).not.toBe(b.observation.id);
  });

  it('applies observation.scale factors to numeric observation fields', () => {
    const cfg: SourceConfig = {
      ...dummyConfig,
      observation: {
        latitude: 'geometry.coordinates[1]',
        longitude: 'geometry.coordinates[0]',
        altitude: 'geometry.coordinates[2]',
        speed: 'v',
        timestamp: 'properties.time',
        scale: { altitude: -1000, speed: 0.5 }
      }
    };
    const raw = {
      id: 'q1',
      v: 10,
      properties: { place: 'x', time: 1700000000000 },
      geometry: { coordinates: [-122.4, 37.7, 10.5] }
    };
    const result = mapRecord(raw, cfg, 'quakes')!;
    expect(result.observation.altitude).toBe(-10500);
    expect(result.entity.altitude).toBe(-10500);
    expect(result.observation.speed).toBe(5);
    // Unscaled fields are untouched.
    expect(result.observation.latitude).toBe(37.7);
  });
});

describe('Field Mapper — record-level filters', () => {
  const rules = [
    { field: 'type', in: ['large_airport', 'medium_airport'] },
    { field: 'icao_code', not_empty: true }
  ];

  it('accepts every record when no rules are declared', () => {
    expect(passesFilter({ anything: 1 }, undefined)).toBe(true);
    expect(passesFilter({ anything: 1 }, [])).toBe(true);
  });

  it('keeps a record only when EVERY rule holds', () => {
    expect(passesFilter({ type: 'large_airport', icao_code: 'KJFK' }, rules)).toBe(true);
    expect(passesFilter({ type: 'medium_airport', icao_code: 'EGKK' }, rules)).toBe(true);
  });

  it('drops a record whose value is outside the `in` set', () => {
    expect(passesFilter({ type: 'heliport', icao_code: 'XXXX' }, rules)).toBe(false);
    expect(passesFilter({ type: 'closed', icao_code: 'XXXX' }, rules)).toBe(false);
  });

  it('treats blank / whitespace / missing as failing `not_empty`', () => {
    expect(passesFilter({ type: 'large_airport', icao_code: '' }, rules)).toBe(false);
    expect(passesFilter({ type: 'large_airport', icao_code: '   ' }, rules)).toBe(false);
    expect(passesFilter({ type: 'large_airport' }, rules)).toBe(false);
  });

  it('compares `in` values as strings so CSV numerics still match', () => {
    expect(passesFilter({ code: 5 }, [{ field: 'code', in: ['5'] }])).toBe(true);
    expect(passesFilter({ code: '5' }, [{ field: 'code', in: [5] }])).toBe(true);
  });

  it('resolves nested paths in filter fields', () => {
    expect(passesFilter({ p: { t: 'ok' } }, [{ field: 'p.t', in: ['ok'] }])).toBe(true);
    expect(passesFilter({ p: { t: 'no' } }, [{ field: 'p.t', in: ['ok'] }])).toBe(false);
  });
});

describe('Field Mapper — derived metadata', () => {
  const atcDerived = {
    radius_km: {
      from: 'type',
      map: { large_airport: 9, medium_airport: 5 },
      default: 5
    },
    zone_note: { template: 'approximate control-zone radius, illustrative only' },
    liveatc_url: { template: 'https://www.liveatc.net/search/?icao={icao_code|lower}' }
  };

  it('resolves a map lookup, falling back to the default', () => {
    expect(computeDerived({ type: 'large_airport' }, atcDerived).radius_km).toBe(9);
    expect(computeDerived({ type: 'medium_airport' }, atcDerived).radius_km).toBe(5);
    expect(computeDerived({ type: 'unlisted' }, atcDerived).radius_km).toBe(5);
  });

  it('omits a mapped field entirely when there is no hit and no default', () => {
    const out = computeDerived({ type: 'heliport' }, { r: { from: 'type', map: { a: 1 } } });
    expect(out).not.toHaveProperty('r');
  });

  it('expands template placeholders with lower/upper modifiers', () => {
    expect(applyTemplate({ icao_code: 'KJFK' }, 'x/{icao_code|lower}')).toBe('x/kjfk');
    expect(applyTemplate({ icao_code: 'kjfk' }, 'x/{icao_code|upper}')).toBe('x/KJFK');
    expect(applyTemplate({ icao_code: 'KJFK' }, 'x/{icao_code}')).toBe('x/KJFK');
  });

  it('returns undefined rather than a half-built value when a placeholder is missing', () => {
    expect(applyTemplate({}, 'https://x/?icao={icao_code|lower}')).toBeUndefined();
    expect(applyTemplate({ icao_code: '  ' }, 'https://x/?icao={icao_code|lower}')).toBeUndefined();
    expect(computeDerived({ type: 'large_airport' }, atcDerived)).not.toHaveProperty('liveatc_url');
  });

  it('treats a placeholder-free template as a literal constant', () => {
    expect(computeDerived({}, atcDerived).zone_note).toBe(
      'approximate control-zone radius, illustrative only'
    );
  });

  it('builds the LiveATC SEARCH-PAGE link and never a raw audio stream URL', () => {
    const url = computeDerived({ type: 'large_airport', icao_code: 'KJFK' }, atcDerived)
      .liveatc_url as string;
    expect(url).toBe('https://www.liveatc.net/search/?icao=kjfk');
    // Guards the compliance requirement: link-out only, nothing proxied or embedded.
    expect(url).not.toMatch(/\.pls|\.m3u|\.mp3|archive|listen\.liveatc/i);
  });

  it('merges derived metadata into mapRecord output, winning over a 1:1 copy', () => {
    const cfg: SourceConfig = {
      name: 'atc',
      source_type: 'ourairports',
      layer_type: 'atc_zones',
      display_name: 'ATC',
      transport: { type: 'http_poll', url: 'http://x', interval: '24h' },
      parser: { format: 'csv' },
      entity: {
        external_id: 'icao_code',
        name: 'name',
        category: 'atc_zone',
        metadata: { icao: 'icao_code', airport_type: 'type', radius_km: 'elevation_ft' },
        derived: atcDerived
      },
      observation: { latitude: 'latitude_deg', longitude: 'longitude_deg', altitude: '0' },
      recording: { mode: 'upsert' }
    };

    const result = mapRecord(
      {
        icao_code: 'EGLL',
        name: 'London Heathrow Airport',
        type: 'large_airport',
        latitude_deg: '51.4706',
        longitude_deg: '-0.461941',
        elevation_ft: '83'
      },
      cfg,
      'atc_facilities'
    );

    expect(result).not.toBeNull();
    expect(result!.entity.id).toBe('atc_facilities:EGLL');
    expect(result!.entity.category).toBe('atc_zone');
    expect(result!.observation.latitude).toBeCloseTo(51.4706, 4);
    expect(result!.entity.metadata.icao).toBe('EGLL');
    expect(result!.entity.metadata.radius_km).toBe(9); // derived beats the metadata copy
    expect(result!.entity.metadata.liveatc_url).toBe('https://www.liveatc.net/search/?icao=egll');
    expect(result!.entity.metadata.zone_note).toBe(
      'approximate control-zone radius, illustrative only'
    );
    expect(result!.observation.id).toBe('obs_atc_facilities:EGLL'); // upsert: one row per facility
  });
});
