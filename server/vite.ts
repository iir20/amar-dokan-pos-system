import express, { type Express } from 'express';
import type { Server } from 'http';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

export async function setupVite(app: Express, server: Server) {
  const vite = await createViteServer({
    configFile: path.resolve(process.cwd(), 'vite.config.ts'),
    server: {
      middlewareMode: true,
      hmr: { server },
      host: '0.0.0.0',
      allowedHosts: true as const,
    },
    appType: 'custom',
  });

  app.use(vite.middlewares);

  app.use(/.*/, async (req, res, next) => {
    const url = req.originalUrl;
    if (url.startsWith('/api')) return next();
    try {
      const templatePath = path.resolve(process.cwd(), 'index.html');
      let template = fs.readFileSync(templatePath, 'utf-8');
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(distPath)) {
    throw new Error(`Could not find build directory: ${distPath}. Run "npm run build" first.`);
  }
  app.use(express.static(distPath));
  app.use(/.*/, (req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}
