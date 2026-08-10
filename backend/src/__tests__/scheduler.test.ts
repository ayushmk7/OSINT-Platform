// Mock the network so pollSource runs the real parse -> map -> persist path against a
// fixed fixture (no live HTTP).
jest.mock('../engine/http-fetcher', () => ({ fetchUrl: jest.fn() }));

import Database from 'better-sqlite3';
import path from 'path';
import { initDatabase, closeDatabase } from '../db/database';
import { IngestionScheduler } from '../engine/scheduler';
import { SourceConfig } from '../engine/yaml-loader';
import { fetchUrl } from '../engine/http-fetcher';

const mockFetch = fetchUrl as jest.Mock;

function insertTestSource(db: Database.Database): void {
  db.prepare(
    `INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
     VALUES ('test_src', 'Test', 'test', 'http_poll', 'http://x', 60, 1)`
  ).run();
}

const appendConfig: SourceConfig = {
  name: 'test_src',
  source_type: 'test',
  layer_type: 'aircraft',
  display_name: 'Test',
  enabled: true,
  transport: { type: 'http_poll', url: 'http://x', interval: '60s' },
  parser: { format: 'json' },
  entity: { external_id: 'id', name: 'id', category: 'aircraft' },
  observation: { latitude: 'lat', longitude: 'lon', timestamp: 'ts' },
  recording: { mode: 'append' }
};

async function pollOnce(db: Database.Database, config: SourceConfig): Promise<number> {
  return new IngestionScheduler(db, '/x').pollSource(config);
}

describe('Ingestion Scheduler', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
    jest.clearAllMocks();
  });

  it('should register sources into database upon initialization', () => {
    const sourcesDir = path.resolve(__dirname, '../../../sources.d');
    const scheduler = new IngestionScheduler(db, sourcesDir);
    scheduler.initSources();

    const sources = db.prepare('SELECT * FROM sources').all() as any[];
    expect(sources.length).toBeGreaterThanOrEqual(4);
    const usgs = sources.find((s) => s.id === 'usgs_earthquakes');
    expect(usgs.update_interval_sec).toBe(60);
    expect(usgs.enabled).toBe(1);
  });

  it('should be safe to re-register sources (idempotent initSources)', () => {
    const sourcesDir = path.resolve(__dirname, '../../../sources.d');
    const scheduler = new IngestionScheduler(db, sourcesDir);
    scheduler.initSources();
    const first = (db.prepare('SELECT COUNT(*) AS c FROM sources').get() as any).c;
    scheduler.initSources();
    const second = (db.prepare('SELECT COUNT(*) AS c FROM sources').get() as any).c;
    expect(second).toBe(first);
  });

  it('does NOT duplicate observations across repeated polls (idempotency)', async () => {
    insertTestSource(db);

    // Same fixture (same entity + same timestamp) returned every poll.
    const fixture = JSON.stringify([{ id: 'e1', lat: 10, lon: 20, ts: 1700000000000 }]);
    mockFetch.mockResolvedValue(fixture);

    const scheduler = new IngestionScheduler(db, '/does-not-exist');
    for (let i = 0; i < 6; i++) {
      await scheduler.pollSource(appendConfig);
    }

    const obs = (db.prepare('SELECT COUNT(*) AS c FROM observations').get() as any).c;
    const ent = (db.prepare('SELECT COUNT(*) AS c FROM entities').get() as any).c;
    const distinct = (
      db
        .prepare(
          'SELECT COUNT(*) AS c FROM (SELECT DISTINCT entity_id, timestamp FROM observations)'
        )
        .get() as any
    ).c;
    expect(ent).toBe(1);
    expect(obs).toBe(1); // 6 polls of identical data -> ONE observation, not six
    expect(obs).toBe(distinct);
  });

  it('appends a new observation only when the position/instant actually changes', async () => {
    insertTestSource(db);
    const scheduler = new IngestionScheduler(db, '/x');

    mockFetch.mockResolvedValue(
      JSON.stringify([{ id: 'e1', lat: 10, lon: 20, ts: 1700000000000 }])
    );
    await scheduler.pollSource(appendConfig);
    mockFetch.mockResolvedValue(
      JSON.stringify([{ id: 'e1', lat: 11, lon: 21, ts: 1700000060000 }])
    );
    await scheduler.pollSource(appendConfig);

    const obs = (db.prepare('SELECT COUNT(*) AS c FROM observations').get() as any).c;
    expect(obs).toBe(2); // two distinct instants -> two track points
  });

  it('keeps exactly one observation row per entity in upsert mode and updates it in place', async () => {
    insertTestSource(db);
    const upsertConfig: SourceConfig = { ...appendConfig, recording: { mode: 'upsert' } };
    const scheduler = new IngestionScheduler(db, '/x');

    mockFetch.mockResolvedValue(
      JSON.stringify([{ id: 'e1', lat: 10, lon: 20, ts: 1700000000000 }])
    );
    await scheduler.pollSource(upsertConfig);
    mockFetch.mockResolvedValue(
      JSON.stringify([{ id: 'e1', lat: 44, lon: 55, ts: 1700000060000 }])
    );
    await scheduler.pollSource(upsertConfig);

    const rows = db.prepare('SELECT * FROM observations').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('obs_e1');
    expect(rows[0].latitude).toBe(44);
    expect(rows[0].longitude).toBe(55);
  });

  it('skips records with missing coordinates instead of plotting them at (0,0)', async () => {
    insertTestSource(db);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scheduler = new IngestionScheduler(db, '/x');

    mockFetch.mockResolvedValue(
      JSON.stringify([
        { id: 'good', lat: 10, lon: 20, ts: 1700000000000 },
        { id: 'nogeo', ts: 1700000000000 },
        { lat: 5, lon: 5, ts: 1700000000000 }
      ])
    );
    const written = await scheduler.pollSource(appendConfig);

    expect(written).toBe(1);
    const rows = db.prepare('SELECT * FROM entities').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('good');
    expect(rows.some((r) => r.latitude === 0 && r.longitude === 0)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('logs and continues when a poll fails instead of throwing', async () => {
    insertTestSource(db);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = new IngestionScheduler(db, '/x');

    mockFetch.mockRejectedValueOnce(new Error('network down'));
    await expect(scheduler.pollSource(appendConfig)).resolves.toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('test_src'), expect.any(Error));

    mockFetch.mockResolvedValue(JSON.stringify([{ id: 'e1', lat: 1, lon: 2, ts: 1700000000000 }]));
    await expect(scheduler.pollSource(appendConfig)).resolves.toBe(1);
    errorSpy.mockRestore();
  });

  it('emits onEntityUpdate only for new or moved entities', async () => {
    insertTestSource(db);
    const scheduler = new IngestionScheduler(db, '/x');
    const seen: string[] = [];
    scheduler.onEntityUpdate = (entity) => seen.push(`${entity.id}@${entity.latitude}`);

    mockFetch.mockResolvedValue(
      JSON.stringify([{ id: 'e1', lat: 10, lon: 20, ts: 1700000000000 }])
    );
    await scheduler.pollSource(appendConfig); // new -> emit
    await scheduler.pollSource(appendConfig); // unchanged -> silent
    mockFetch.mockResolvedValue(
      JSON.stringify([{ id: 'e1', lat: 12, lon: 20, ts: 1700000060000 }])
    );
    await scheduler.pollSource(appendConfig); // moved -> emit

    expect(seen).toEqual(['e1@10', 'e1@12']);
  });

  it('caps stored observations per entity in append mode (retention)', async () => {
    insertTestSource(db);
    const scheduler = new IngestionScheduler(db, '/x');

    for (let i = 0; i < 250; i++) {
      mockFetch.mockResolvedValue(
        JSON.stringify([{ id: 'e1', lat: 10 + i / 1000, lon: 20, ts: 1700000000000 + i * 1000 }])
      );
      await scheduler.pollSource(appendConfig);
    }

    const obs = (db.prepare('SELECT COUNT(*) AS c FROM observations').get() as any).c;
    expect(obs).toBeLessThanOrEqual(200);
    expect(obs).toBeGreaterThan(0);
  });

  it('applies YAML filter rules and derived metadata end-to-end for a CSV source', async () => {
    db.prepare(
      `INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
       VALUES ('atc_facilities', 'ATC', 'ourairports', 'http_poll', 'http://x', 86400, 1)`
    ).run();

    const atcConfig: SourceConfig = {
      name: 'atc_facilities',
      source_type: 'ourairports',
      layer_type: 'atc_zones',
      display_name: 'ATC Facilities',
      transport: { type: 'http_poll', url: 'http://x', interval: '24h' },
      parser: { format: 'csv', max_records: 100000 },
      filter: [
        { field: 'type', in: ['large_airport', 'medium_airport'] },
        { field: 'icao_code', not_empty: true }
      ],
      entity: {
        external_id: 'icao_code',
        name: 'name',
        category: 'atc_zone',
        metadata: { icao: 'icao_code', iata_code: 'iata_code', airport_type: 'type' },
        derived: {
          radius_km: { from: 'type', map: { large_airport: 9, medium_airport: 5 }, default: 5 },
          zone_note: { template: 'approximate control-zone radius, illustrative only' },
          liveatc_url: { template: 'https://www.liveatc.net/search/?icao={icao_code|lower}' }
        }
      },
      observation: { latitude: 'latitude_deg', longitude: 'longitude_deg', altitude: '0' },
      recording: { mode: 'upsert' }
    };

    // Real OurAirports column layout: two keepers, plus a heliport, a closed field and a
    // large_airport with no ICAO code — all three must be filtered out.
    const csv = [
      '"id","type","name","latitude_deg","longitude_deg","municipality","icao_code","iata_code"',
      '1,"large_airport","London Heathrow Airport",51.4706,-0.461941,"London","EGLL","LHR"',
      '2,"medium_airport","Inverness Airport",57.5425,-4.0475,"Inverness","EGPE","INV"',
      '3,"heliport","Some Heliport",10.0,10.0,"Nowhere","XXXX",""',
      '4,"closed","Closed Field",11.0,11.0,"Nowhere","YYYY",""',
      '5,"large_airport","No ICAO Airport",12.0,12.0,"Nowhere","",""'
    ].join('\n');
    mockFetch.mockResolvedValue(csv);

    const scheduler = new IngestionScheduler(db, '/x');
    const written = await scheduler.pollSource(atcConfig);
    expect(written).toBe(2);

    const rows = db
      .prepare('SELECT * FROM entities WHERE category = ? ORDER BY id')
      .all('atc_zone') as any[];
    expect(rows.map((r) => r.id)).toEqual(['EGLL', 'EGPE']);

    const heathrow = JSON.parse(rows[0].metadata);
    expect(heathrow.radius_km).toBe(9);
    expect(heathrow.liveatc_url).toBe('https://www.liveatc.net/search/?icao=egll');
    expect(heathrow.zone_note).toBe('approximate control-zone radius, illustrative only');
    expect(heathrow.icao).toBe('EGLL');
    expect(heathrow.iata_code).toBe('LHR');

    expect(JSON.parse(rows[1].metadata).radius_km).toBe(5);
    expect(JSON.parse(rows[1].metadata).liveatc_url).toBe(
      'https://www.liveatc.net/search/?icao=egpe'
    );

    // Static reference data -> upsert: re-polling never grows the observation table.
    await scheduler.pollSource(atcConfig);
    const obs = (db.prepare('SELECT COUNT(*) AS c FROM observations').get() as any).c;
    expect(obs).toBe(2);
  });

  it('does not report filtered-out records as malformed', async () => {
    insertTestSource(db);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const filteredConfig: SourceConfig = {
      ...appendConfig,
      filter: [{ field: 'keep', in: ['yes'] }]
    };

    mockFetch.mockResolvedValue(
      JSON.stringify([
        { id: 'a', keep: 'yes', lat: 1, lon: 2, ts: 1700000000000 },
        { id: 'b', keep: 'no', lat: 3, lon: 4, ts: 1700000000000 }
      ])
    );
    expect(await pollOnce(db, filteredConfig)).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('start() polls immediately and stop() clears every timer', async () => {
    const sourcesDir = path.resolve(__dirname, '../../../sources.d');
    mockFetch.mockResolvedValue(JSON.stringify([]));
    const scheduler = new IngestionScheduler(db, sourcesDir);
    scheduler.start();
    expect(mockFetch).toHaveBeenCalled();
    scheduler.stop();
    // Allow the immediate in-flight polls to settle before the db is closed.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
