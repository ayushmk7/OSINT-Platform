import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { initDatabase, closeDatabase } from './db/database';
import { createApp } from './app';
import { IngestionScheduler } from './engine/scheduler';
import { setupWebSocketServer, WS_PATH } from './websocket/server';
import { broadcaster } from './websocket/broadcaster';
import { startAnalysisEngine } from './analysis';

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

// AI analysis (analysis.d/). Inert — one info log — unless an LLM provider is configured.
const analysisEngine = startAnalysisEngine(db, {
  onInsight: (insight) => broadcaster.broadcastAiInsight(insight)
});

server.listen(PORT, () => {
  console.log(`MK-OSINT backend running on port ${PORT} (ws ${WS_PATH})`);
  if (process.env.INGEST_ENABLED === 'false') {
    console.log('Ingestion engine disabled (INGEST_ENABLED=false)');
    scheduler.initSources();
  } else {
    console.log(`Ingestion engine starting from ${SOURCES_DIR}`);
    scheduler.start();
  }
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down...`);
  scheduler.stop();
  analysisEngine?.stop();
  for (const client of wss.clients) {
    client.terminate();
  }
  wss.close();
  server.close(() => {
    closeDatabase(db);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
