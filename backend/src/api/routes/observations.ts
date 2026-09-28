import { Router, Request, Response } from 'express';
import { getObservations, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../db/queries';
import { sendServerError } from '../errors';

const router = Router();

function intParam(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

router.get('/', (req: Request, res: Response) => {
  try {
    const entity_id = (req.query.entity_id as string) || undefined;
    const source_id = (req.query.source_id as string) || undefined;
    const limit = intParam(req.query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const offset = intParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    const { rows: observations, total } = getObservations({ entity_id, source_id, limit, offset });

    res.json({ total, limit, offset, observations });
  } catch (err) {
    sendServerError(res, 'Failed to fetch observations', err);
  }
});

export default router;
