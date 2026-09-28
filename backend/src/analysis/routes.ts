import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { sendError, sendServerError } from '../api/errors';
import { getAnalysisStatus } from './status';
import {
  DEFAULT_INSIGHTS_PAGE,
  ensureInsightTables,
  listInsights,
  MAX_INSIGHTS_PAGE
} from './store';
import { ATTENTION_LEVELS, isAttention } from './types';

/**
 * `GET /api/insights?limit&attention&since` — newest first.
 * `GET /api/insights/status` — whether the engine runs, with which provider, and which analyses.
 */
export function createInsightsRouter(db: Database.Database): Router {
  ensureInsightTables(db);
  const router = Router();

  router.get('/status', (_req: Request, res: Response) => {
    res.json(getAnalysisStatus());
  });

  router.get('/', (req: Request, res: Response) => {
    const { limit: rawLimit, attention, since } = req.query;
    let limit = DEFAULT_INSIGHTS_PAGE;
    if (typeof rawLimit === 'string' && rawLimit.trim() !== '') {
      const n = Number(rawLimit);
      if (!Number.isFinite(n)) {
        return sendError(res, 400, 'Bad Request', '`limit` must be a number');
      }
      limit = Math.min(Math.max(Math.trunc(n), 1), MAX_INSIGHTS_PAGE);
    }
    if (attention !== undefined && !isAttention(attention)) {
      return sendError(
        res,
        400,
        'Bad Request',
        `\`attention\` must be one of ${ATTENTION_LEVELS.join(', ')}`
      );
    }
    let sinceIso: string | undefined;
    if (since !== undefined) {
      const t = typeof since === 'string' ? Date.parse(since) : NaN;
      if (Number.isNaN(t)) {
        return sendError(res, 400, 'Bad Request', '`since` must be an ISO 8601 timestamp');
      }
      sinceIso = new Date(t).toISOString();
    }
    try {
      const insights = listInsights(db, { limit, attention, since: sinceIso });
      res.json({ limit, insights });
    } catch (err) {
      sendServerError(res, 'Failed to fetch insights', err);
    }
  });

  return router;
}
