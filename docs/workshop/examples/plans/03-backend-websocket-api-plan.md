# Implementation Plan: 03 - Backend REST & Real-Time WebSocket API

This step-by-step TDD implementation plan details the creation of the Express REST API routes (`/api/sources`, `/api/entities`, `/api/observations`) and the real-time WebSocket server (`/ws/telemetry`) with telemetry broadcasting and heartbeat ping/pong management for MK-OSINT.

---

## Task 1: Database Query Helpers & Express REST API Routes

- [ ] **Step 1.1: Create Database Query Helpers (`backend/src/db/queries.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/db/queries.ts`
  ```typescript
  import { getDatabase } from './database';

  export interface EntityFilterOptions {
    category?: string;
    source_id?: string;
    min_lat?: number;
    max_lat?: number;
    min_lon?: number;
    max_lon?: number;
    limit?: number;
    offset?: number;
  }

  export interface ObservationFilterOptions {
    entity_id?: string;
    source_id?: string;
    limit?: number;
    offset?: number;
  }

  export function getAllSources() {
    const db = getDatabase();
    return db.prepare('SELECT * FROM sources ORDER BY id ASC').all();
  }

  export function getEntities(options: EntityFilterOptions = {}) {
    const db = getDatabase();
    const limit = Math.min(options.limit ?? 100, 1000);
    const offset = options.offset ?? 0;

    let query = 'SELECT * FROM entities WHERE 1=1';
    const params: any[] = [];

    if (options.category) {
      query += ' AND category = ?';
      params.push(options.category);
    }
    if (options.source_id) {
      query += ' AND source_id = ?';
      params.push(options.source_id);
    }
    if (options.min_lat !== undefined) {
      query += ' AND latitude >= ?';
      params.push(options.min_lat);
    }
    if (options.max_lat !== undefined) {
      query += ' AND latitude <= ?';
      params.push(options.max_lat);
    }
    if (options.min_lon !== undefined) {
      query += ' AND longitude >= ?';
      params.push(options.min_lon);
    }
    if (options.max_lon !== undefined) {
      query += ' AND longitude <= ?';
      params.push(options.max_lon);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const entities = db.prepare(query).all(params);
    return entities;
  }

  export function getObservations(options: ObservationFilterOptions = {}) {
    const db = getDatabase();
    const limit = Math.min(options.limit ?? 100, 1000);
    const offset = options.offset ?? 0;

    let query = 'SELECT * FROM observations WHERE 1=1';
    const params: any[] = [];

    if (options.entity_id) {
      query += ' AND entity_id = ?';
      params.push(options.entity_id);
    }
    if (options.source_id) {
      query += ' AND source_id = ?';
      params.push(options.source_id);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(query).all(params);
  }

  // Category-BALANCED snapshot for initial_state. A global "ORDER BY timestamp DESC LIMIT 500"
  // lets aircraft (freshest timestamps) crowd out every other category. Take the newest
  // perCategory rows per category so all categories appear on first paint.
  export function getInitialSnapshot(perCategory = 300) {
    const db = getDatabase();
    return db
      .prepare(
        `SELECT id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata
         FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY timestamp DESC) AS rn
           FROM entities
         )
         WHERE rn <= ?`
      )
      .all(perCategory);
  }
  ```

- [ ] **Step 1.2: Implement Sources Route (`backend/src/api/routes/sources.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/api/routes/sources.ts`
  ```typescript
  import { Router, Request, Response } from 'express';
  import { getAllSources } from '../../db/queries';

  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const sources = getAllSources();
      res.json({ sources });
    } catch (error: any) {
      res.status(500).json({
        status: 500,
        error: 'Internal Server Error',
        message: error.message || 'Failed to fetch sources',
      });
    }
  });

  export default router;
  ```

- [ ] **Step 1.3: Implement Entities Route (`backend/src/api/routes/entities.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/api/routes/entities.ts`
  ```typescript
  import { Router, Request, Response } from 'express';
  import { getEntities } from '../../db/queries';

  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const source_id = req.query.source_id as string | undefined;
      const min_lat = req.query.min_lat ? parseFloat(req.query.min_lat as string) : undefined;
      const max_lat = req.query.max_lat ? parseFloat(req.query.max_lat as string) : undefined;
      const min_lon = req.query.min_lon ? parseFloat(req.query.min_lon as string) : undefined;
      const max_lon = req.query.max_lon ? parseFloat(req.query.max_lon as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const entities = getEntities({
        category,
        source_id,
        min_lat,
        max_lat,
        min_lon,
        max_lon,
        limit,
        offset,
      });

      res.json({
        total: entities.length,
        limit,
        offset,
        entities,
      });
    } catch (error: any) {
      res.status(500).json({
        status: 500,
        error: 'Internal Server Error',
        message: error.message || 'Failed to fetch entities',
      });
    }
  });

  export default router;
  ```

- [ ] **Step 1.4: Implement Observations Route (`backend/src/api/routes/observations.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/api/routes/observations.ts`
  ```typescript
  import { Router, Request, Response } from 'express';
  import { getObservations } from '../../db/queries';

  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const entity_id = req.query.entity_id as string | undefined;
      const source_id = req.query.source_id as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const observations = getObservations({
        entity_id,
        source_id,
        limit,
        offset,
      });

      res.json({
        total: observations.length,
        limit,
        offset,
        observations,
      });
    } catch (error: any) {
      res.status(500).json({
        status: 500,
        error: 'Internal Server Error',
        message: error.message || 'Failed to fetch observations',
      });
    }
  });

  export default router;
  ```

- [ ] **Step 1.5: Register Routes in Express App Router (`backend/src/api/index.ts` & `backend/src/app.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/api/index.ts`
  ```typescript
  import { Router } from 'express';
  import sourcesRouter from './routes/sources';
  import entitiesRouter from './routes/entities';
  import observationsRouter from './routes/observations';

  const apiRouter = Router();

  apiRouter.use('/sources', sourcesRouter);
  apiRouter.use('/entities', entitiesRouter);
  apiRouter.use('/observations', observationsRouter);

  export default apiRouter;
  ```

- [ ] **Step 1.6: Write Integration Tests for REST Routes (`backend/src/__tests__/routes.test.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/__tests__/routes.test.ts`
  ```typescript
  import request from 'supertest';
  import express from 'express';
  import apiRouter from '../api';
  import { initDatabase, getDatabase } from '../db/database';

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  beforeAll(() => {
    initDatabase(':memory:');
    const db = getDatabase();
    
    // Insert seed source
    db.prepare(`
      INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
      VALUES ('test_src', 'Test Source', 'test', 'http_poll', 'http://example.com', 60, 1)
    `).run();

    // Insert seed entity
    db.prepare(`
      INSERT INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
      VALUES ('ent_1', 'test_src', 'satellite', 'ISS', 45.0, 10.0, 400000.0, '2026-07-26T00:00:00Z', '{}')
    `).run();

    // Insert seed observation
    db.prepare(`
      INSERT INTO observations (id, entity_id, source_id, latitude, longitude, altitude, speed, heading, timestamp, raw_payload)
      VALUES ('obs_1', 'ent_1', 'test_src', 45.0, 10.0, 400000.0, 7700.0, 90.0, '2026-07-26T00:00:00Z', '{}')
    `).run();
  });

  describe('REST API Routes', () => {
    test('GET /api/sources returns list of sources', async () => {
      const res = await request(app).get('/api/sources');
      expect(res.status).toBe(200);
      expect(res.body.sources).toBeDefined();
      expect(res.body.sources.length).toBeGreaterThan(0);
    });

    test('GET /api/entities returns entities with category filter', async () => {
      const res = await request(app).get('/api/entities?category=satellite');
      expect(res.status).toBe(200);
      expect(res.body.entities.length).toBe(1);
      expect(res.body.entities[0].id).toBe('ent_1');
    });

    test('GET /api/entities supports spatial bounding box filter', async () => {
      const res = await request(app).get('/api/entities?min_lat=40&max_lat=50&min_lon=5&max_lon=15');
      expect(res.status).toBe(200);
      expect(res.body.entities.length).toBe(1);

      const resOut = await request(app).get('/api/entities?min_lat=0&max_lat=10');
      expect(resOut.body.entities.length).toBe(0);
    });

    test('GET /api/observations returns entity observations', async () => {
      const res = await request(app).get('/api/observations?entity_id=ent_1');
      expect(res.status).toBe(200);
      expect(res.body.observations.length).toBe(1);
      expect(res.body.observations[0].entity_id).toBe('ent_1');
    });
  });
  ```

- [ ] **Step 1.7: Run Route Tests**
  Run: `rtk npm test backend/src/__tests__/routes.test.ts`
  Expected Output: All tests pass cleanly.

---

## Task 2: Real-Time WebSocket Telemetry Server & Broadcaster

- [ ] **Step 2.1: Create Telemetry Broadcaster (`backend/src/websocket/broadcaster.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/websocket/broadcaster.ts`
  ```typescript
  import WebSocket from 'ws';

  export class TelemetryBroadcaster {
    private clients: Set<WebSocket> = new Set();

    public addClient(ws: WebSocket): void {
      this.clients.add(ws);
    }

    public removeClient(ws: WebSocket): void {
      this.clients.delete(ws);
    }

    public getClientCount(): number {
      return this.clients.size;
    }

    public broadcastEntityUpdate(entity: any): void {
      const payload = JSON.stringify({
        type: 'entity_update',
        timestamp: new Date().toISOString(),
        data: entity,
      });
      this.sendToAll(payload);
    }

    public broadcastObservation(observation: any): void {
      const payload = JSON.stringify({
        type: 'observation',
        timestamp: new Date().toISOString(),
        data: observation,
      });
      this.sendToAll(payload);
    }

    private sendToAll(message: string): void {
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    }
  }

  export const broadcaster = new TelemetryBroadcaster();
  ```

- [ ] **Step 2.2: Implement WebSocket Server & Heartbeat (`backend/src/websocket/server.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/websocket/server.ts`
  ```typescript
  import { Server as HttpServer } from 'http';
  import WebSocket, { WebSocketServer } from 'ws';
  import { broadcaster } from './broadcaster';
  import { getAllSources, getInitialSnapshot } from '../db/queries';

  // Single canonical WS path — shared by server and client (the client uses the same string).
  export const WS_PATH = '/ws/telemetry';

  interface ExtWebSocket extends WebSocket {
    isAlive?: boolean;
  }

  export function setupWebSocketServer(server: HttpServer): WebSocketServer {
    const wss = new WebSocketServer({ server, path: WS_PATH });

    wss.on('connection', (ws: ExtWebSocket) => {
      ws.isAlive = true;
      broadcaster.addClient(ws);

      // Send initial state upon connection — category-BALANCED, not newest-500-globally.
      try {
        const sources = getAllSources();
        const entities = getInitialSnapshot(300);
        const initialState = JSON.stringify({
          type: 'initial_state',
          timestamp: new Date().toISOString(),
          data: { sources, entities },
        });
        ws.send(initialState);
      } catch (err) {
        console.error('Failed to send initial state to client:', err);
      }

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message: string) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          }
        } catch (_) {}
      });

      ws.on('close', () => {
        broadcaster.removeClient(ws);
      });

      ws.on('error', () => {
        broadcaster.removeClient(ws);
      });
    });

    // Heartbeat check interval (30 seconds)
    const interval = setInterval(() => {
      wss.clients.forEach((ws: WebSocket) => {
        const extWs = ws as ExtWebSocket;
        if (extWs.isAlive === false) {
          broadcaster.removeClient(extWs);
          return extWs.terminate();
        }
        extWs.isAlive = false;
        extWs.ping();
      });
    }, 30000);

    wss.on('close', () => {
      clearInterval(interval);
    });

    return wss;
  }
  ```

- [ ] **Step 2.3: Write WebSocket Server Tests (`backend/src/__tests__/websocket.test.ts`)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/__tests__/websocket.test.ts`
  ```typescript
  import http from 'http';
  import WebSocket from 'ws';
  import express from 'express';
  import { setupWebSocketServer } from '../websocket/server';
  import { broadcaster } from '../websocket/broadcaster';
  import { initDatabase } from '../db/database';

  let server: http.Server;
  let port: number;

  beforeAll((done) => {
    const db = initDatabase(':memory:');
    // Seed all five categories, with aircraft DOMINATING by count + recency, to prove the
    // snapshot is balanced (aircraft must not crowd the others out).
    const cats = ['satellite', 'geological', 'radiation', 'maritime'];
    const insert = db.prepare(
      `INSERT INTO entities (id, source_id, category, name, latitude, longitude, altitude, timestamp, metadata)
       VALUES (?, 's', ?, ?, ?, ?, 0, ?, '{}')`
    );
    cats.forEach((c, i) => insert.run(`${c}_1`, c, c, i, i, '2026-07-26T00:00:00Z'));
    for (let i = 0; i < 1000; i++) {
      insert.run(`aircraft_${i}`, 'aircraft', `AC${i}`, i % 80, i % 170, '2026-07-27T00:00:00Z');
    }
    const app = express();
    server = http.createServer(app);
    setupWebSocketServer(server);
    server.listen(0, () => {
      const addr = server.address() as any;
      port = addr.port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  describe('WebSocket Telemetry Server', () => {
    test('Client receives initial_state on connection', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/telemetry`);

      ws.on('message', (data: string) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('initial_state');
        expect(msg.data.sources).toBeDefined();
        expect(msg.data.entities).toBeDefined();
        ws.close();
        done();
      });
    });

    test('initial_state snapshot is category-balanced (every category present)', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/telemetry`);
      ws.on('message', (data: string) => {
        const msg = JSON.parse(data.toString());
        const categories = new Set(msg.data.entities.map((e: any) => e.category));
        // Despite 1000 aircraft, the other four categories must still appear.
        for (const c of ['satellite', 'aircraft', 'geological', 'radiation', 'maritime']) {
          expect(categories.has(c)).toBe(true);
        }
        ws.close();
        done();
      });
    });

    test('Broadcaster sends entity_update to client', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/telemetry`);
      let count = 0;

      ws.on('message', (data: string) => {
        const msg = JSON.parse(data.toString());
        count++;
        if (count === 1) {
          expect(msg.type).toBe('initial_state');
          // Trigger broadcaster update
          broadcaster.broadcastEntityUpdate({ id: 'ent_test', name: 'Test Sat' });
        } else if (count === 2) {
          expect(msg.type).toBe('entity_update');
          expect(msg.data.id).toBe('ent_test');
          ws.close();
          done();
        }
      });
    });
  });
  ```

- [ ] **Step 2.4: Run WebSocket Tests**
  Run: `rtk npm test backend/src/__tests__/websocket.test.ts`
  Expected Output: All tests pass cleanly.

- [ ] **Step 2.5: Compose everything in `index.ts` (the wiring that was missing)**

  This is the step whose absence caused "the socket connects but nothing ever updates."
  `index.ts` must build ONE `http.Server`, attach the WS server to it, start the scheduler,
  and connect the scheduler's `onEntityUpdate` hook to the broadcaster.

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/index.ts`
  ```typescript
  import http from 'http';
  import path from 'path';
  import express from 'express';
  import cors from 'cors';
  import dotenv from 'dotenv';
  import { initDatabase, getDatabase } from './db/database';
  import apiRouter from './api';
  import { setupWebSocketServer, WS_PATH } from './websocket/server';
  import { broadcaster } from './websocket/broadcaster';
  import { IngestionScheduler } from './engine/scheduler';

  dotenv.config();

  const PORT = 4000; // single canonical port

  initDatabase(process.env.DB_PATH || 'mk-osint.db');

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', apiRouter);

  const server = http.createServer(app);   // one server...
  setupWebSocketServer(server);            // ...the WS server attaches here (path = WS_PATH)

  // Wire ingestion → broadcaster. WITHOUT this line the map never updates live.
  const sourcesDir = path.resolve(__dirname, '../../sources.d');
  const scheduler = new IngestionScheduler(getDatabase(), sourcesDir);
  scheduler.onEntityUpdate = (entity) => broadcaster.broadcastEntityUpdate(entity);
  scheduler.start();

  server.listen(PORT, () => {
    console.log(`MK-OSINT backend on :${PORT} (ws ${WS_PATH})`);
  });
  ```

  Note: this **replaces** the minimal `index.ts` from step 1 (`app.listen(...)`), which had no
  `http.Server` for the WebSocket to attach to and never started the scheduler or broadcaster.

---

## Task 3: Complete Suite Verification & Definition of Done

- [ ] **Step 3.1: Execute Full Backend Test Suite**
  Run: `rtk make test`
  Expected Output: All backend suites pass, including the balanced-snapshot WS test.

- [ ] **Step 3.2: Verify Code Quality**
  Run: `rtk make lint` → 0 errors. Confirm no route returns `err.stack`:
  `rtk grep -rn "err.stack\|\.stack" backend/src/api` returns nothing.

- [ ] **Step 3.3: Runtime WebSocket verification (behavioral)**
  Start the backend (`rtk make dev` or backend only) and, from a quick client or `wscat`,
  connect to `ws://localhost:4000/ws/telemetry`:
  - Confirm an `initial_state` frame arrives containing **all five** categories.
  - Wait for the ingestion engine to poll; confirm `entity_update` frames arrive as entities
    move — and that you do NOT see a flood of `observation` messages.
  This proves the `index.ts` wiring (`scheduler.onEntityUpdate → broadcaster`) is connected.
