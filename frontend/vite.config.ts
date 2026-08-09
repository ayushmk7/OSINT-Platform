/// <reference types="vitest" />
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// vite-plugin-cesium defaults to the cwd-relative path "node_modules/cesium/Build". Under NPM
// workspaces `cesium` is hoisted to the REPO ROOT node_modules, so that default resolves to
// nothing: the dev server silently falls back to index.html for /cesium/* and the production
// build logs "copy failed ENOENT" while still exiting 0. Resolve the real package location so
// Cesium's Workers/Assets/Widgets are served in dev and copied on build.
const require = createRequire(import.meta.url);
const cesiumBuildRootPath = path.join(
  path.dirname(require.resolve('cesium/package.json')),
  'Build'
);

export default defineConfig({
  plugins: [
    react(),
    cesium({
      cesiumBuildRootPath,
      cesiumBuildPath: path.join(cesiumBuildRootPath, 'Cesium')
    })
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      // WebSocket upgrade proxy — REQUIRED for /ws/telemetry to work in dev (used from step 4).
      '/ws': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: true
      }
    }
  },
  // Added in step 4: React component + hook tests need a DOM.
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  }
});
