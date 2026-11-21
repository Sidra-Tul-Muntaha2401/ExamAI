import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { attachOptionalUser } from './server/auth.ts';
import { initializeDatabase } from './server/db.ts';
import { createApiRouter } from './server/routes.ts';

async function startServer(): Promise<void> {
  initializeDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(attachOptionalUser);
  app.use('/api', createApiRouter());

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

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`ExamPilot server listening on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ExamPilot server:', err);
  process.exit(1);
});
