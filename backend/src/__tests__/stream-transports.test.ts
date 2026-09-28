import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { initDatabase, closeDatabase } from '../db/database';
import { parsePayload } from '../engine/parsers';
import { IngestionScheduler } from '../engine/scheduler';
import { SseDecoder, startSseStream } from '../engine/transports/sse';
import { startWebSocketStream } from '../engine/transports/websocket';

function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) resolve();
      else if (Date.now() > deadline) reject(new Error('waitFor timed out'));
      else setTimeout(tick, 10);
    };
    tick();
  });
}

async function startWsServer(): Promise<{
  wss: WebSocketServer;
  url: string;
  received: string[];
  upgrades: http.IncomingMessage[];
  close: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.on('listening', () => resolve()));
  const received: string[] = [];
  const upgrades: http.IncomingMessage[] = [];
  wss.on('connection', (socket, req) => {
    upgrades.push(req);
    socket.on('message', (data) => received.push(data.toString()));
  });
  const { port } = wss.address() as AddressInfo;
  return {
    wss,
    url: `ws://127.0.0.1:${port}/feed`,
    received,
    upgrades,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      })
  };
}

const parseJson =
  (recordsPath?: string) =>
  (message: string): unknown[] =>
    parsePayload(message, 'json', recordsPath);

describe('websocket transport', () => {
  afterEach(() => {
    delete process.env.MKOSINT_WS_KEY;
  });

  it('sends subscribe, parses each message with records_path, and batches', async () => {
    process.env.MKOSINT_WS_KEY = 'ws-secret-1';
    const server = await startWsServer();
    const batches: unknown[][] = [];
    const stream = startWebSocketStream(
      {
        type: 'websocket',
        url: server.url + '?k=${MKOSINT_WS_KEY}',
        subscribe: { action: 'subscribe', key: '${MKOSINT_WS_KEY}' },
        auth: { type: 'bearer', token: '${MKOSINT_WS_KEY}' },
        batch_window: '150ms'
      },
      { name: 'ws_test', parse: parseJson('data'), onBatch: (r) => void batches.push(r) }
    );
    try {
      await waitFor(() => server.received.length === 1);
      expect(JSON.parse(server.received[0])).toEqual({ action: 'subscribe', key: 'ws-secret-1' });
      expect(server.upgrades[0].url).toBe('/feed?k=ws-secret-1');
      expect(server.upgrades[0].headers.authorization).toBe('Bearer ws-secret-1');

      const [client] = [...server.wss.clients];
      client.send(JSON.stringify({ data: [{ id: 1 }, { id: 2 }] }));
      client.send(JSON.stringify({ data: { id: 3 } }));
      client.send('not json'); // skipped, stream survives
      await waitFor(() => batches.length > 0);
      expect(batches[0]).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    } finally {
      stream.stop();
      await server.close();
    }
  });

  it('reconnects with backoff after the server drops the connection', async () => {
    const server = await startWsServer();
    const stream = startWebSocketStream(
      {
        type: 'websocket',
        url: server.url,
        subscribe: 'hello',
        retry: { initial_delay: '50ms', max_delay: '100ms' }
      },
      { name: 'ws_reconnect', parse: parseJson(), onBatch: () => undefined }
    );
    try {
      await waitFor(() => server.received.length === 1);
      for (const client of server.wss.clients) client.terminate();
      await waitFor(() => server.received.length === 2);
      expect(server.received).toEqual(['hello', 'hello']); // subscribe re-sent on reconnect
    } finally {
      stream.stop();
      await server.close();
    }
  });
});

describe('sse transport', () => {
  it('decodes events split across chunks and ignores comments', () => {
    const events: string[] = [];
    const d = new SseDecoder((e) => events.push(e));
    d.push(': comment\ndata: {"a"');
    d.push(':1}\n\nid: 7\ndata: line1\r\ndata: line2\r\n\r');
    d.push('\n');
    expect(events).toEqual(['{"a":1}', 'line1\nline2']);
    expect(d.lastEventId).toBe('7');
  });

  it('streams events into batches over fetch', async () => {
    let res!: http.ServerResponse;
    let seenAccept = '';
    const server = http.createServer((req, r) => {
      seenAccept = String(req.headers.accept);
      res = r;
      r.writeHead(200, { 'Content-Type': 'text/event-stream' });
      r.write(': hi\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const batches: unknown[][] = [];
    const stream = startSseStream(
      { type: 'sse', url: `http://127.0.0.1:${port}/events`, batch_window: '100ms' },
      { name: 'sse_test', parse: parseJson(), onBatch: (r) => void batches.push(r) }
    );
    try {
      await waitFor(() => res !== undefined);
      res.write('data: {"id":1}\n\n');
      res.write('data: [{"id":2},{"id":3}]\n\n');
      await waitFor(() => batches.length > 0);
      expect(batches.flat()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(seenAccept).toBe('text/event-stream');
    } finally {
      stream.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('scheduler with a websocket source', () => {
  it('ingests streamed batches through the same map/persist pipeline', async () => {
    const server = await startWsServer();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkosint-ws-'));
    fs.writeFileSync(
      path.join(dir, 'stream.yaml'),
      `
name: ws_src
source_type: test
layer_type: maritime
display_name: WS
transport:
  type: websocket
  url: ${server.url}
  batch_window: 100ms
parser:
  format: json
  records_path: msg
entity:
  external_id: mmsi
  name: mmsi
  category: maritime
observation:
  latitude: lat
  longitude: lon
recording:
  mode: upsert
`
    );
    const db = initDatabase(':memory:');
    const scheduler = new IngestionScheduler(db, dir);
    const updates: string[] = [];
    scheduler.onEntityUpdate = (e) => updates.push(e.id);
    scheduler.start();
    try {
      await waitFor(() => server.wss.clients.size === 1);
      const [client] = [...server.wss.clients] as WebSocket[];
      client.send(JSON.stringify({ msg: { mmsi: 111, lat: 1, lon: 2 } }));
      client.send(JSON.stringify({ msg: { mmsi: 222, lat: 3, lon: 4 } }));
      await waitFor(() => updates.length === 2);
      const rows = db.prepare('SELECT id, latitude FROM entities ORDER BY id').all();
      expect(rows).toEqual([
        { id: 'ws_src:111', latitude: 1 },
        { id: 'ws_src:222', latitude: 3 }
      ]);
    } finally {
      scheduler.stop();
      await server.close();
      closeDatabase(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
