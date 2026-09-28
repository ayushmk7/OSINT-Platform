import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { sendError, sendServerError } from '../api/errors';
import {
  DEFAULT_FEED_PAGE,
  ensureFeedTables,
  listFeedItems,
  listIndicators,
  MAX_FEED_PAGE
} from './store';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** `GET /api/feed?source&limit&since` — newest first. */
export function createFeedRouter(db: Database.Database): Router {
  ensureFeedTables(db);
  const router = Router();
  router.get('/', (req: Request, res: Response) => {
    let limit = DEFAULT_FEED_PAGE;
    const rawLimit = optionalString(req.query.limit);
    if (rawLimit !== undefined) {
      const n = Number(rawLimit);
      if (!Number.isFinite(n))
        return sendError(res, 400, 'Bad Request', '`limit` must be a number');
      limit = Math.min(Math.max(Math.trunc(n), 1), MAX_FEED_PAGE);
    }
    let since: string | undefined;
    const rawSince = optionalString(req.query.since);
    if (rawSince !== undefined) {
      const t = Date.parse(rawSince);
      if (Number.isNaN(t)) {
        return sendError(res, 400, 'Bad Request', '`since` must be an ISO 8601 timestamp');
      }
      since = new Date(t).toISOString();
    }
    try {
      const source = optionalString(req.query.source);
      const items = listFeedItems(db, { source, limit, since });
      res.json({ limit, items });
    } catch (err) {
      sendServerError(res, 'Failed to fetch feed items', err);
    }
  });
  return router;
}

/** `GET /api/indicators?source` — latest value + history per indicator. */
export function createIndicatorsRouter(db: Database.Database): Router {
  ensureFeedTables(db);
  const router = Router();
  router.get('/', (req: Request, res: Response) => {
    try {
      res.json({ indicators: listIndicators(db, optionalString(req.query.source)) });
    } catch (err) {
      sendServerError(res, 'Failed to fetch indicators', err);
    }
  });
  return router;
}
