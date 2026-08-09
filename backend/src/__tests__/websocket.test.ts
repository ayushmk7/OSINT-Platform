import http from 'http';
import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import { setupWebSocketServer, WS_PATH } from '../websocket/server';
import { broadcaster } from '../websocket/broadcaster';
import { initDatabase, closeDatabase } from '../db/database';

const ALL_CATEGORIES = ['satellite', 'aircraft', 'geological', 'radiation', 'maritime'];

let db: Database.Database;
let server: http.Server;
let wss: WebSocketServer;
let port: number;

/** Sockets opened by a test, torn down in afterEach so the broadcaster set stays clean. */
let openSockets: WebSocket[] = [];

/**
 * Frames are buffered from the moment the socket is constructed. `initial_state` is written
 * inside the server's `connection` handler and can land before a test attaches its own
 * listener, so a late `ws.on('message')` would miss it entirely.
 */
const frameBuffers = new WeakMap<WebSocket, Record<string, unknown>[]>();

function connect(targetPort: number = port): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${targetPort}${WS_PATH}`);
    const buffer: Record<string, unknown>[] = [];
    frameBuffers.set(ws, buffer);
    openSockets.push(ws);
    ws.on('message', (raw: WebSocket.RawData) => buffer.push(JSON.parse(raw.toString())));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Consumes the next buffered JSON frame, optionally of a given type. */
async function nextMessage(ws: WebSocket, type?: string, timeoutMs = 4000): Promise<any> {
  const buffer = frameBuffers.get(ws);
  if (!buffer) throw new Error('socket was not created through connect()');

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const index = buffer.findIndex((frame) => !type || frame.type === type);
    if (index >= 0) return buffer.splice(index, 1)[0];
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${type ?? 'any'} frame`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  db = initDatabase(':memory:');

  db.prepare(
    `INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
     VALUES ('s', 'Seed Source', 'test', 'http_poll', 'http://example.com', 30, 1)`
  ).run();

  // Seed every category, with aircraft DOMINATING by both count and recency, to prove the
  // snapshot is category-balanced (aircraft must not crowd the other four out).
  const insert = db.prepare(
    `INSERT INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
     VALUES (?, 's', ?, ?, ?, ?, 0, ?, '{}')`
  );
  ALL_CATEGORIES.filter((c) => c !== 'aircraft').forEach((c, i) =>
    insert.run(`${c}_1`, c, c, i, i, '2026-07-26T00:00:00Z')
  );
  for (let i = 0; i < 1000; i++) {
    insert.run(`aircraft_${i}`, 'aircraft', `AC${i}`, i % 80, i % 170, '2026-07-27T00:00:00Z');
  }

  const app = express();
  server = http.createServer(app);
  wss = setupWebSocketServer(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterEach(async () => {
  for (const ws of openSockets) {
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  openSockets = [];
  // Let the server observe the closes before the next test samples the client count.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

afterAll(async () => {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase(db);
});

describe('WebSocket Telemetry Server', () => {
  it('serves the canonical /ws/telemetry path', () => {
    expect(WS_PATH).toBe('/ws/telemetry');
  });

  it('sends initial_state on connection with sources and entities', async () => {
    const ws = await connect();
    const msg = await nextMessage(ws);

    expect(msg.type).toBe('initial_state');
    expect(typeof msg.timestamp).toBe('string');
    expect(Array.isArray(msg.data.sources)).toBe(true);
    expect(msg.data.sources[0].id).toBe('s');
    expect(Array.isArray(msg.data.entities)).toBe(true);
    expect(msg.data.entities.length).toBeGreaterThan(0);
    expect(msg.data.entities[0]).toHaveProperty('latitude');
    expect(msg.data.entities[0]).toHaveProperty('longitude');
  });

  it('initial_state snapshot is category-balanced (every category present)', async () => {
    const ws = await connect();
    const msg = await nextMessage(ws, 'initial_state');

    const categories = new Set(msg.data.entities.map((e: { category: string }) => e.category));
    // Despite 1000 fresher aircraft rows, the other four categories must still appear.
    for (const c of ALL_CATEGORIES) {
      expect(categories.has(c)).toBe(true);
    }
    // Capped at 300 aircraft + 1 of each remaining category.
    expect(msg.data.entities.length).toBe(304);
  });

  it('broadcasts entity_update frames to connected clients', async () => {
    const ws = await connect();
    await nextMessage(ws, 'initial_state');

    const updatePromise = nextMessage(ws, 'entity_update');
    broadcaster.broadcastEntityUpdate({
      id: 'ent_test',
      source_id: 's',
      category: 'satellite',
      name: 'Test Sat',
      latitude: 1.5,
      longitude: 2.5,
      altitude: 400000,
      timestamp: '2026-07-27T12:00:00Z'
    });

    const msg = await updatePromise;
    expect(msg.type).toBe('entity_update');
    expect(typeof msg.timestamp).toBe('string');
    expect(msg.data.id).toBe('ent_test');
    expect(msg.data.name).toBe('Test Sat');
    expect(msg.data.latitude).toBe(1.5);
  });

  it('fans a broadcast out to every connected client', async () => {
    const a = await connect();
    const b = await connect();
    await Promise.all([nextMessage(a, 'initial_state'), nextMessage(b, 'initial_state')]);

    const both = Promise.all([nextMessage(a, 'entity_update'), nextMessage(b, 'entity_update')]);
    broadcaster.broadcastEntityUpdate({ id: 'fanout_1' });

    const [msgA, msgB] = await both;
    expect(msgA.data.id).toBe('fanout_1');
    expect(msgB.data.id).toBe('fanout_1');
  });

  it('answers an application-level ping with a pong', async () => {
    const ws = await connect();
    await nextMessage(ws, 'initial_state');

    const pongPromise = nextMessage(ws, 'pong');
    ws.send(JSON.stringify({ type: 'ping' }));

    const pong = await pongPromise;
    expect(pong.type).toBe('pong');
    expect(typeof pong.timestamp).toBe('string');
  });

  it('ignores malformed client messages without dropping the socket', async () => {
    const ws = await connect();
    await nextMessage(ws, 'initial_state');

    ws.send('this is not json');
    // The socket must survive and still answer a subsequent valid ping.
    const pongPromise = nextMessage(ws, 'pong');
    ws.send(JSON.stringify({ type: 'ping' }));
    await pongPromise;
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('registers and deregisters clients with the broadcaster', async () => {
    const before = broadcaster.getClientCount();
    const ws = await connect();
    await nextMessage(ws, 'initial_state');
    expect(broadcaster.getClientCount()).toBe(before + 1);

    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(broadcaster.getClientCount()).toBe(before);
  });
});

describe('WebSocket heartbeat', () => {
  let hbServer: http.Server;
  let hbWss: WebSocketServer;
  let hbPort: number;

  beforeAll(async () => {
    hbServer = http.createServer(express());
    hbWss = setupWebSocketServer(hbServer, { heartbeatIntervalMs: 80 });
    await new Promise<void>((resolve) => {
      hbServer.listen(0, '127.0.0.1', () => {
        hbPort = (hbServer.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => hbWss.close(() => resolve()));
    await new Promise<void>((resolve) => hbServer.close(() => resolve()));
  });

  it('emits periodic ping frames and keeps a responsive socket open', async () => {
    const ws = await connect(hbPort);
    await nextMessage(ws, 'initial_state');

    const ping = await nextMessage(ws, 'ping', 2000);
    expect(ping.type).toBe('ping');

    // A responsive client (ws auto-pongs protocol frames) survives several heartbeats.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('terminates a socket that missed the previous heartbeat', async () => {
    const ws = await connect(hbPort);
    await nextMessage(ws, 'initial_state');

    // Simulate a dead peer: mark the server-side socket as having missed its pong.
    const serverSocket = [...hbWss.clients][hbWss.clients.size - 1] as WebSocket & {
      isAlive?: boolean;
    };
    const countBefore = broadcaster.getClientCount();
    serverSocket.isAlive = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket was not terminated')), 2000);
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(broadcaster.getClientCount()).toBe(countBefore - 1);
  });
});
