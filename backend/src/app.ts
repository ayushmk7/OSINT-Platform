import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import apiRouter from './api';

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

  app.use('/api', apiRouter);

  return app;
}
