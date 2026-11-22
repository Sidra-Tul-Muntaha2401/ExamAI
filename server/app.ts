import express, { type NextFunction, type Request, type Response } from 'express';
import { attachOptionalUser } from './auth.ts';
import { createApiRouter } from './routes.ts';
import { store } from './store.ts';

export async function ensureDatabaseInitialized(): Promise<void> {
  await store.initialize();
}

export async function createApiApp(): Promise<express.Express> {
  await ensureDatabaseInitialized();

  const app = express();
  app.set('trust proxy', 1);

  // Preserve pre-parsed JSON body if a serverless adapter already consumed the stream
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const ct = req.headers['content-type'] || '';
    const reqWithBody = req as Request & { _body?: boolean };
    if (
      ct.includes('application/json') &&
      req.readableEnded &&
      typeof req.body === 'object' &&
      req.body !== null
    ) {
      reqWithBody._body = true;
    }
    next();
  });

  app.use(express.json({ limit: '4mb' }));

  // Ensure DB is initialized (or return actionable status if Supabase schema is missing)
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') {
      next();
      return;
    }
    if (!store.ready) {
      await store.initialize();
    }
    if (!store.ready && store.initError) {
      res.status(503).json({ error: store.initError });
      return;
    }
    next();
  });

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    void attachOptionalUser(req, res, next);
  });

  app.use('/api', createApiRouter());

  // Fallback Express error handler for async routes
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const msg = err instanceof Error ? err.message : 'Internal server error.';
    console.error('API Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  });

  return app;
}
