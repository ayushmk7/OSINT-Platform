import request from 'supertest';
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
