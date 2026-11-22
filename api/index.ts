import type { IncomingMessage, ServerResponse } from 'node:http';
import type express from 'express';
import { createApiApp } from '../server/app.ts';

let appPromise: Promise<express.Express> | null = null;

function getApp(): Promise<express.Express> {
  if (!appPromise) {
    appPromise = createApiApp().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

function normalizeVercelApiUrl(req: IncomingMessage): void {
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, 'http://localhost');
  const rewrittenSubPath = parsed.searchParams.get('__path');

  if (rewrittenSubPath !== null) {
    parsed.searchParams.delete('__path');
    const qs = parsed.searchParams.toString();
    const cleanSub = rewrittenSubPath.replace(/^\/+/, '');
    req.url = `/api/${cleanSub}${qs ? `?${qs}` : ''}`;
    return;
  }

  if (!parsed.pathname.startsWith('/api')) {
    req.url = `/api${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    normalizeVercelApiUrl(req);
    const app = await getApp();
    app(req as unknown as express.Request, res as unknown as express.Response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server initialization error.';
    console.error('Vercel API handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: message }));
    }
  }
}
