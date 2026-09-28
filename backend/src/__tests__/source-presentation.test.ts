import path from 'path';
import request from 'supertest';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../db/database';
import { getAllSources } from '../db/queries';
import { createApp } from '../app';
import { IngestionScheduler } from '../engine/scheduler';
import { TelemetryBroadcaster } from '../websocket/broadcaster';

const SOURCES_DIR = path.resolve(__dirname, '../../../sources.d');

describe('source layer/display exposure', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:');
    new IngestionScheduler(db, SOURCES_DIR).initSources();
  });
  afterEach(() => closeDatabase(db));

  it('persists each source layer + display and serves them parsed on GET /api/sources', async () => {
    const res = await request(createApp(db)).get('/api/sources');
    expect(res.status).toBe(200);
    const usgs = res.body.sources.find((s: { id: string }) => s.id === 'usgs_earthquakes');
    expect(usgs.layer).toEqual({
      id: 'geological',
      name: 'Earthquakes',
      group: 'Hazards',
      description: 'USGS, past hour'
    });
    expect(usgs.display).toMatchObject({
      declared: true,
      icon: 'quake',
      ttl: '24h',
      ttl_seconds: 86400
    });
    expect(usgs.display.color_by.field).toBe('metadata.magnitude');
    expect(usgs.display.fields[0]).toMatchObject({ path: 'metadata.magnitude', format: 'number' });
  });

  it('returns null layer/display for a row that predates them', () => {
    db.prepare(
      `INSERT INTO sources (id, name, type, transport, url) VALUES ('legacy', 'L', 't', 'http', 'u')`
    ).run();
    const legacy = getAllSources().find((s) => s.id === 'legacy');
    expect(legacy?.layer).toBeNull();
    expect(legacy?.display).toBeNull();
  });
});

describe('entity_remove broadcast', () => {
  it('sends the removed ids to every open client, and nothing for an empty list', () => {
    const b = new TelemetryBroadcaster();
    const sent: string[] = [];
    b.addClient({ readyState: WebSocket.OPEN, send: (m: string) => sent.push(m) } as never);
    b.broadcastEntityRemove([]);
    b.broadcastEntityRemove(['a:1', 'a:2']);
    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0]);
    expect(frame.type).toBe('entity_remove');
    expect(frame.data).toEqual({ ids: ['a:1', 'a:2'] });
  });
});
