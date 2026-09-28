import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import apiRouter from './api';
import { notFoundHandler, sendServerError } from './api/errors';
import { runtimeConfigHandler } from './runtime-config';
import { mountFrontend, resolveFrontendDir, shouldServeFrontend } from './static-frontend';
import { createInsightsRouter } from './analysis/routes';

/**
 * `__dirname` is `src/` under tsx/ts-jest and `dist/` after the build, which copies the spec to
 * `dist/api/openapi.yaml` (tsc does not copy YAML). The same relative path works for both, and
 * the production image needs no `src/` directory.
 */
export const OPENAPI_SPEC_PATH = path.resolve(__dirname, 'api/openapi.yaml');

/**
 * Builds the Express app.
 *
 * `db` MUST be the instance returned by `initDatabase()` — the API router resolves the
 * connection through the `getDatabase()` singleton, so passing a different handle here
 * would leave the routes querying the wrong database.
 *
 * Responses are WRAPPED objects (the fixed contract), never bare arrays.
 */
export function createApp(db: Database.Database): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: db.open ? 'ok' : 'degraded' });
  });

  app.get('/api/openapi.yaml', (_req: Request, res: Response) => {
    fs.readFile(OPENAPI_SPEC_PATH, 'utf8', (err, spec) => {
      if (err) return sendServerError(res, 'Failed to read OpenAPI spec', err);
      res.type('application/yaml').send(spec);
    });
  });

  app.use('/api/insights', createInsightsRouter(db));
  app.use('/api', apiRouter);

  // Client-safe runtime settings (allow-listed MKOSINT_* vars only) and, when enabled, the built
  // SPA on the same port as the API + WebSocket (single-container deployment).
  app.get('/config.json', runtimeConfigHandler);
  const frontendDir = resolveFrontendDir();
  if (shouldServeFrontend(frontendDir)) mountFrontend(app, frontendDir);

  // Must stay LAST: JSON 404 envelope instead of Express's default HTML page.
  app.use(notFoundHandler);

  return app;
}
