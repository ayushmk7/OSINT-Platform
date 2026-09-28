# Implementation Plan: 01 - Project Setup & Monorepo Foundation

This step-by-step TDD plan details the creation of the monorepo structure, root Makefile, backend TypeScript + Express + SQLite setup, OpenAPI REST specification, and frontend Vite + React + MUI setup.

---

## Task 1: Root Project Structure & Makefile Initialization

- [ ] **Step 1.1: Create Root `package.json`**
  Write the root `package.json` file configuring workspaces for `backend` and `frontend`, and convenience npm scripts.

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/package.json`
  ```json
  {
    "name": "vibe-coding-osint-platform",
    "version": "1.0.0",
    "private": true,
    "workspaces": [
      "backend",
      "frontend"
    ],
    "scripts": {
      "dev": "npx concurrently \"npm run dev --prefix backend\" \"npm run dev --prefix frontend\"",
      "build": "npm run build --prefix backend && npm run build --prefix frontend",
      "test": "npm run test --prefix backend && npm run test --prefix frontend",
      "lint": "npm run lint --prefix backend && npm run lint --prefix frontend",
      "format": "npx prettier --write \"**/*.{ts,tsx,json,md,yaml}\""
    },
    "devDependencies": {
      "concurrently": "^8.2.2",
      "prettier": "^3.2.5"
    }
  }
  ```

- [ ] **Step 1.2: Create Root `Makefile`**
  Write the root `Makefile` standardizing development commands.

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/Makefile`

  > **Do NOT put `rtk` in this file.** `rtk` is your (the agent's) shell wrapper; it does
  > not exist on attendees' machines. The Makefile calls `npm`/`npx` directly.

  ```makefile
  .PHONY: install dev build test lint format help

  help:
  	@echo "MK-OSINT commands:"
  	@echo "  make install - Install all Node.js dependencies (root + workspaces)"
  	@echo "  make dev     - Launch backend and frontend dev servers"
  	@echo "  make build   - Compile backend and frontend web assets"
  	@echo "  make test    - Run test suites for backend and frontend"
  	@echo "  make lint    - Run linters across workspace"
  	@echo "  make format  - Format codebase with Prettier"

  # Installs root + backend + frontend deps in one pass via NPM workspaces.
  # Call `npm install` DIRECTLY. Do NOT add an "install" script to package.json:
  # npm auto-runs an `install` lifecycle script during `npm install`, so it would
  # recurse into itself and loop forever.
  install:
  	npm install

  dev:
  	npm run dev

  build:
  	npm run build

  test:
  	npm run test

  lint:
  	npm run lint

  format:
  	npm run format
  ```

  Verify the Makefile is portable: `grep -n rtk Makefile` must print nothing, and each
  target must run in a shell where `rtk` is not on `PATH`.

---

## Task 2: Backend Package Setup & SQLite Database Engine

- [ ] **Step 2.1: Initialize Backend `package.json`, `tsconfig.json`, and `jest.config.js`**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/package.json`
  ```json
  {
    "name": "mk-osint-backend",
    "version": "1.0.0",
    "private": true,
    "main": "dist/index.js",
    "scripts": {
      "dev": "tsx watch src/index.ts",
      "build": "tsc",
      "start": "node dist/index.js",
      "test": "jest",
      "lint": "tsc --noEmit"
    },
    "dependencies": {
      "better-sqlite3": "^9.4.3",
      "cors": "^2.8.5",
      "dotenv": "^16.4.5",
      "express": "^4.19.2",
      "ws": "^8.16.0",
      "yaml": "^2.4.1"
    },
    "devDependencies": {
      "@types/better-sqlite3": "^7.6.9",
      "@types/cors": "^2.8.17",
      "@types/express": "^4.17.21",
      "@types/jest": "^29.5.12",
      "@types/node": "^20.11.24",
      "@types/ws": "^8.5.10",
      "jest": "^29.7.0",
      "ts-jest": "^29.1.2",
      "tsx": "^4.7.1",
      "typescript": "^5.3.3"
    }
  }
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/tsconfig.json`
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "lib": ["ES2022"],
      "outDir": "./dist",
      "rootDir": "./src",
      "strict": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true
    },
    "include": ["src/**/*"]
  }
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/jest.config.js`
  ```javascript
  module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    transform: {
      '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
    }
  };
  ```

- [ ] **Step 2.2: Write SQLite Database Initialization Test (TDD)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/__tests__/database.test.ts`
  ```typescript
  import { initDatabase, closeDatabase } from '../db/database';
  import Database from 'better-sqlite3';

  describe('Database Initialization', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = initDatabase(':memory:');
    });

    afterEach(() => {
      closeDatabase(db);
    });

    it('should create sources, entities, and observations tables', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('sources');
      expect(tableNames).toContain('entities');
      expect(tableNames).toContain('observations');
    });

    it('should allow inserting and fetching sources', () => {
      const stmt = db.prepare(`
        INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run('test-source-1', 'Test Source', 'earthquakes', 'http', 'http://example.com/api', 30, 1);

      const source = db.prepare('SELECT * FROM sources WHERE id = ?').get('test-source-1') as any;
      expect(source).toBeDefined();
      expect(source.name).toBe('Test Source');
      expect(source.enabled).toBe(1);
    });
  });
  ```

  Run test to verify failure before implementation:
  Command: `rtk npm test --prefix backend`
  Expected Output: Test suite fails due to missing `database.ts` module.

- [ ] **Step 2.3: Implement `backend/src/db/database.ts`**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/db/database.ts`

  > Exposes a module **singleton** (`getDatabase`) so routes, query helpers, the ingestion
  > scheduler, and the WebSocket server all share one connection. Steps 2–4 import
  > `getDatabase` directly — it must exist from step 1.

  ```typescript
  import Database from 'better-sqlite3';

  let dbSingleton: Database.Database | null = null;

  export function initDatabase(dbPath: string = 'mk-osint.db'): Database.Database {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          transport TEXT NOT NULL,
          url TEXT NOT NULL,
          update_interval_sec INTEGER NOT NULL DEFAULT 60,
          enabled INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          category TEXT NOT NULL,
          name TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          altitude REAL NOT NULL DEFAULT 0.0,
          timestamp TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);
      CREATE INDEX IF NOT EXISTS idx_entities_source_id ON entities(source_id);

      CREATE TABLE IF NOT EXISTS observations (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          altitude REAL NOT NULL DEFAULT 0.0,
          speed REAL NOT NULL DEFAULT 0.0,
          heading REAL NOT NULL DEFAULT 0.0,
          timestamp TEXT NOT NULL,
          raw_payload TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
          FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_entity_id ON observations(entity_id);
      CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp);

      -- Natural key: one observation per (entity, instant). With a deterministic
      -- observation id + INSERT OR IGNORE (step 2) this is what prevents the
      -- 372k-row duplication. REQUIRED.
      CREATE UNIQUE INDEX IF NOT EXISTS ux_observations_entity_timestamp
          ON observations(entity_id, timestamp);
    `);

    dbSingleton = db;
    return db;
  }

  export function getDatabase(): Database.Database {
    if (!dbSingleton) {
      throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return dbSingleton;
  }

  export function closeDatabase(db: Database.Database = dbSingleton as Database.Database): void {
    if (db && db.open) {
      db.close();
    }
    if (db === dbSingleton) {
      dbSingleton = null;
    }
  }
  ```

  Run test to verify pass:
  Command: `rtk npm test --prefix backend`
  Expected Output: All unit tests in `database.test.ts` PASS.

---

## Task 3: Backend Express App & OpenAPI Specification

- [ ] **Step 3.1: Create OpenAPI 3.0 Contract File**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/api/openapi.yaml`
  ```yaml
  openapi: 3.0.3
  info:
    title: MK-OSINT API
    description: RESTful API for querying telemetry sources, entities, and observations.
    version: 1.0.0
  paths:
    /api/sources:
      get:
        summary: List data sources
        responses:
          '200':
            description: List of configured telemetry data sources
            content:
              application/json:
                schema:
                  type: array
                  items:
                    $ref: '#/components/schemas/Source'
    /api/entities:
      get:
        summary: List tracked entities
        parameters:
          - in: query
            name: category
            schema:
              type: string
            description: Filter by category (e.g. aircraft, satellite, vessel)
        responses:
          '200':
            description: List of tracked entities
            content:
              application/json:
                schema:
                  type: array
                  items:
                    $ref: '#/components/schemas/Entity'
    /api/observations:
      get:
        summary: List recorded observations
        parameters:
          - in: query
            name: entity_id
            schema:
              type: string
            description: Filter by entity ID
        responses:
          '200':
            description: List of observations
            content:
              application/json:
                schema:
                  type: array
                  items:
                    $ref: '#/components/schemas/Observation'
  components:
    schemas:
      Source:
        type: object
        properties:
          id:
            type: string
          name:
            type: string
          type: string
          transport:
            type: string
          url:
            type: string
          update_interval_sec:
            type: integer
          enabled:
            type: boolean
        required: [id, name, type, transport, url, update_interval_sec, enabled]
      Entity:
        type: object
        properties:
          id:
            type: string
          source_id:
            type: string
          category:
            type: string
          name:
            type: string
          latitude:
            type: number
          longitude:
            type: number
          altitude:
            type: number
          timestamp:
            type: string
          metadata:
            type: object
        required: [id, source_id, category, name, latitude, longitude, timestamp]
      Observation:
        type: object
        properties:
          id:
            type: string
          entity_id:
            type: string
          source_id:
            type: string
          latitude:
            type: number
          longitude:
            type: number
          altitude:
            type: number
          speed:
            type: number
          heading:
            type: number
          timestamp:
            type: string
          raw_payload:
            type: object
        required: [id, entity_id, source_id, latitude, longitude, timestamp]
  ```

- [ ] **Step 3.2: Write Express Routes Integration Test (TDD)**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/__tests__/routes.test.ts`
  ```typescript
  import request from 'supertest';
  import { createApp } from '../app';
  import { initDatabase, closeDatabase } from '../db/database';
  import Database from 'better-sqlite3';

  describe('REST API Routes', () => {
    let db: Database.Database;

    beforeAll(() => {
      db = initDatabase(':memory:');
      db.prepare(`
        INSERT INTO sources (id, name, type, transport, url, update_interval_sec, enabled)
        VALUES ('src-1', 'Test Source', 'earthquake', 'http', 'http://api.com', 60, 1)
      `).run();
    });

    afterAll(() => {
      closeDatabase(db);
    });

    it('GET /api/sources returns wrapped { sources }', async () => {
      const app = createApp(db);
      const res = await request(app).get('/api/sources');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sources)).toBe(true);
      expect(res.body.sources.length).toBe(1);
      expect(res.body.sources[0].id).toBe('src-1');
    });

    it('GET /api/entities returns wrapped { entities }', async () => {
      const app = createApp(db);
      const res = await request(app).get('/api/entities');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.entities)).toBe(true);
    });

    it('GET /api/observations returns wrapped { observations }', async () => {
      const app = createApp(db);
      const res = await request(app).get('/api/observations');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.observations)).toBe(true);
    });
  });
  ```

- [ ] **Step 3.3: Implement `backend/src/app.ts` and `backend/src/index.ts`**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/app.ts`
  ```typescript
  import express, { Express, Request, Response } from 'express';
  import cors from 'cors';
  import Database from 'better-sqlite3';

  export function createApp(db: Database.Database): Express {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Responses are WRAPPED objects (the fixed contract), never bare arrays.
    app.get('/api/sources', (_req: Request, res: Response) => {
      const sources = db.prepare('SELECT * FROM sources').all();
      res.json({ sources });
    });

    app.get('/api/entities', (req: Request, res: Response) => {
      const { category } = req.query;
      const entities =
        category && typeof category === 'string'
          ? db.prepare('SELECT * FROM entities WHERE category = ?').all(category)
          : db.prepare('SELECT * FROM entities').all();
      res.json({ total: entities.length, limit: 100, offset: 0, entities });
    });

    app.get('/api/observations', (req: Request, res: Response) => {
      const { entity_id } = req.query;
      const observations =
        entity_id && typeof entity_id === 'string'
          ? db.prepare('SELECT * FROM observations WHERE entity_id = ?').all(entity_id)
          : db.prepare('SELECT * FROM observations').all();
      res.json({ total: observations.length, limit: 100, offset: 0, observations });
    });

    return app;
  }
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/backend/src/index.ts`
  ```typescript
  import dotenv from 'dotenv';
  import { initDatabase } from './db/database';
  import { createApp } from './app';

  dotenv.config();

  const PORT = process.env.PORT || 4000;
  const db = initDatabase(process.env.DB_PATH || 'mk-osint.db');
  const app = createApp(db);

  app.listen(PORT, () => {
    console.log(`MK-OSINT backend running on port ${PORT}`);
  });
  ```

  Run tests to verify backend passes:
  Command: `rtk npm test --prefix backend`
  Expected Output: All database and routes tests PASS.

---

## Task 4: Frontend Vite + React + MUI Dark Theme Setup

- [ ] **Step 4.1: Initialize Frontend Configuration Files**

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/package.json`
  ```json
  {
    "name": "mk-osint-frontend",
    "private": true,
    "version": "1.0.0",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc && vite build",
      "lint": "tsc --noEmit",
      "test": "vitest run"
    },
    "dependencies": {
      "@emotion/react": "^11.11.4",
      "@emotion/styled": "^11.11.0",
      "@mui/icons-material": "^5.15.11",
      "@mui/material": "^5.15.11",
      "cesium": "^1.143.0",
      "react": "^18.2.0",
      "react-dom": "^18.2.0"
    },
    "devDependencies": {
      "@types/react": "^18.2.56",
      "@types/react-dom": "^18.2.19",
      "@vitejs/plugin-react": "^4.2.1",
      "typescript": "^5.3.3",
      "vite": "^5.1.4",
      "vite-plugin-cesium": "^1.2.23",
      "vitest": "^1.3.1"
    }
  }
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/tsconfig.json`
  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "useDefineForClassFields": true,
      "lib": ["ES2020", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "skipLibCheck": true,
      "moduleResolution": "bundler",
      "allowImportingTsExtensions": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noEmit": true,
      "jsx": "react-jsx",
      "strict": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "noFallthroughCasesInSwitch": true
    },
    "include": ["src"]
  }
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/vite.config.ts`

  > Two things this config MUST have:
  > 1. `cesium()` from `vite-plugin-cesium` — it copies Cesium's static assets and defines
  >    `CESIUM_BASE_URL` so the globe (Step 4.3) actually loads. Step 4 reuses this same config
  >    and only adds a Vitest `test` block on top.
  > 2. The `/ws` proxy with `ws: true` — without it the browser opens the WebSocket against the
  >    Vite dev server (port 3000), which cannot upgrade `/ws/telemetry`, and the whole real-time
  >    feed (added in step 4) silently fails. Set it up now so it is ready.

  ```typescript
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';
  import cesium from 'vite-plugin-cesium';

  export default defineConfig({
    plugins: [react(), cesium()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true
        },
        // WebSocket upgrade proxy — REQUIRED for /ws/telemetry to work in dev (used from step 4).
        '/ws': {
          target: 'http://localhost:4000',
          ws: true,
          changeOrigin: true
        }
      }
    }
  });
  ```

- [ ] **Step 4.2: Implement the single Tactical MUI Theme**

  Create **exactly one** theme module. Do not create a second one later (a `darkTheme` vs
  `tacticalTheme` split caused theme inconsistencies in the previous run).

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/theme.ts`
  ```typescript
  import { createTheme } from '@mui/material/styles';

  // Green-on-black tactical "command center" identity. Reused by every later step.
  export const tacticalTheme = createTheme({
    palette: {
      mode: 'dark',
      background: {
        default: '#000000',
        paper: '#0a0a0a'
      },
      primary: {
        main: '#00ff9d'   // neon green accent
      },
      secondary: {
        main: '#ff006e'   // magenta
      },
      error: { main: '#ff0055' },
      success: { main: '#00ff9d' },
      text: {
        primary: '#ffffff',
        secondary: '#888888'
      }
    },
    typography: {
      fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
      h6: {
        fontWeight: 600,
        letterSpacing: '0.05em'
      }
    }
  });
  ```

- [ ] **Step 4.3: Implement the Simple Globe, Entry Point & Main Component**

  First, the globe itself — a real Cesium globe with the dark basemap and a slow idle spin.
  **This is the same `GlobeView.tsx` that step 4 extends** (step 4 adds category markers, the
  WebSocket telemetry feed, and click-to-select on top of it), so build it as a real component
  now, never a placeholder. Cesium's static assets and `CESIUM_BASE_URL` come from
  `vite-plugin-cesium` (Step 4.1) — do not hotlink Cesium from a CDN.

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/components/GlobeView.tsx`
  ```tsx
  import { useEffect, useRef, type FC } from 'react';
  import { Box } from '@mui/material';
  import * as Cesium from 'cesium';
  import 'cesium/Build/Cesium/Widgets/widgets.css';

  // Real dark slippy-map basemap — NO API key required. Built by a factory because React
  // StrictMode double-invokes effects in dev. (Optional upgrade: set VITE_CESIUM_ION_TOKEN and
  // switch to Cesium Ion World Imagery instead.)
  function makeBaseLayer(): Cesium.ImageryLayer {
    return new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png',
        maximumLevel: 18,
        credit: 'Stadia Maps, OpenMapTiles, OpenStreetMap',
      })
    );
  }

  // Gentle idle rotation, in radians per clock tick (~60fps). Stops on first interaction.
  const SPIN_PER_TICK = 0.0015;

  export const GlobeView: FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!containerRef.current) return;
      let viewer: Cesium.Viewer;
      try {
        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: makeBaseLayer(),
          baseLayerPicker: false, timeline: false, animation: false, geocoder: false,
          homeButton: false, sceneModePicker: false, navigationHelpButton: false,
          fullscreenButton: false, infoBox: false, selectionIndicator: false,
          requestRenderMode: true, maximumRenderTimeChange: 0.5,
          scene3DOnly: true, shouldAnimate: true, shadows: false,
        });
      } catch (err) {
        console.error('Cesium viewer failed to initialize:', err); // never swallow silently
        return;
      }

      viewer.scene.backgroundColor = Cesium.Color.BLACK;
      (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';

      // Idle "attract mode": spin slowly until the user grabs the globe, then stop so panning and
      // zoom feel natural. camera.rotate marks the scene dirty each tick, so it still renders
      // under requestRenderMode.
      let spinning = true;
      const onTick = () => {
        if (spinning) viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -SPIN_PER_TICK);
      };
      viewer.clock.onTick.addEventListener(onTick);

      const stopSpin = () => { spinning = false; };
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
      handler.setInputAction(stopSpin, Cesium.ScreenSpaceEventType.LEFT_DOWN);
      handler.setInputAction(stopSpin, Cesium.ScreenSpaceEventType.WHEEL);

      return () => {
        viewer.clock.onTick.removeEventListener(onTick);
        handler.destroy();
        if (!viewer.isDestroyed()) viewer.destroy();
      };
    }, []);

    return (
      <Box
        ref={containerRef}
        data-testid="globe-view-container"
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', bgcolor: '#000' }}
      />
    );
  };
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/index.html`
  ```html
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>MK-OSINT</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #000000; overflow: hidden;">
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/App.tsx`

  The globe fills the viewport; the app bar floats over it. (Step 4 adds the layer/inspector
  drawers and telemetry banner to this same shell.)

  ```tsx
  import React from 'react';
  import { Box, AppBar, Toolbar, Typography } from '@mui/material';
  import { GlobeView } from './components/GlobeView';

  export const App: React.FC = () => {
    return (
      <Box
        sx={{
          position: 'relative',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          bgcolor: 'background.default',
        }}
      >
        <GlobeView />
        <AppBar
          position="absolute"
          color="transparent"
          elevation={0}
          sx={{
            background: 'rgba(0, 0, 0, 0.55)',
            borderBottom: '1px solid #1f2937',
            backdropFilter: 'blur(6px)',
          }}
        >
          <Toolbar>
            <Typography
              variant="h6"
              component="div"
              sx={{ color: 'primary.main', flexGrow: 1, letterSpacing: '0.15em' }}
            >
              MK-OSINT OSINT PLATFORM
            </Typography>
          </Toolbar>
        </AppBar>
      </Box>
    );
  };
  ```

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/main.tsx`
  ```tsx
  import React from 'react';
  import ReactDOM from 'react-dom/client';
  import { ThemeProvider, CssBaseline } from '@mui/material';
  import { tacticalTheme } from './theme';
  import { App } from './App';

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider theme={tacticalTheme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </React.StrictMode>
  );
  ```

- [ ] **Step 4.4: Add a frontend test (so `vitest run` has a test and passes honestly)**

  `vitest run` exits non-zero when it finds no test files, and we do NOT use a
  "pass with no tests" escape hatch. Add a real, pure unit test of the theme (no DOM needed):

  File: `/Users/alevsk/Development/vibe-coding-osint-platform/frontend/src/__tests__/theme.test.ts`
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { tacticalTheme } from '../theme';

  describe('tacticalTheme', () => {
    it('uses the green-on-black tactical palette', () => {
      expect(tacticalTheme.palette.mode).toBe('dark');
      expect(tacticalTheme.palette.primary.main).toBe('#00ff9d');
      expect(tacticalTheme.palette.background.default).toBe('#000000');
    });
    it('uses a monospace font stack', () => {
      expect(tacticalTheme.typography.fontFamily).toMatch(/JetBrains Mono/);
    });
  });
  ```

---

## Verification & Final Audit (Definition of Done)

Do not mark Task 5 complete until every check below is **observed** passing. Passing unit
tests alone is not sufficient.

- [ ] **Step 5.1: Portability — no `rtk` in committed files**
  Command: `rtk grep -rn "rtk" Makefile package.json backend/package.json frontend/package.json`
  Expected: **zero** matches. (`rtk` is your shell wrapper only; it must never be committed.)

- [ ] **Step 5.2: Every `make` target runs (with `rtk` NOT on PATH)**
  Run each target so a missing `rtk` cannot hide behind your wrapper:
  - `make help` → prints the target list (including `make install`).
  - `make install` → runs `npm install` at the root and installs `backend/` + `frontend/`
    deps via workspaces; exits 0. Run this first so the other targets have their deps.
    Confirm no `install` script exists in any `package.json` (`grep -n '"install"'
    package.json backend/package.json frontend/package.json` → zero matches) so it cannot recurse.
  - `make build` → backend `tsc` + frontend `vite build` both exit 0.
  - `make test` → backend + frontend suites run (no `--passWithNoTests`).
  - `make lint` → 0 TypeScript errors (`strict`, `noUnusedLocals`, `noUnusedParameters` on).
  - `make format` → completes.
  - `make dev` → start it; confirm the backend logs port `4000` AND the Vite dev server prints
    its URL. Then open `http://localhost:3000` and confirm a **dark 3D Cesium globe renders and
    slowly auto-rotates** (not a placeholder card); then stop it. Do NOT claim success without
    seeing both servers come up and the globe render.

- [ ] **Step 5.3: Backend boots and answers**
  Start the backend, then: `rtk curl -s localhost:4000/api/sources`
  Expected: valid JSON `{ "sources": [ ... ] }` (wrapped, not a bare array), not a
  connection error.

- [ ] **Step 5.4: Contracts present**
  - `backend/src/db/database.ts` exports `initDatabase`, `getDatabase`, `closeDatabase`.
  - Backend port is `4000` everywhere; `vite.config.ts` registers `cesium()` and proxies `/api`
    and `/ws` (`ws:true`).
  - Exactly one theme file `frontend/src/theme.ts` (`tacticalTheme`, green-on-black, monospace).
  - `frontend/src/components/GlobeView.tsx` is a real `Cesium.Viewer` (dark basemap + idle spin) —
    the base step 4 extends; `cesium` + `vite-plugin-cesium` are in `frontend/package.json`.
  - No empty `catch` blocks; no CDN-hotlinked assets; no `err.stack` returned to clients.
