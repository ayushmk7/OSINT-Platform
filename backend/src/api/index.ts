import { Router } from 'express';
import sourcesRouter from './routes/sources';
import entitiesRouter from './routes/entities';
import observationsRouter from './routes/observations';

const apiRouter = Router();

apiRouter.use('/sources', sourcesRouter);
apiRouter.use('/entities', entitiesRouter);
apiRouter.use('/observations', observationsRouter);

export default apiRouter;
