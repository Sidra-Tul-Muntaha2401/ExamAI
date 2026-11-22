import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApiApp } from './server/app.ts';

async function startServer(): Promise<void> {
  const app = await createApiApp();

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
  app.listen(port, '0.0.0.0', () => {
    console.log(`ExamAI server listening on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ExamAI server:', err);
  process.exit(1);
});
