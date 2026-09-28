import { Router, Request, Response } from 'express';
import { getEntities, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../db/queries';
import { sendError, sendServerError } from '../errors';

const router = Router();

function num(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

router.get('/', (req: Request, res: Response) => {
  try {
    const category = (req.query.category as string) || undefined;
    const source_id = (req.query.source_id as string) || undefined;
    const min_lat = num(req.query.min_lat);
    const max_lat = num(req.query.max_lat);
    const min_lon = num(req.query.min_lon);
    const max_lon = num(req.query.max_lon);

    const bounds: Array<[string, number | undefined]> = [
      ['min_lat', min_lat],
      ['max_lat', max_lat],
      ['min_lon', min_lon],
      ['max_lon', max_lon]
    ];
    for (const [name, value] of bounds) {
      if (value !== undefined && Number.isNaN(value)) {
        return sendError(res, 400, 'Bad Request', `Invalid bounding box parameter: ${name}`);
      }
    }
    if (min_lat !== undefined && max_lat !== undefined && min_lat > max_lat) {
      return sendError(
        res,
        400,
        'Bad Request',
        'Invalid bounding box parameters: min_lat must be less than max_lat'
      );
    }
    if (min_lon !== undefined && max_lon !== undefined && min_lon > max_lon) {
      return sendError(
        res,
        400,
        'Bad Request',
        'Invalid bounding box parameters: min_lon must be less than max_lon'
      );
    }

    const requestedLimit = num(req.query.limit);
    const requestedOffset = num(req.query.offset);
    const limit =
      requestedLimit === undefined || Number.isNaN(requestedLimit)
        ? DEFAULT_PAGE_SIZE
        : Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_PAGE_SIZE);
    const offset =
      requestedOffset === undefined || Number.isNaN(requestedOffset)
        ? 0
        : Math.max(Math.trunc(requestedOffset), 0);

    const { rows: entities, total } = getEntities({
      category,
      source_id,
      min_lat,
      max_lat,
      min_lon,
      max_lon,
      limit,
      offset
    });

    return res.json({ total, limit, offset, entities });
  } catch (err) {
    return sendServerError(res, 'Failed to fetch entities', err);
  }
});

export default router;
