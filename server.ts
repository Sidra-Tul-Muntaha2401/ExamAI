import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createApiApp, ensureDatabaseInitialized } from './server/app.ts';

async function startServer(): Promise<void> {
  // Warm database initialization with a bounded wait so server startup never stalls or aborts on slow/transient DB checks
  await Promise.race([
    ensureDatabaseInitialized().catch((err) => {
      console.error('Initial database check failed (will retry on request):', err);
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ]);

  const app = await createApiApp({ waitForDb: false });
  const httpServer = http.createServer(app);

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  const envPort = Number(process.env.APP_PORT || process.env.PORT);
  const port = Number.isFinite(envPort) && envPort > 0 && envPort !== 8080 ? envPort : 3000;

  httpServer.on('error', (err) => {
    console.error(`ExamAI server listen error on port ${port}:`, err);
    process.exit(1);
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`ExamAI server listening on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ExamAI server:', err);
  process.exit(1);
});

