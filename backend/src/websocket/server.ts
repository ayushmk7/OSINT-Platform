import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { broadcaster } from './broadcaster';
import { getAllSources, getInitialSnapshot } from '../db/queries';

/** Single canonical WS path — shared by server and client (the client uses the same string). */
export const WS_PATH = '/ws/telemetry';

/** Heartbeat cadence: ping every 30s, terminate a socket that missed the previous round. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Entities kept per category in the `initial_state` snapshot. */
export const SNAPSHOT_PER_CATEGORY = 300;

interface ExtWebSocket extends WebSocket {
  isAlive?: boolean;
}

export interface WebSocketServerOptions {
  /** Overridable so tests can exercise the heartbeat without waiting 30 seconds. */
  heartbeatIntervalMs?: number;
  perCategory?: number;
}

export function setupWebSocketServer(
  server: HttpServer,
  options: WebSocketServerOptions = {}
): WebSocketServer {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const perCategory = options.perCategory ?? SNAPSHOT_PER_CATEGORY;

  const wss = new WebSocketServer({ server, path: WS_PATH });

  wss.on('connection', (ws: ExtWebSocket) => {
    ws.isAlive = true;
    broadcaster.addClient(ws);

    // Initial state on connect — category-BALANCED, not newest-500-globally, so every
    // category present in the DB is visible on first paint.
    try {
      const sources = getAllSources();
      const entities = getInitialSnapshot(perCategory);
      ws.send(
        JSON.stringify({
          type: 'initial_state',
          timestamp: new Date().toISOString(),
          data: { sources, entities }
        })
      );
    } catch (err) {
      console.error('[ws] Failed to send initial state to client:', err);
    }

    // Protocol-level pong (what a browser answers automatically).
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'ping') {
          ws.isAlive = true;
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        } else if (parsed.type === 'pong') {
          // Application-level pong, for clients that cannot observe protocol frames.
          ws.isAlive = true;
        }
      } catch (err) {
        console.warn('[ws] Ignoring unparseable client message:', (err as Error).message);
      }
    });

    ws.on('close', () => {
      broadcaster.removeClient(ws);
    });

    ws.on('error', (err) => {
      console.warn('[ws] Client socket error:', err.message);
      broadcaster.removeClient(ws);
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((client: WebSocket) => {
      const ws = client as ExtWebSocket;
      if (ws.isAlive === false) {
        broadcaster.removeClient(ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
      // Also emit an application-level ping so browser clients (which cannot see protocol
      // frames from JS) can answer with `{ "type": "pong" }`.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
      }
    });
  }, heartbeatIntervalMs);

  // Never hold the process (or a Jest worker) open just for the heartbeat.
  interval.unref();

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}
