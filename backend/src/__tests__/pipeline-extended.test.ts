// Parsers, expressions, dedupe, max_age, optional geo and orbital propagation, exercised
// through the real mapper / loader / scheduler with the network mocked.
jest.mock('../engine/http-fetcher', () => ({ fetchUrl: jest.fn() }));

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDatabase, initDatabase } from '../db/database';
import { mapRecord, passesFilter } from '../engine/field-mapper';
import { fetchUrl } from '../engine/http-fetcher';
import { IngestionScheduler } from '../engine/scheduler';
import { SourceConfig, loadSourcesFromDir, parseDurationSeconds } from '../engine/yaml-loader';
import { ISS_TLE } from './fixtures/orbital';

const mockFetch = fetchUrl as jest.Mock;

type Row = Record<string, unknown>;

function base(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    name: 'test_src',
    source_type: 'test',
    layer_type: 'test',
    display_name: 'Test',
    transport: { type: 'http_poll', url: 'http://x', interval: '60s' },
    parser: { format: 'json' },
    entity: { external_id: 'id', name: 'id' },
    observation: { latitude: 'lat', longitude: 'lon' },
    ...overrides
  };
}

function insertSource(db: Database.Database, id = 'test_src'): void {
  db.prepare(
    `INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
     VALUES (?, 'Test', 'test', 'http_poll', 'http://x', 60, 1)`
  ).run(id);
}

const count = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;

describe('expressions in mappings and filters', () => {
  const config = base({
    lookups: { types: { A320: 'Airbus A320' } },
    entity: {
      external_id: 'hex',
      name: '=trim(callsign) ?? hex',
      metadata: {
        model: "=lookup('types', t, 'unknown')",
        plain: 'callsign',
        label: "=concat(upper(hex), '/', t)"
      }
    },
    observation: {
      latitude: 'lat',
      longitude: 'lon',
      altitude: "=alt_baro == 'ground' ? 0 : alt_baro * 0.3048",
      timestamp: '=unix_ms(seen)'
    }
  });

  it('evaluates =expr values while plain paths keep working', () => {
    const out = mapRecord(
      {
        hex: 'abc',
        callsign: 'UAL1  ',
        t: 'A320',
        lat: 1,
        lon: 2,
        alt_baro: 1000,
        seen: 1700000000
      },
      config,
      'test_src'
    );
    expect(out?.entity.name).toBe('UAL1');
    expect(out?.entity.altitude).toBeCloseTo(304.8);
    expect(out?.entity.timestamp).toBe('2023-11-14T22:13:20.000Z');
    expect(out?.entity.metadata).toEqual({
      model: 'Airbus A320',
      plain: 'UAL1  ',
      label: 'ABC/A320'
    });

    const ground = mapRecord(
      { hex: 'def', t: 'B738', lat: 1, lon: 2, alt_baro: 'ground' },
      config,
      'test_src'
    );
    expect(ground?.entity.name).toBe('def');
    expect(ground?.entity.altitude).toBe(0);
    expect(ground?.entity.metadata.model).toBe('unknown');
  });

  it('computes coordinates from an expression', () => {
    const c = base({
      observation: { latitude: '=number(split_lat) ?? 0', longitude: '=lon / 1e6' }
    });
    const out = mapRecord({ id: 1, split_lat: '5', lon: 12_000_000 }, c, 's');
    expect(out?.entity.latitude).toBe(5);
    expect(out?.entity.longitude).toBe(12);
  });

  it('filters with expr rules (alone or combined with field rules)', () => {
    expect(passesFilter({ mag: 3 }, [{ expr: 'mag >= 2.5' }])).toBe(true);
    expect(passesFilter({ mag: 2 }, [{ expr: 'mag >= 2.5' }])).toBe(false);
    expect(passesFilter({ mag: 2 }, [{ expr: '=mag < 2.5' }])).toBe(true);
    const rules = [{ expr: "type != 'test'" }, { field: 'id', not_empty: true }];
    expect(passesFilter({ type: 'x', id: '1' }, rules)).toBe(true);
    expect(passesFilter({ type: 'x', id: '' }, rules)).toBe(false);
    expect(passesFilter({ type: 'test', id: '1' }, rules)).toBe(false);
    const lk = { lookups: { allow: { KJFK: true } } };
    expect(passesFilter({ icao: 'KJFK' }, [{ expr: "lookup('allow', icao, false)" }], lk)).toBe(
      true
    );
  });
});

describe('loader: lookups, validation of new blocks, duration days', () => {
  let dir: string;
  const yaml = (extra: string, name = 'src'): string => `
name: ${name}
source_type: t
layer_type: t
display_name: T
transport: { type: http_poll, url: 'http://x', interval: 60s }
parser: { format: json }
entity: { external_id: id, name: id }
observation: { latitude: lat, longitude: lon }
${extra}
`;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-loader-'));
    fs.mkdirSync(path.join(dir, 'lookups'));
    fs.writeFileSync(path.join(dir, 'lookups', 'cc.json'), JSON.stringify({ US: 'United States' }));
    fs.writeFileSync(path.join(dir, 'lookups', 'types.csv'), 'code,label\nA320,Airbus A320\n');
    fs.writeFileSync(path.join(dir, 'lookups', 'wide.csv'), 'code,label,seats\nB738,Boeing,189\n');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('resolves inline, JSON and CSV lookup tables relative to the sources dir', () => {
    fs.writeFileSync(
      path.join(dir, 'a.yaml'),
      yaml(`lookups:
  inline: { a: 1 }
  cc: lookups/cc.json
  types: lookups/types.csv
  wide: lookups/wide.csv`)
    );
    const [cfg] = loadSourcesFromDir(dir);
    expect(cfg.lookups).toEqual({
      inline: { a: 1 },
      cc: { US: 'United States' },
      types: { A320: 'Airbus A320' },
      wide: { B738: { code: 'B738', label: 'Boeing', seats: '189' } }
    });
  });

  it('skips a source whose lookup file is missing or escapes the directory', () => {
    fs.writeFileSync(path.join(dir, 'a.yaml'), yaml('lookups: { x: lookups/nope.json }', 'a'));
    fs.writeFileSync(path.join(dir, 'b.yaml'), yaml('lookups: { x: ../../etc/passwd }', 'b'));
    fs.writeFileSync(path.join(dir, 'c.yaml'), yaml('', 'c'));
    expect(loadSourcesFromDir(dir).map((c) => c.name)).toEqual(['c']);
  });

  it('rejects bad expressions, formats, modes and filter rules', () => {
    fs.writeFileSync(path.join(dir, 'a.yaml'), yaml("filter: [{ expr: 'mag >=' }]", 'a'));
    fs.writeFileSync(path.join(dir, 'b.yaml'), yaml('recording: { mode: sometimes }', 'b'));
    fs.writeFileSync(
      path.join(dir, 'c.yaml'),
      yaml('', 'c').replace('format: json', 'format: yaml')
    );
    fs.writeFileSync(path.join(dir, 'd.yaml'), yaml('filter: [{ in: [1] }]', 'd'));
    fs.writeFileSync(path.join(dir, 'e.yaml'), yaml('recording: { max_age: soon }', 'e'));
    fs.writeFileSync(
      path.join(dir, 'f.yaml'),
      yaml('', 'f').replace('name: id }', "name: '=concat(' }")
    );
    fs.writeFileSync(
      path.join(dir, 'g.yaml'),
      yaml(`recording: { mode: dedupe, dedupe_fields: [title], max_age: 7d }
filter: [{ expr: 'mag >= 2.5' }]`).replace(
        '{ format: json }',
        '{ format: csv, csv: { delimiter: whitespace, has_header: false } }'
      )
    );
    const loaded = loadSourcesFromDir(dir).map((c) => c.name);
    expect(loaded).toEqual(['src']);
    const messages = (console.error as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).toMatch(/invalid expression in filter\[0\]\.expr/);
    expect(messages).toMatch(/invalid recording\.mode/);
    expect(messages).toMatch(/unsupported parser\.format "yaml"/);
    expect(messages).toMatch(/filter\[0\] needs a "field" or an "expr"/);
    expect(messages).toMatch(/invalid recording\.max_age/);
    expect(messages).toMatch(/invalid expression in entity\.name/);
  });

  it('parses day durations', () => {
    expect(parseDurationSeconds('7d', 0)).toBe(604800);
  });
});

describe('scheduler: dedupe, max_age, optional geo, orbital propagation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    insertSource(db);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    closeDatabase(db);
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('dedupe mode: identical content is ignored, changed content is stored', async () => {
    const config = base({
      observation: { latitude: 'lat', longitude: 'lon', timestamp: 'ts' },
      recording: { mode: 'dedupe' }
    });
    const scheduler = new IngestionScheduler(db, '/x');

    mockFetch.mockResolvedValue(JSON.stringify([{ id: 'a', lat: 1, lon: 2, ts: 1000 }]));
    expect(await scheduler.pollSource(config)).toBe(1);
    expect(await scheduler.pollSource(config)).toBe(0);
    expect(scheduler.lastStats.get('test_src')).toMatchObject({ written: 0, duplicates: 1 });
    expect(count(db, 'observations')).toBe(1);

    mockFetch.mockResolvedValue(JSON.stringify([{ id: 'a', lat: 5, lon: 2, ts: 2000 }]));
    expect(await scheduler.pollSource(config)).toBe(1);
    expect(count(db, 'observations')).toBe(2);
    const entity = db.prepare('SELECT latitude FROM entities').get() as Row;
    expect(entity.latitude).toBe(5);
  });

  it('dedupe_fields: only the listed fields form the identity', async () => {
    const config = base({
      recording: { mode: 'dedupe', dedupe_fields: ['title', '=lower(link)'] },
      entity: { external_id: 'id', name: 'title', metadata: { views: 'views' } },
      observation: { latitude: 'lat', longitude: 'lon', timestamp: 'ts' }
    });
    const scheduler = new IngestionScheduler(db, '/x');
    const item = { id: 'n1', title: 'T', link: 'HTTP://E', lat: 1, lon: 1, views: 1, ts: 1000 };

    const updates: string[] = [];
    scheduler.onEntityUpdate = (e) => updates.push(e.id);

    mockFetch.mockResolvedValue(JSON.stringify([item]));
    await scheduler.pollSource(config);
    mockFetch.mockResolvedValue(JSON.stringify([{ ...item, views: 99, link: 'http://e' }]));
    expect(await scheduler.pollSource(config)).toBe(0); // views not part of identity
    mockFetch.mockResolvedValue(JSON.stringify([{ ...item, title: 'T2', ts: 2000 }]));
    expect(await scheduler.pollSource(config)).toBe(1);
    expect(count(db, 'observations')).toBe(2);
    expect(updates).toEqual(['test_src:n1']); // same position -> no second broadcast
  });

  it('dedupe: changed content at the same instant replaces that observation row', async () => {
    const config = base({
      observation: { latitude: 'lat', longitude: 'lon', timestamp: 'ts' },
      recording: { mode: 'dedupe' },
      entity: { external_id: 'id', name: 'title' }
    });
    const scheduler = new IngestionScheduler(db, '/x');
    mockFetch.mockResolvedValue(JSON.stringify([{ id: 'x', title: 'v1', lat: 1, lon: 1, ts: 5 }]));
    await scheduler.pollSource(config);
    mockFetch.mockResolvedValue(JSON.stringify([{ id: 'x', title: 'v2', lat: 1, lon: 1, ts: 5 }]));
    expect(await scheduler.pollSource(config)).toBe(1);
    expect(count(db, 'observations')).toBe(1);
    expect(await scheduler.pollSource(config)).toBe(0); // v2 hash now stored
    expect((db.prepare('SELECT name FROM entities').get() as Row).name).toBe('v2');
  });

  it('recording.max_age drops records older than the window', async () => {
    const config = base({
      observation: { latitude: 'lat', longitude: 'lon', timestamp: 'ts' },
      recording: { mode: 'append', max_age: '1h' }
    });
    const scheduler = new IngestionScheduler(db, '/x');
    const now = Date.now();
    mockFetch.mockResolvedValue(
      JSON.stringify([
        { id: 'old', lat: 1, lon: 1, ts: now - 2 * 3600_000 },
        { id: 'new', lat: 1, lon: 1, ts: now - 60_000 },
        { id: 'untimed', lat: 1, lon: 1 }
      ])
    );
    expect(await scheduler.pollSource(config)).toBe(2);
    expect(scheduler.lastStats.get('test_src')?.stale).toBe(1);
    const ids = (db.prepare('SELECT id FROM entities ORDER BY id').all() as Row[]).map((r) => r.id);
    expect(ids).toEqual(['test_src:new', 'test_src:untimed']);
  });

  const RSS = `<rss xmlns:georss="http://www.georss.org/georss"><channel>
    <item><title>Geo</title><guid>g1</guid><georss:point>10 20</georss:point></item>
    <item><title>Plain</title><guid>g2</guid></item>
  </channel></rss>`;

  it('observation.optional drops un-located records silently and counts them', async () => {
    const rssConfig = base({
      parser: { format: 'rss' },
      entity: { external_id: 'guid', name: 'title', metadata: { link: 'link' } },
      observation: { latitude: 'lat', longitude: 'lon', timestamp: 'published', optional: true },
      recording: { mode: 'dedupe' }
    });
    const scheduler = new IngestionScheduler(db, '/x');
    mockFetch.mockResolvedValue(RSS);
    expect(await scheduler.pollSource(rssConfig)).toBe(1);
    expect(scheduler.lastStats.get('test_src')).toMatchObject({ unlocated: 1, skipped: 0 });
    expect(console.warn).not.toHaveBeenCalled();

    // Without `optional` the same record is a warned skip.
    const strict = { ...rssConfig, observation: { ...rssConfig.observation, optional: false } };
    await scheduler.pollSource(strict);
    expect(scheduler.lastStats.get('test_src')).toMatchObject({ unlocated: 0, skipped: 1 });
    expect(console.warn).toHaveBeenCalled();
  });

  it('parses CSV options end to end', async () => {
    const config = base({
      parser: {
        format: 'csv',
        csv: { delimiter: 'whitespace', has_header: false, comment_prefix: '#' }
      },
      entity: { external_id: 'c0', name: 'c0' },
      observation: { latitude: 'c1', longitude: 'c2' }
    });
    mockFetch.mockResolvedValue('# id lat lon\nA 1 2\nB 3 4\n');
    expect(await new IngestionScheduler(db, '/x').pollSource(config)).toBe(2);
  });

  describe('orbital sources', () => {
    const tleConfig = base({
      transport: { type: 'http_poll', url: 'http://x', interval: '1h', propagate_interval: '10s' },
      parser: { format: 'tle', max_records: 1 },
      entity: { external_id: 'norad_id', name: 'name', metadata: { epoch: 'epoch' } },
      observation: {
        latitude: 'lat',
        longitude: 'lon',
        altitude: 'alt',
        speed: 'speed',
        heading: 'heading',
        timestamp: 'timestamp'
      },
      recording: { mode: 'upsert' }
    });

    it('propagates on poll and re-propagates cached elements without refetching', async () => {
      jest.useFakeTimers({ now: new Date('2008-09-20T13:00:00Z'), doNotFake: ['nextTick'] });
      mockFetch.mockResolvedValue([...ISS_TLE, ...ISS_TLE].join('\n'));
      const scheduler = new IngestionScheduler(db, '/x');

      expect(await scheduler.repropagate(tleConfig)).toBe(0); // nothing cached yet
      expect(mockFetch).not.toHaveBeenCalled();

      expect(await scheduler.pollSource(tleConfig)).toBe(1); // max_records: 1
      const first = db.prepare('SELECT * FROM entities').get() as Row;
      expect(first.id).toBe('test_src:25544');
      expect(first.name).toBe('ISS (ZARYA)');
      expect(Number(first.altitude)).toBeGreaterThan(300_000);
      expect(first.timestamp).toBe('2008-09-20T13:00:00.000Z');

      jest.setSystemTime(new Date('2008-09-20T13:00:10Z'));
      expect(await scheduler.repropagate(tleConfig)).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const second = db.prepare('SELECT * FROM entities').get() as Row;
      expect(second.timestamp).toBe('2008-09-20T13:00:10.000Z');
      expect(second.longitude).not.toBe(first.longitude);
      const obs = db.prepare('SELECT speed, heading FROM observations').get() as Row;
      expect(Number(obs.speed)).toBeGreaterThan(7000);
      expect(count(db, 'observations')).toBe(1);
    });

    it('start() schedules the propagate_interval tick', async () => {
      jest.useFakeTimers({ now: new Date('2008-09-20T13:00:00Z'), doNotFake: ['nextTick'] });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-orbit-'));
      fs.writeFileSync(
        path.join(dir, 'sats.yaml'),
        `name: sats
source_type: tle
layer_type: space
display_name: Sats
transport: { type: http_poll, url: 'http://x', interval: 1h, propagate_interval: 10s }
parser: { format: tle }
entity: { external_id: norad_id, name: name }
observation: { latitude: lat, longitude: lon, altitude: alt, timestamp: timestamp }
recording: { mode: upsert }
`
      );
      mockFetch.mockResolvedValue(ISS_TLE.join('\n'));
      const scheduler = new IngestionScheduler(db, dir);
      const spy = jest.spyOn(scheduler, 'repropagate');
      scheduler.start();
      jest.advanceTimersByTime(25_000);
      expect(spy).toHaveBeenCalledTimes(2);
      scheduler.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
