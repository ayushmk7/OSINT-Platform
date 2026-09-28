import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import apiRouter from './api';
import { notFoundHandler, sendServerError } from './api/errors';

/**
 * The spec lives in `src/api/` and tsc does not copy YAML into `dist/`, so resolve it from the
 * backend root: `__dirname` is `src/` under tsx/ts-jest and `dist/` after `tsc`, and
 * `../src/api/openapi.yaml` points at the same file from both.
 */
export const OPENAPI_SPEC_PATH = path.resolve(__dirname, '../src/api/openapi.yaml');

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

  app.use('/api', apiRouter);

  // Must stay LAST: JSON 404 envelope instead of Express's default HTML page.
  app.use(notFoundHandler);

  return app;
}
