import request from 'supertest';
import { parse as parseYaml } from 'yaml';
import { createApp } from '../app';
import { initDatabase, closeDatabase } from '../db/database';
import Database from 'better-sqlite3';

describe('REST API Routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = initDatabase(':memory:');
    db.prepare(
      `
      INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
      VALUES ('src-1', 'Test Source', 'earthquake', 'http', 'http://api.com', 60, 1)
    `
    ).run();

    const insertEntity = db.prepare(
      `INSERT INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
       VALUES (?, 'src-1', ?, ?, ?, ?, ?, ?, '{}')`
    );
    insertEntity.run('ent_1', 'satellite', 'ISS', 45.0, 10.0, 400000.0, '2026-07-26T00:00:00Z');
    insertEntity.run(
      'ent_2',
      'geological',
      'M4.2 Quake',
      -20.0,
      -70.0,
      0.0,
      '2026-07-25T00:00:00Z'
    );

    db.prepare(
      `INSERT INTO observations
         (id, entity_id, source_id, latitude, longitude, altitude, speed, heading, timestamp, raw_payload)
       VALUES ('obs_1', 'ent_1', 'src-1', 45.0, 10.0, 400000.0, 7700.0, 90.0, '2026-07-26T00:00:00Z', '{}')`
    ).run();

    app = createApp(db);
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it('GET /api/health reports ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/sources returns wrapped { sources }', async () => {
    const res = await request(app).get('/api/sources');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sources)).toBe(true);
    expect(res.body.sources.length).toBe(1);
    expect(res.body.sources[0].id).toBe('src-1');
  });

  it('GET /api/entities returns wrapped { entities }', async () => {
    const res = await request(app).get('/api/entities');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entities)).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body.limit).toBe(100);
    expect(res.body.offset).toBe(0);
  });

  it('GET /api/entities filters by category', async () => {
    const res = await request(app).get('/api/entities?category=satellite');
    expect(res.status).toBe(200);
    expect(res.body.entities.length).toBe(1);
    expect(res.body.entities[0].id).toBe('ent_1');
  });

  it('GET /api/entities filters by source_id', async () => {
    const hit = await request(app).get('/api/entities?source_id=src-1');
    expect(hit.body.entities.length).toBe(2);
    const miss = await request(app).get('/api/entities?source_id=nope');
    expect(miss.body.entities.length).toBe(0);
  });

  it('GET /api/entities supports a spatial bounding box filter', async () => {
    const inside = await request(app).get(
      '/api/entities?min_lat=40&max_lat=50&min_lon=5&max_lon=15'
    );
    expect(inside.status).toBe(200);
    expect(inside.body.entities.length).toBe(1);
    expect(inside.body.entities[0].id).toBe('ent_1');

    const outside = await request(app).get('/api/entities?min_lat=0&max_lat=10');
    expect(outside.body.entities.length).toBe(0);
  });

  it('GET /api/entities honours limit and offset', async () => {
    const first = await request(app).get('/api/entities?limit=1&offset=0');
    expect(first.body.entities.length).toBe(1);
    expect(first.body.limit).toBe(1);

    const second = await request(app).get('/api/entities?limit=1&offset=1');
    expect(second.body.entities.length).toBe(1);
    expect(second.body.entities[0].id).not.toBe(first.body.entities[0].id);
  });

  it('GET /api/entities clamps limit to the 1000 maximum', async () => {
    const res = await request(app).get('/api/entities?limit=99999');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(1000);
  });

  it('GET /api/entities rejects an inverted bounding box with a 400 envelope', async () => {
    const res = await request(app).get('/api/entities?min_lat=50&max_lat=40');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: 400,
      error: 'Bad Request',
      message: 'Invalid bounding box parameters: min_lat must be less than max_lat',
      details: null
    });
    // No stack traces or raw error strings in the response body.
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at Object|\.ts:\d/);
  });

  it('GET /api/entities rejects a non-numeric bounding box parameter', async () => {
    const res = await request(app).get('/api/entities?min_lat=abc');
    expect(res.status).toBe(400);
    expect(res.body.details).toBeNull();
  });

  it('GET /api/observations returns wrapped { observations }', async () => {
    const res = await request(app).get('/api/observations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.observations)).toBe(true);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/observations filters by entity_id', async () => {
    const res = await request(app).get('/api/observations?entity_id=ent_1');
    expect(res.status).toBe(200);
    expect(res.body.observations.length).toBe(1);
    expect(res.body.observations[0].entity_id).toBe('ent_1');

    const miss = await request(app).get('/api/observations?entity_id=ent_2');
    expect(miss.body.observations.length).toBe(0);
  });
});

describe('REST API — pagination totals', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = initDatabase(':memory:');
    db.prepare(
      `INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
       VALUES ('src-1', 'Test Source', 'test', 'http_poll', 'http://example.com', 60, 1),
              ('src-2', 'Other Source', 'test', 'http_poll', 'http://example.com', 60, 0)`
    ).run();
    const insertEntity = db.prepare(
      `INSERT INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
       VALUES (?, ?, ?, ?, 10, 10, 0, ?, '{"k":1}')`
    );
    const insertObs = db.prepare(
      `INSERT INTO observations
         (id, entity_id, source_id, latitude, longitude, altitude, speed, heading, timestamp, raw_payload)
       VALUES (?, ?, ?, 10, 10, 0, 0, 0, ?, '{"raw":true}')`
    );
    for (let i = 0; i < 5; i++) {
      const ts = `2026-07-2${i}T00:00:00Z`;
      insertEntity.run(`sat_${i}`, 'src-1', 'satellite', `SAT${i}`, ts);
      insertObs.run(`obs_sat_${i}`, `sat_${i}`, 'src-1', ts);
    }
    for (let i = 0; i < 3; i++) {
      const ts = `2026-07-1${i}T00:00:00Z`;
      insertEntity.run(`ac_${i}`, 'src-2', 'aircraft', `AC${i}`, ts);
      insertObs.run(`obs_ac_${i}`, `ac_${i}`, 'src-2', ts);
    }
    app = createApp(db);
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it('entities total counts every matching row, independent of limit/offset', async () => {
    const res = await request(app).get('/api/entities?limit=2&offset=1');
    expect(res.body.entities.length).toBe(2);
    expect(res.body.total).toBe(8);
  });

  it('entities total honours the filters', async () => {
    const res = await request(app).get('/api/entities?category=satellite&limit=1');
    expect(res.body.entities.length).toBe(1);
    expect(res.body.total).toBe(5);

    const bySource = await request(app).get('/api/entities?source_id=src-2&offset=10');
    expect(bySource.body.entities.length).toBe(0);
    expect(bySource.body.total).toBe(3);
  });

  it('observations total counts every matching row, independent of limit/offset', async () => {
    const all = await request(app).get('/api/observations?limit=3&offset=2');
    expect(all.body.observations.length).toBe(3);
    expect(all.body.total).toBe(8);

    const filtered = await request(app).get('/api/observations?source_id=src-1&limit=1');
    expect(filtered.body.observations.length).toBe(1);
    expect(filtered.body.total).toBe(5);
  });

  it('returns metadata / raw_payload as objects and enabled as a boolean', async () => {
    const sources = await request(app).get('/api/sources');
    const enabled = Object.fromEntries(
      sources.body.sources.map((s: { id: string; enabled: unknown }) => [s.id, s.enabled])
    );
    expect(enabled).toEqual({ 'src-1': true, 'src-2': false });

    const entities = await request(app).get('/api/entities?limit=1');
    expect(entities.body.entities[0].metadata).toEqual({ k: 1 });

    const obs = await request(app).get('/api/observations?limit=1');
    expect(obs.body.observations[0].raw_payload).toEqual({ raw: true });
  });

  it('degrades malformed stored JSON to an empty object instead of failing', async () => {
    db.prepare(`UPDATE entities SET metadata = 'not json' WHERE id = 'sat_4'`).run();
    const res = await request(app).get('/api/entities?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.entities[0].id).toBe('sat_4');
    expect(res.body.entities[0].metadata).toEqual({});
  });
});

describe('REST API — 404 and OpenAPI spec', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = initDatabase(':memory:');
    app = createApp(db);
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it.each(['/api/nope', '/api/entities/does-not-exist', '/nope'])(
    'unknown route %s returns the JSON error envelope',
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({
        status: 404,
        error: 'Not Found',
        message: `Route not found: GET ${path}`,
        details: null
      });
    }
  );

  it('GET /api/openapi.yaml serves the spec, documenting every route', async () => {
    const res = await request(app).get('/api/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/yaml/);
    const spec = parseYaml(res.text);
    expect(spec.openapi).toMatch(/^3\./);
    for (const p of [
      '/api/health',
      '/api/openapi.yaml',
      '/api/sources',
      '/api/entities',
      '/api/observations'
    ]) {
      expect(spec.paths[p]).toBeDefined();
    }
    const paramNames = (p: string): string[] =>
      spec.paths[p].get.parameters.map(
        (x: { name?: string; $ref?: string }) =>
          x.name ?? spec.components.parameters[String(x.$ref).split('/').pop() as string].name
      );
    expect(paramNames('/api/entities').sort()).toEqual(
      [
        'category',
        'limit',
        'max_lat',
        'max_lon',
        'min_lat',
        'min_lon',
        'offset',
        'source_id'
      ].sort()
    );
    expect(paramNames('/api/observations').sort()).toEqual(
      ['entity_id', 'limit', 'offset', 'source_id'].sort()
    );
    expect(spec.components.schemas.Source.properties.enabled.type).toBe('boolean');
    expect(spec.components.schemas.Entity.properties.metadata.type).toBe('object');
    expect(spec.components.schemas.Observation.properties.raw_payload.type).toBe('object');
    expect(spec.components.schemas.ErrorResponse.required).toEqual([
      'status',
      'error',
      'message',
      'details'
    ]);
  });
});

describe('REST API — atc_zone entities', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = initDatabase(':memory:');
    db.prepare(
      `INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
       VALUES ('atc_facilities', 'ATC Facilities', 'ourairports', 'http_poll',
               'https://davidmegginson.github.io/ourairports-data/airports.csv', 86400, 1)`
    ).run();

    const insertEntity = db.prepare(
      `INSERT INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
       VALUES (?, 'atc_facilities', 'atc_zone', ?, ?, ?, 0, '2026-08-08T00:00:00Z', ?)`
    );
    insertEntity.run(
      'EGLL',
      'London Heathrow Airport',
      51.4706,
      -0.461941,
      JSON.stringify({
        icao: 'EGLL',
        iata_code: 'LHR',
        municipality: 'London',
        airport_type: 'large_airport',
        radius_km: 9,
        zone_note: 'approximate control-zone radius, illustrative only',
        liveatc_url: 'https://www.liveatc.net/search/?icao=egll'
      })
    );
    insertEntity.run(
      'EGPE',
      'Inverness Airport',
      57.5425,
      -4.0475,
      JSON.stringify({
        icao: 'EGPE',
        iata_code: 'INV',
        municipality: 'Inverness',
        airport_type: 'medium_airport',
        radius_km: 5,
        zone_note: 'approximate control-zone radius, illustrative only',
        liveatc_url: 'https://www.liveatc.net/search/?icao=egpe'
      })
    );
    insertEntity.run('ent_sat', 'ISS', 45.0, 10.0, '{}');
    db.prepare(`UPDATE entities SET category = 'satellite' WHERE id = 'ent_sat'`).run();

    app = createApp(db);
  });

  afterAll(() => {
    closeDatabase(db);
  });

  it('GET /api/entities?category=atc_zone returns only ATC zones', async () => {
    const res = await request(app).get('/api/entities?category=atc_zone');
    expect(res.status).toBe(200);
    expect(res.body.entities.length).toBe(2);
    expect(res.body.entities.every((e: { category: string }) => e.category === 'atc_zone')).toBe(
      true
    );
  });

  it('carries radius_km, zone_note and a LiveATC search link in metadata', async () => {
    const res = await request(app).get('/api/entities?category=atc_zone');
    const byId = Object.fromEntries(
      res.body.entities.map((e: { id: string; metadata: Record<string, unknown> }) => [
        e.id,
        e.metadata
      ])
    );

    expect(byId.EGLL.radius_km).toBe(9);
    expect(byId.EGPE.radius_km).toBe(5);
    expect(byId.EGLL.liveatc_url).toBe('https://www.liveatc.net/search/?icao=egll');
    expect(byId.EGPE.liveatc_url).toBe('https://www.liveatc.net/search/?icao=egpe');

    for (const meta of Object.values(byId) as Record<string, unknown>[]) {
      expect(meta.zone_note).toBe('approximate control-zone radius, illustrative only');
      // Compliance guard: search-page link-out only, never an embedded audio stream.
      expect(String(meta.liveatc_url)).toMatch(/^https:\/\/www\.liveatc\.net\/search\/\?icao=/);
      expect(String(meta.liveatc_url)).not.toMatch(/\.pls|\.m3u|\.mp3/i);
    }
  });
});
