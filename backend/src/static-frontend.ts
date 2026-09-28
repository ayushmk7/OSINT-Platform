import fs from 'fs';
import path from 'path';
import express, { Express, NextFunction, Request, Response } from 'express';

/** Default location of the Vite build, relative to the backend's `src/` or `dist/`. */
export const DEFAULT_FRONTEND_DIR = path.resolve(__dirname, '../../frontend/dist');

export function resolveFrontendDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MKOSINT_FRONTEND_DIR ? path.resolve(env.MKOSINT_FRONTEND_DIR) : DEFAULT_FRONTEND_DIR;
}

/**
 * Serve the SPA when MKOSINT_SERVE_FRONTEND=true, or in production (NODE_ENV=production) when
 * the build exists. MKOSINT_SERVE_FRONTEND=false always disables it.
 */
export function shouldServeFrontend(dir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.MKOSINT_SERVE_FRONTEND?.trim().toLowerCase();
  if (flag === 'false') return false;
  const hasIndex = fs.existsSync(path.join(dir, 'index.html'));
  if (flag === 'true') {
    if (!hasIndex) {
      console.warn(`[static] MKOSINT_SERVE_FRONTEND=true but ${dir}/index.html is missing`);
    }
    return hasIndex;
  }
  return env.NODE_ENV === 'production' && hasIndex;
}

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_REVALIDATE = 'no-cache';

/**
 * Mount the built frontend on `app`: static files plus an index.html fallback for client-side
 * routes. Vite writes content-hashed files to `assets/`, so those are cached forever; everything
 * else (index.html, Cesium's unhashed Workers/Assets, public/ files) is revalidated via ETag.
 * `/api/*` and `/ws/*` never fall back to index.html, so API 404s stay JSON.
 */
export function mountFrontend(app: Express, dir: string): void {
  const indexPath = path.join(dir, 'index.html');
  app.use(
    express.static(dir, {
      index: false,
      setHeaders(res, filePath) {
        const rel = path.relative(dir, filePath).split(path.sep).join('/');
        res.setHeader(
          'Cache-Control',
          rel.startsWith('assets/') ? CACHE_IMMUTABLE : CACHE_REVALIDATE
        );
      }
    })
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (/^\/(api|ws)(\/|$)/.test(req.path)) return next();
    // A missing file with an extension (e.g. a stale /assets/old-hash.js) is a real 404.
    if (path.extname(req.path)) return next();
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', CACHE_REVALIDATE);
    res.sendFile(indexPath);
  });
}
