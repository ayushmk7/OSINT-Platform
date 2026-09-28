import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { initDatabase, closeDatabase } from '../db/database';
import { getRuntimeConfig } from '../runtime-config';
import { CACHE_IMMUTABLE, shouldServeFrontend } from '../static-frontend';

const ENV_KEYS = [
  'MKOSINT_SERVE_FRONTEND',
  'MKOSINT_FRONTEND_DIR',
  'MKOSINT_APP_NAME',
  'MKOSINT_CESIUM_ION_TOKEN',
  'MKOSINT_DEFAULT_GLOBE_STYLE',
  'NODE_ENV'
] as const;

describe('single-container deployment', () => {
  let db: Database.Database;
  let distDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    db = initDatabase(':memory:');
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkosint-dist-'));
    fs.mkdirSync(path.join(distDir, 'assets'));
    fs.mkdirSync(path.join(distDir, 'cesium'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>MK-OSINT</title>');
    fs.writeFileSync(path.join(distDir, 'assets', 'index-abc123.js'), 'console.log(1);');
    fs.writeFileSync(path.join(distDir, 'cesium', 'Cesium.js'), '/* cesium */');
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  afterAll(() => {
    closeDatabase(db);
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  function appServingFrontend() {
    process.env.MKOSINT_SERVE_FRONTEND = 'true';
    process.env.MKOSINT_FRONTEND_DIR = distDir;
    return createApp(db);
  }

  describe('static frontend', () => {
    it('serves index.html at / with no-cache', async () => {
      const res = await request(appServingFrontend()).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain('MK-OSINT');
    });

    it('serves hashed assets as immutable', async () => {
      const res = await request(appServingFrontend()).get('/assets/index-abc123.js');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(CACHE_IMMUTABLE);
    });

    it('revalidates unhashed files such as Cesium workers', async () => {
      const res = await request(appServingFrontend()).get('/cesium/Cesium.js');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
    });

    it('falls back to index.html for client-side routes', async () => {
      const res = await request(appServingFrontend())
        .get('/some/client/route')
        .set('Accept', 'text/html');
      expect(res.status).toBe(200);
      expect(res.text).toContain('MK-OSINT');
    });

    it('does not fall back for missing files with an extension', async () => {
      const res = await request(appServingFrontend()).get('/assets/missing-000.js');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not Found');
    });

    it('keeps API routes and API 404s as JSON', async () => {
      const app = appServingFrontend();
      const health = await request(app).get('/api/health');
      expect(health.body).toEqual({ status: 'ok' });
      const missing = await request(app).get('/api/nope').set('Accept', 'text/html');
      expect(missing.status).toBe(404);
      expect(missing.headers['content-type']).toMatch(/json/);
    });

    it('is off by default outside production', async () => {
      delete process.env.MKOSINT_SERVE_FRONTEND;
      process.env.MKOSINT_FRONTEND_DIR = distDir;
      process.env.NODE_ENV = 'test';
      const res = await request(createApp(db)).get('/');
      expect(res.status).toBe(404);
    });

    it('turns on in production when the build exists, and can be forced off', () => {
      expect(shouldServeFrontend(distDir, { NODE_ENV: 'production' })).toBe(true);
      expect(
        shouldServeFrontend(distDir, { NODE_ENV: 'production', MKOSINT_SERVE_FRONTEND: 'false' })
      ).toBe(false);
      expect(shouldServeFrontend(path.join(distDir, 'nope'), { NODE_ENV: 'production' })).toBe(
        false
      );
    });
  });

  describe('GET /config.json', () => {
    it('returns defaults with no-store', async () => {
      delete process.env.MKOSINT_APP_NAME;
      delete process.env.MKOSINT_CESIUM_ION_TOKEN;
      delete process.env.MKOSINT_DEFAULT_GLOBE_STYLE;
      const res = await request(createApp(db)).get('/config.json');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        appName: 'MK-OSINT',
        cesiumIonToken: null,
        defaultGlobeStyle: null
      });
    });

    it('reflects MKOSINT_* settings', async () => {
      process.env.MKOSINT_APP_NAME = 'Ops Room';
      process.env.MKOSINT_CESIUM_ION_TOKEN = 'ion-token';
      process.env.MKOSINT_DEFAULT_GLOBE_STYLE = 'blue_marble';
      const res = await request(createApp(db)).get('/config.json');
      expect(res.body).toEqual({
        appName: 'Ops Room',
        cesiumIonToken: 'ion-token',
        defaultGlobeStyle: 'blue_marble'
      });
    });

    it('never exposes other environment variables', () => {
      const cfg = getRuntimeConfig({
        SOME_API_KEY: 'secret',
        DB_PATH: '/data/x.db',
        MKOSINT_OTHER_SECRET: 'secret'
      });
      expect(Object.keys(cfg).sort()).toEqual(['appName', 'cesiumIonToken', 'defaultGlobeStyle']);
      expect(JSON.stringify(cfg)).not.toContain('secret');
    });
  });
});
