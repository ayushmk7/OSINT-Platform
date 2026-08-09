import { Router, Request, Response } from 'express';
import { getAllSources } from '../../db/queries';
import { sendServerError } from '../errors';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const sources = getAllSources();
    res.json({ sources });
  } catch (err) {
    sendServerError(res, 'Failed to fetch sources', err);
  }
});

export default router;
