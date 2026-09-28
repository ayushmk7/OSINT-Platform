import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { initDatabase, closeDatabase } from './db/database';
import { createApp } from './app';
import { IngestionScheduler } from './engine/scheduler';
import { setupWebSocketServer, WS_PATH } from './websocket/server';
import { broadcaster } from './websocket/broadcaster';
import { startRetention } from './engine/retention';

dotenv.config();

const PORT = process.env.PORT || 4000;
const SOURCES_DIR = process.env.SOURCES_DIR || path.resolve(__dirname, '../../sources.d');

const db = initDatabase(process.env.DB_PATH || 'mk-osint.db');
const app = createApp(db);

// ONE http server: Express handles REST, the WebSocket server attaches to the same
// listener on WS_PATH. `app.listen()` alone leaves nothing for the WS upgrade to bind to.
const server = http.createServer(app);
const wss = setupWebSocketServer(server);

const scheduler = new IngestionScheduler(db, SOURCES_DIR);

// THE WIRE. Without this, sockets connect and receive `initial_state` but the globe never
// updates, because nothing ever pushes a live frame.
scheduler.onEntityUpdate = (entity) => broadcaster.broadcastEntityUpdate(entity);

let retention: { stop: () => void } | null = null;

server.listen(PORT, () => {
  console.log(`MK-OSINT backend running on port ${PORT} (ws ${WS_PATH})`);
  if (process.env.INGEST_ENABLED === 'false') {
    console.log('Ingestion engine disabled (INGEST_ENABLED=false)');
    scheduler.initSources();
  } else {
    console.log(`Ingestion engine starting from ${SOURCES_DIR}`);
    scheduler.start();
  }
  // TTL expiry + DB size guard (MKOSINT_DB_MAX_MB), every 60s.
  retention = startRetention(db, {
    getConfigs: () => scheduler.getConfigs(),
    onRemove: (ids) => broadcaster.broadcastEntityRemove(ids)
  });
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down...`);
  scheduler.stop();
  retention?.stop();
  for (const client of wss.clients) {
    client.terminate();
  }
  wss.close();
  // Backstop for `docker stop` (SIGKILL after 10s): if a lingering HTTP connection keeps
  // server.close() from finishing, still close the DB and exit cleanly. unref() so the timer
  // itself never holds the process open.
  setTimeout(() => {
    console.warn('Shutdown timed out waiting for connections; forcing exit');
    closeDatabase(db);
    process.exit(0);
  }, 5000).unref();
  server.close(() => {
    closeDatabase(db);
    process.exit(0);
  });
  // Drop idle keep-alive sockets so close() completes promptly instead of waiting them out.
  server.closeAllConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
